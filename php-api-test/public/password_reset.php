<?php
declare(strict_types=1);

/**
 * POST /api/password/reset
 * body: { selector, validator, password }
 */

require __DIR__ . '/bootstrap.php';

// ---- JSON 取得 ----
$body = json_body();
if (!$body) {
  json_out(400, ['error' => 'invalid_json']);
}

$selector  = trim((string)($body['selector']  ?? ''));
$validator = trim((string)($body['validator'] ?? ''));
$password  = (string)($body['password']  ?? '');

if ($selector === '' || $validator === '' || $password === '') {
  json_out(400, ['error' => 'missing_fields']);
}

if (strlen($password) < 8) {
  json_out(400, ['error' => 'weak_password']);
}

// ---- DB 接続 ----
$db = pdo();

// ---- トークン取得（未使用・最新）----
$stmt = $db->prepare(
  "SELECT *
     FROM password_resets_sql
    WHERE selector = ?
      AND used_at IS NULL
    LIMIT 1"
);
$stmt->execute([$selector]);
$row = $stmt->fetch();

if (!$row) {
  json_out(400, ['error' => 'invalid_token']);
}

// ---- 期限チェック ----
if (strtotime($row['expires_at']) < time()) {
  json_out(400, ['error' => 'expired']);
}

// ---- validator 照合 ----
// validator は生、token_hash は password_hash
if (!password_verify($validator, $row['token_hash'])) {
  json_out(400, ['error' => 'invalid_token']);
}

// ---- ユーザー存在確認 ----
$stmt = $db->prepare(
  "SELECT doc_id
     FROM users_sql
    WHERE email_norm = ?
    LIMIT 1"
);
$stmt->execute([$row['email_norm']]);
$user = $stmt->fetch();

if (!$user) {
  json_out(400, ['error' => 'user_not_found']);
}

// ---- パスワード更新 ----
$newHash = password_hash($password, PASSWORD_DEFAULT);

$db->beginTransaction();

$stmt = $db->prepare(
  "UPDATE users_sql
      SET password_hash = ?, updated_at = NOW()
    WHERE doc_id = ?"
);
$stmt->execute([$newHash, $user['doc_id']]);

// ---- トークン使用済みに ----
$stmt = $db->prepare(
  "UPDATE password_resets_sql
      SET used_at = NOW()
    WHERE doc_id = ?"
);
$stmt->execute([$row['doc_id']]);

$db->commit();

json_out(200, ['ok' => true]);
