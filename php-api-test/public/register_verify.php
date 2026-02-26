<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

/**
 * POST /api/register/verify
 * body: { email: string, code: string(6digits) }
 *
 * return:
 * 200 {ok:true}
 * 400 invalid_json / invalid_email / invalid_code_format / invalid_code / expired_code
 * 409 already_verified / already_registered
 * 429 too_many_attempts
 */

function norm_email_v(string $email): string {
  return mb_strtolower(trim($email), 'UTF-8');
}
function is_valid_email_v(string $email): bool {
  return (bool)preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email);
}
function sha256hex_v(string $s): string {
  return hash('sha256', $s);
}

error_log('[register/verify] reached. content-type=' . ($_SERVER['CONTENT_TYPE'] ?? ''));

try {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(405, ['error' => 'method_not_allowed']);

  $raw = file_get_contents('php://input');
  $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw); // BOM除去
  error_log('[register/verify] raw=' . $raw);

  $body = json_decode($raw, true);
  if (!is_array($body)) json_out(400, ['error' => 'invalid_json']);

  $email = trim((string)($body['email'] ?? ''));
  $code  = trim((string)($body['code']  ?? ''));

  $email_norm = norm_email_v($email);

  if ($email_norm === '' || !is_valid_email_v($email_norm)) {
    json_out(400, ['error' => 'invalid_email']);
  }
  if (!preg_match('/^\d{6}$/', $code)) {
    json_out(400, ['error' => 'invalid_code_format']);
  }

  $MAX_ATTEMPTS = (int)(getenv('VERIFY_MAX_ATTEMPTS') ?: 6);

  $pdo = pdo();

  // email_verifications_sql のカラム差異を吸収
  $cols = [];
  $stc = $pdo->query("SHOW COLUMNS FROM email_verifications_sql");
  foreach ($stc->fetchAll() as $r) $cols[strtolower($r['Field'])] = true;

  $has_code_hash = isset($cols['code_hash']) && isset($cols['salt']);
  $has_code_plain = isset($cols['code']);

  // 直近レコード取得（email_norm があるなら優先）
  // email_norm が生成列の場合でも WHERE で使う分には問題ありません
  $st = $pdo->prepare("
    SELECT doc_id, email, email_norm, status, code, code_hash, salt,
           expires_at, verified_at, attempts
    FROM email_verifications_sql
    WHERE email_norm = ?
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT 1
  ");
  $st->execute([$email_norm]);
  $ev = $st->fetch();

  if (!$ev) {
    json_out(400, ['error' => 'invalid_code']); // 存在しない = 不一致扱い
  }

  // 既に verified の場合
  if (!empty($ev['verified_at']) || ($ev['status'] ?? '') === 'verified') {
    // users 作成済みなら登録済み
    $stU = $pdo->prepare("SELECT 1 FROM users_sql WHERE email_norm=? LIMIT 1");
    $stU->execute([$email_norm]);
    if ($stU->fetchColumn()) {
      json_out(409, ['error' => 'already_registered']);
    }
    json_out(409, ['error' => 'already_verified']);
  }

  // 期限
  if (!empty($ev['expires_at'])) {
    $exp = new DateTimeImmutable((string)$ev['expires_at']);
    if (time() > $exp->getTimestamp()) {
      json_out(400, ['error' => 'expired_code']);
    }
  }

  // 試行回数
  $attempts = (int)($ev['attempts'] ?? 0);
  if ($attempts >= $MAX_ATTEMPTS) {
    json_out(429, ['error' => 'too_many_attempts']);
  }

  // 照合
  $ok = false;
  if ($has_code_hash) {
    $salt = (string)($ev['salt'] ?? '');
    $code_hash = (string)($ev['code_hash'] ?? '');
    $calc = sha256hex_v($salt . ':' . $code);
    $ok = ($salt !== '' && $code_hash !== '' && hash_equals($code_hash, $calc));
  } elseif ($has_code_plain) {
    $ok = hash_equals((string)($ev['code'] ?? ''), $code);
  } else {
    json_out(500, ['error' => 'schema_mismatch', 'detail' => 'no code fields']);
  }

  if (!$ok) {
    // attempts++
    $stUp = $pdo->prepare("
      UPDATE email_verifications_sql
      SET attempts = attempts + 1,
          status = 'sent',
          updated_at = NOW()
      WHERE doc_id = ?
    ");
    $stUp->execute([(string)$ev['doc_id']]);

    json_out(400, ['error' => 'invalid_code']);
  }

  // OK → verified に更新
  $stOk = $pdo->prepare("
    UPDATE email_verifications_sql
    SET verified_at = NOW(),
        status = 'verified',
        attempts = 0,
        updated_at = NOW()
    WHERE doc_id = ?
  ");
  $stOk->execute([(string)$ev['doc_id']]);

  json_out(200, ['ok' => true]);

} catch (Throwable $e) {
  error_log('[register/verify] ' . $e->getMessage());
  json_out(500, ['error' => 'internal_error', 'detail' => $e->getMessage()]);
}
