<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function norm_email(string $email): string {
  return mb_strtolower(trim($email), 'UTF-8');
}
function is_valid_email(string $email): bool {
  return (bool)preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email);
}
function gen6digits(): string {
  return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}
function sha256hex(string $s): string {
  return hash('sha256', $s);
}
function now_tokyo(): DateTimeImmutable {
  return new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
}
function bool_env(string $key, bool $def=false): bool {
  $v = getenv($key);
  if ($v === false) return $def;
  $v = strtolower(trim($v));
  return in_array($v, ['1','true','yes','on'], true);
}
function uuid_v4(): string {
  $b = random_bytes(16);
  $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
  $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
  $hex = bin2hex($b);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split($hex, 4));
}

function table_columns(PDO $pdo, string $table): array {
  $st = $pdo->query("SHOW COLUMNS FROM `{$table}`");
  $cols = [];
  foreach ($st->fetchAll() as $r) $cols[strtolower($r['Field'])] = true;
  return $cols;
}

function user_exists_by_email_norm(PDO $pdo, string $email_norm): bool {
  $st = $pdo->prepare("SELECT 1 FROM users_sql WHERE email_norm = ? LIMIT 1");
  $st->execute([$email_norm]);
  return (bool)$st->fetchColumn();
}

error_log('[register/email] reached. content-type=' . ($_SERVER['CONTENT_TYPE'] ?? ''));

