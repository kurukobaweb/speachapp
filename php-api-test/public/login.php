<?php
declare(strict_types=1);

// ===== CORS（ローカル開発用）=====
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allow  = 'http://localhost:8100';

if ($origin === $allow) {
  header('Access-Control-Allow-Origin: ' . $allow);
  header('Vary: Origin');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Credentials: true');
}

// preflight
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
  http_response_code(204);
  exit;
}
require_once __DIR__ . '/bootstrap.php'; // json_out(), json_body(), pdo(), normalize_email() を利用


// -----------------------------------------------------
// Utility: base64url + JWT HS256
// -----------------------------------------------------
if (!function_exists('base64url_encode')) {
  function base64url_encode(string $bin): string {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
  }
}

if (!function_exists('jwt_hs256_sign')) {
  /**
   * @param array<string,mixed> $payload
   */
  function jwt_hs256_sign(array $payload, string $secret): string {
    $header = ['alg' => 'HS256', 'typ' => 'JWT'];

    $h = base64url_encode(json_encode($header, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $p = base64url_encode(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $sig = hash_hmac('sha256', $h . '.' . $p, $secret, true);

    return $h . '.' . $p . '.' . base64url_encode($sig);
  }
}

// -----------------------------------------------------
// Main
// -----------------------------------------------------
try {
  header('Content-Type: application/json; charset=utf-8');

  // 必要ならCORS（環境に合わせて制御）
  // header('Access-Control-Allow-Origin: *');
  // header('Access-Control-Allow-Headers: Content-Type, Authorization');
  // header('Access-Control-Allow-Methods: POST, OPTIONS');

  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
  }

  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    json_out(405, ['error' => 'method_not_allowed']);
  }

  $body = json_body(); // bootstrap.php 側の共通パーサを使用（invalid_json などで落ちる想定）
  if (!is_array($body)) {
    json_out(400, ['error' => 'invalid_json']);
  }

  $email_in = (string)($body['email'] ?? '');
  $password = (string)($body['password'] ?? '');

  $email_norm = normalize_email($email_in);

  // 入力バリデーション（必要最低限）
  if ($email_norm === '' || !filter_var($email_norm, FILTER_VALIDATE_EMAIL)) {
    json_out(400, ['error' => 'invalid_email']);
  }
  if ($password === '') {
    json_out(400, ['error' => 'invalid_password']);
  }

  $pdo = pdo();

  // users_sql に email_norm がある前提（generated columnでもOK）
  // 互換のため email でも一応ヒットさせる
  $st = $pdo->prepare("
    SELECT
      doc_id,
      email,
      email_norm,
      display_name,
      role,
      status,
      password_hash
    FROM users_sql
    WHERE email_norm = :email_norm OR email = :email_raw
    LIMIT 1
  ");
  $st->execute([
    ':email_norm' => $email_norm,
    ':email_raw'  => $email_norm,
  ]);

  $u = $st->fetch(PDO::FETCH_ASSOC);

  // 認証失敗は理由を分けない（情報漏洩防止）
  if (!$u) {
    json_out(401, ['error' => 'invalid_credentials']);
  }

  $hash = (string)($u['password_hash'] ?? '');
  if ($hash === '') {
    // パスワード未設定ユーザーを通さない
    json_out(401, ['error' => 'invalid_credentials']);
  }

  // ★最重要：必ず password_verify の結果で分岐する
  if (!password_verify($password, $hash)) {
    json_out(401, ['error' => 'invalid_credentials']);
  }

  // 状態チェック（必要に応じて）
  $status = (string)($u['status'] ?? 'active');
  if ($status !== '' && $status !== 'active') {
    json_out(403, ['error' => 'account_disabled', 'status' => $status]);
  }

  // JWT
  $secret = (string)(getenv('JWT_SECRET') ?: '');
  if ($secret === '') {
    json_out(500, ['error' => 'env_missing', 'JWT_SECRET' => false]);
  }

  $now = time();
  $ttl = (int)(getenv('JWT_TTL_SEC') ?: 604800); // 既定 7日
  if ($ttl < 60) $ttl = 60;

  $payload = [
    'sub'   => (string)($u['doc_id'] ?? ''),
    'email' => (string)($u['email'] ?? $email_norm),
    'role'  => (string)($u['role'] ?? 'user'),
    'iat'   => $now,
    'exp'   => $now + $ttl,
  ];

  $token = jwt_hs256_sign($payload, $secret);

  json_out(200, [
    'ok'    => true,
    'token' => $token,
    'user'  => [
      'doc_id'       => (string)($u['doc_id'] ?? ''),
      'email'        => (string)($u['email'] ?? ''),
      'display_name' => (string)($u['display_name'] ?? ''),
      'role'         => (string)($u['role'] ?? 'user'),
      'status'       => $status,
    ],
  ]);

} catch (Throwable $e) {
  error_log('[login] ' . $e->getMessage());
  json_out(500, ['error' => 'internal_error']);
}
