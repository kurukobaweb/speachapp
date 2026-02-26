<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

try {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(405, ['error' => 'method_not_allowed']);

  $raw = file_get_contents('php://input');
  $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
  $body = json_decode($raw, true);
  if (!is_array($body)) json_out(400, ['error' => 'invalid_json']);

  $email = trim((string)($body['email'] ?? ''));
  $email_norm = norm_email($email);

  if ($email_norm === '' || !is_valid_email($email_norm)) {
    json_out(400, ['error' => 'invalid_email']);
  }

  $pdo = pdo();

  // ユーザー存在チェック（ただし「存在しない」とは返さない：アカウント列挙対策）
  $st = $pdo->prepare("SELECT doc_id FROM users_sql WHERE email_norm = ? LIMIT 1");
  $st->execute([$email_norm]);
  $user = $st->fetch();

  // レート制限（同一メールの最終送信から N 秒未満なら 429）
  $COOLDOWN = (int)(getenv('PWD_RESET_COOLDOWN_SEC') ?: 60);
  $TTL_MIN  = (int)(getenv('PWD_RESET_TTL_MIN') ?: 30);

  $st = $pdo->prepare("
    SELECT last_sent_at
      FROM password_resets_sql
     WHERE email_norm = ?
     ORDER BY created_at DESC
     LIMIT 1
  ");
  $st->execute([$email_norm]);
  $row = $st->fetch();
  if ($row && !empty($row['last_sent_at'])) {
    $last = strtotime((string)$row['last_sent_at']);
    if ($last && (time() - $last) < $COOLDOWN) {
      json_out(429, ['error' => 'too_many_requests']);
    }
  }

  // トークン生成（生トークンはDBに保存しない：ハッシュのみ）
  $token = bin2hex(random_bytes(32)); // 64 hex chars
  $salt  = bin2hex(random_bytes(16));
  $token_hash = hash('sha256', $salt . ':' . $token);

  // 期限
  $expires_at = date('Y-m-d H:i:s', time() + $TTL_MIN * 60);

  // 既存の未使用トークンは無効化しても良い（任意）
  $pdo->prepare("
    UPDATE password_resets_sql
       SET used_at = NOW()
     WHERE email_norm = ?
       AND used_at IS NULL
  ")->execute([$email_norm]);

  // INSERT
  $doc_id = bin2hex(random_bytes(16));
  $pdo->prepare("
    INSERT INTO password_resets_sql
      (doc_id, email_norm, token_hash, salt, expires_at, used_at, last_sent_at, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, NULL, NOW(), NOW(), NOW())
  ")->execute([$doc_id, $email_norm, $token_hash, $salt, $expires_at]);

  // メール送信（ユーザーがいない場合でも OK を返す：列挙対策）
  $frontBase = getenv('FRONT_BASE_URL') ?: 'http://localhost:8100';
  $resetUrl  = rtrim($frontBase, '/') . 'html//reset-password.html?token=' . urlencode($token);

  // 件名・本文（必要に応じて文面を調整）
  $subject = '【笈川式アプリ】パスワード再設定';
  $text = "パスワード再設定のご依頼を受け付けました。\n\n"
        . "以下のリンクから、新しいパスワードを設定してください（有効期限: {$TTL_MIN}分）。\n"
        . $resetUrl . "\n\n"
        . "このメールに心当たりがない場合は破棄してください。";

  if ($user) {
    // register_email.php と同じ送信関数を使う想定（関数名はあなたの実装に合わせて）
    send_mail_smtp($email_norm, $subject, $text);
  }

  json_out(200, ['ok' => true]);

} catch (Throwable $e) {
  error_log('[password-reset/request] ' . $e->getMessage());
  json_out(500, ['error' => 'internal_error']);
}