try {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(405, ['error' => 'method_not_allowed']);

    $raw = file_get_contents('php://input');
    $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw); // BOM除去
    error_log('[debug] content-type=' . ($_SERVER['CONTENT_TYPE'] ?? ''));
    error_log('[debug] raw=' . $raw);
    $body = json_decode($raw, true);


  $body = json_decode($raw, true);
  if (!is_array($body)) json_out(400, ['error' => 'invalid_json']);

  $email = trim((string)($body['email'] ?? ''));
  $email_norm = norm_email($email);

  if ($email_norm === '' || !is_valid_email($email_norm)) {
    json_out(400, ['error' => 'invalid_email']);
  }

  $TTL_MIN = (int)(getenv('VERIFY_CODE_TTL_MIN') ?: 10);
  $COOLDOWN = (int)(getenv('VERIFY_RESEND_COOLDOWN_SEC') ?: 0);
  error_log('[debug] COOLDOWN=' . $COOLDOWN);

  $DEV_RETURN_CODE = bool_env('DEV_RETURN_CODE', false);

  $pdo = pdo();
  $cols = table_columns($pdo, 'email_verifications_sql');

  $has_code_hash = isset($cols['code_hash']) && isset($cols['salt']);
  $has_code_plain = isset($cols['code']);

  // 既存確認
    $st = $pdo->prepare("SELECT doc_id, verified_at, last_sent_at FROM email_verifications_sql WHERE email=? LIMIT 1");
    $st->execute([$email]);

  $existing = $st->fetch();
  error_log('[debug] last_sent_at=' . ($existing['last_sent_at'] ?? 'NULL'));


  // verified済みでも users が作成済みなら「登録済み」扱い（Node思想踏襲）:contentReference[oaicite:2]{index=2}
  if ($existing && !empty($existing['verified_at'])) {
    if (user_exists_by_email_norm($pdo, $email_norm)) {
      json_out(409, ['error' => 'already_registered']);
    }
    // users 未作成なら詰まり防止で再送可（この後UPSERTで verified_at をNULLに戻す）
  }

  // 再送クールダウン
  if ($existing && !empty($existing['last_sent_at'])) {
    $last = new DateTimeImmutable($existing['last_sent_at']);
    $diff = time() - $last->getTimestamp();
    if ($diff < $COOLDOWN) json_out(429, ['error' => 'too_many_requests']);
  }

  $code = gen6digits();
  $now = now_tokyo();
  $expires = $now->modify("+{$TTL_MIN} minutes");
  $doc_id = $existing ? (string)$existing['doc_id'] : uuid_v4();

  $status = 'sent';

  // 保存（カラム状況で切替）
  if ($has_code_hash) {
    $salt = bin2hex(random_bytes(16));
    $code_hash = sha256hex($salt . ':' . $code);

    $sql = "
        INSERT INTO email_verifications_sql
        (doc_id, email, code_hash, salt, expires_at, verified_at, attempts, sent_count, last_sent_at, status, created_at, updated_at, raw)
        VALUES
        (:doc_id, :email, :code_hash, :salt, :expires_at, NULL, 0, 1, :last_sent_at, :status, NOW(), NOW(),
        JSON_OBJECT('email', :email_raw, 'purpose', 'register'))
        ON DUPLICATE KEY UPDATE
        email        = VALUES(email),
        code_hash    = VALUES(code_hash),
        salt         = VALUES(salt),
        expires_at   = VALUES(expires_at),
        verified_at  = NULL,
        attempts     = 0,
        sent_count   = sent_count + 1,
        last_sent_at = VALUES(last_sent_at),
        status       = VALUES(status),
        updated_at   = NOW(),
        raw          = JSON_OBJECT('email', VALUES(email), 'purpose', 'register')
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([
    ':doc_id'       => $doc_id,
    ':email'        => $email,
    ':code_hash'    => $code_hash,
    ':salt'         => $salt,
    ':expires_at'   => $expires->format('Y-m-d H:i:s'),
    ':last_sent_at' => $now->format('Y-m-d H:i:s'),
    ':status'       => $status,
    ':email_raw'    => $email,
    ]);

  } elseif ($has_code_plain) {
    // テスト限定：code 平文保存（本番前に code_hash/salt へ統一）
    $sql = "
      INSERT INTO email_verifications_sql
        (doc_id, email, email_norm, code, expires_at, verified_at, attempts, sent_count, last_sent_at, status, created_at, updated_at, raw)
      VALUES
        (:doc_id, :email, :email_norm, :code, :expires_at, NULL, 0, 1, :last_sent_at, :status, NOW(), NOW(),
         JSON_OBJECT('email', :email_raw, 'email_norm', :email_norm_raw, 'purpose', 'register'))
      ON DUPLICATE KEY UPDATE
        email        = VALUES(email),
        code         = VALUES(code),
        expires_at   = VALUES(expires_at),
        verified_at  = NULL,
        attempts     = 0,
        sent_count   = sent_count + 1,
        last_sent_at = VALUES(last_sent_at),
        status       = VALUES(status),
        updated_at   = NOW(),
        raw          = JSON_OBJECT('email', VALUES(email), 'email_norm', email_norm, 'purpose', 'register')
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([
      ':doc_id' => $doc_id,
      ':email' => $email,
      ':email_norm' => $email_norm,
      ':code' => $code,
      ':expires_at' => $expires->format('Y-m-d H:i:s'),
      ':last_sent_at' => $now->format('Y-m-d H:i:s'),
      ':status' => $status,
      ':email_raw' => $email,
      ':email_norm_raw' => $email_norm,
    ]);
  } else {
    json_out(500, ['error' => 'schema_mismatch', 'detail' => 'email_verifications_sql has no code_hash/salt nor code']);
  }

  // テストはメール送信せず返す
  if ($DEV_RETURN_CODE) {
    json_out(200, ['ok' => true, 'devCode' => $code]);
  }

  // ===== ここから本番送信 =====
  $subject = "【Modern】認証コード";
  $text = "認証コードは {$code} です。\n"
        . "有効期限は {$TTL_MIN} 分です。\n\n"
        . "このメールに心当たりがない場合は破棄してください。";

  error_log('[mailer] sending to=' . $email);
  send_mail_smtp($email, $subject, $text);
  error_log('[mailer] sent ok to=' . $email);

  json_out(200, ['ok' => true]);



} catch (Throwable $e) {
  error_log('[register/email] ' . $e->getMessage());
  json_out(500, ['error' => 'internal_error', 'detail' => $e->getMessage()]);
}
