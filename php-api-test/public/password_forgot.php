<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
/**
 * POST /api/password/forgot
 * body: { "email": "..." }
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_out(405, ['error' => 'method_not_allowed']);
}

$data = json_body();
if (!is_array($data)) {
  json_out(400, ['error' => 'invalid_json']);
}

$email = trim((string)($data['email'] ?? ''));
if ($email === '') {
  json_out(400, ['error' => 'missing_fields', 'fields' => ['email']]);
}

$email_norm = strtolower($email);

$pdo = pdo();

/* ---------------------------------------
 * ユーザー存在確認（存在しなくても成功扱い）
 * ------------------------------------- */
$st = $pdo->prepare("SELECT doc_id FROM users_sql WHERE email_norm=? LIMIT 1");
$st->execute([$email_norm]);
$user = $st->fetch();

if (!$user) {
  // セキュリティ：存在しなくてもOKを返す
  json_out(200, ['ok' => true]);
}

/* ---------------------------------------
 * selector + validator 発行
 * ------------------------------------- */
$selector  = bin2hex(random_bytes(12));  // 24 chars
$validator = bin2hex(random_bytes(32));  // 64 chars
$token_hash = password_hash($validator, PASSWORD_DEFAULT);

$now = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
$expires_at = (new DateTimeImmutable('+30 minutes'))->format('Y-m-d H:i:s');

/* ---------------------------------------
 * 既存未使用を無効化
 * ------------------------------------- */
$pdo->prepare(
  "UPDATE password_resets_sql
   SET used_at = ?
   WHERE email_norm = ? AND used_at IS NULL"
)->execute([$now, $email_norm]);

/* ---------------------------------------
 * 新規作成（重要：email_norm は INSERT しない）
 * raw が NOT NULL の場合も必ず入れる
 * ------------------------------------- */
$rawJson = json_encode([
  'email' => $email,
  'ip'    => $_SERVER['REMOTE_ADDR'] ?? null,
  'ua'    => $_SERVER['HTTP_USER_AGENT'] ?? null,
], JSON_UNESCAPED_UNICODE);

$sql = "INSERT INTO password_resets_sql
        (doc_id, email, selector, token_hash, expires_at, created_at, raw)
        VALUES (UUID(), ?, ?, ?, ?, ?, CAST(? AS JSON))";

$pdo->prepare($sql)->execute([
  $email,
  $selector,
  $token_hash,
  $expires_at,
  $now,
  $rawJson
]);

/* ---------------------------------------
 * メール送信
 * ------------------------------------- */
$appOrigin = rtrim($_ENV['APP_ORIGIN'] ?? getenv('APP_ORIGIN') ?: 'http://localhost:8100', '/');

$resetUrl = "{$appOrigin}/html/reset-password.html?selector={$selector}&validator={$validator}";

$m = mailer();
$m->addAddress($email);
$m->Subject = '【日本語スピーチ判定】パスワード再設定';
$m->Body = "以下のリンクからパスワードを再設定してください。\n\n{$resetUrl}\n\n※このリンクは30分間有効です。";

if (!$m->send()) {
  error_log('[password/forgot] mail error: ' . $m->ErrorInfo);
  json_out(500, ['error' => 'mail_failed']);
}

json_out(200, ['ok' => true]);
