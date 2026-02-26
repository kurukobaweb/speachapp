<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';


function norm_email(string $email): string {
  return mb_strtolower(trim($email), 'UTF-8');
}
function is_valid_email(string $email): bool {
  return (bool)preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email);
}

function uuidv4(): string {
  $d = random_bytes(16);
  $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
  $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
  $hex = bin2hex($d);
  return substr($hex,0,8).'-'.substr($hex,8,4).'-'.substr($hex,12,4).'-'.substr($hex,16,4).'-'.substr($hex,20,12);
}


try {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(405, ['error' => 'method_not_allowed']);

  $raw = file_get_contents('php://input');
  $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw); // BOM除去
  $body = json_decode($raw, true);
  if (!is_array($body)) json_out(400, ['error' => 'invalid_json']);

  // register.js 互換 :contentReference[oaicite:0]{index=0}
  $email_in = (string)($body['email'] ?? '');
  $email = norm_email($email_in);
  $display_name = trim((string)($body['name'] ?? '')); // ← name を display_name に格納
  $affiliation  = trim((string)($body['affiliation'] ?? ''));
  $pwd          = (string)($body['password'] ?? '');
  $verification = (bool)($body['verification'] ?? false);

  if ($email === '' || !is_valid_email($email)) json_out(400, ['error' => 'invalid_email']);
  if ($display_name === '') json_out(400, ['error' => 'invalid_name']);
  if ($affiliation === '') json_out(400, ['error' => 'invalid_affiliation']);
  if (strlen($pwd) < 8) json_out(400, ['error' => 'invalid_password']);
  if (!$verification) json_out(400, ['error' => 'verification_required']);

  $pdo = pdo();

  // 1) 既存ユーザー判定（email_norm generated なので WHERE は email / email_norm 両対応）
  $st = $pdo->prepare("SELECT doc_id FROM users_sql WHERE email = ? LIMIT 1");
  $st->execute([$email]);
  if ($st->fetchColumn()) {
    json_out(409, ['error' => 'already_registered']);
  }

  // 2) メール検証済みか（verified_at がある行のみ）
  //    email_norm でも email でも拾えるようにする
  $st = $pdo->prepare("
    SELECT doc_id, email, email_norm, verified_at, status
    FROM email_verifications_sql
    WHERE (email = :email OR email_norm = :email_norm)
      AND verified_at IS NOT NULL
    ORDER BY verified_at DESC
    LIMIT 1
  ");
  $st->execute([
    ':email' => $email,
    ':email_norm' => $email,
  ]);
  $ev = $st->fetch();
  if (!$ev) {
    json_out(403, ['error' => 'email_not_verified']);
  }

  // 3) パスワードハッシュ
  $hash = password_hash($pwd, PASSWORD_BCRYPT);

  // 4) raw(JSON) は NOT NULL なので、最低限を格納
  //    ※ email_norm は generated なので INSERT しない
  $doc_id = uuidv4();
  $raw_json = json_encode([
    'display_name' => $display_name,
    'affiliation' => $affiliation,
    'source' => 'register',
    'verified_at' => $ev['verified_at'],
  ], JSON_UNESCAPED_UNICODE);

  // 5) INSERT（users_sql スキーマに合わせる）
  $st = $pdo->prepare("
    INSERT INTO users_sql
      (doc_id, email, display_name, affiliation, password_hash, status, role, raw, created_at, updated_at)
    VALUES
      (:doc_id, :email, :display_name, :affiliation, :ph, :status, :role, CAST(:raw AS JSON), NOW(), NOW())
  ");
  $st->execute([
    ':doc_id' => $doc_id,
    ':email' => $email,
    ':display_name' => $display_name,
    ':affiliation' => $affiliation,
    ':ph' => $hash,
    ':status' => 'active',
    ':role' => 'user',
    ':raw' => $raw_json,
  ]);

  json_out(200, ['ok' => true]);

} catch (Throwable $e) {
  error_log('[users/create] ' . $e->getMessage());
  json_out(500, ['error' => 'internal_error', 'detail' => $e->getMessage()]);
}
