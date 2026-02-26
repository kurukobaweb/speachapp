<?php
// C:\Users\saiki\php-api-test\handlers\account_delete.php
// 方針：JWT（Bearer）で本人特定済みなので、削除の追加確認は「email + password」のみ。
//       username は受け取っても検証しない（= nameカラム不一致問題を根絶）。

header('Content-Type: application/json; charset=utf-8');

// JSON body
$raw  = file_get_contents('php://input');
$body = json_decode($raw, true) ?: [];

// username は受け取るが、照合しない（UI確認用）
$username = trim((string)($body['username'] ?? ''));

// email / password は必須
$inEmail = mb_strtolower(trim((string)($body['email'] ?? '')));
$inPass  = (string)($body['password'] ?? '');

if ($inEmail === '' || $inPass === '') {
  json_out(400, ['ok' => false, 'error' => 'validation']);
  exit;
}

// 認証（index.php 側の関数を利用）
// Authorization: Bearer ... が無ければここで unauthorized
$payload = require_auth_payload();
$sub = (string)($payload['sub'] ?? '');
if ($sub === '') {
  json_out(401, ['ok' => false, 'error' => 'unauthorized']);
  exit;
}

// ユーザー取得（index.php 側の関数）
// ※ doc_id = sub を前提
$user = fetch_user_by_doc_id($pdo, $sub);
if (!$user) {
  json_out(401, ['ok' => false, 'error' => 'unauthorized']);
  exit;
}

// admin/owner は削除不可にする（必要なら）
// 既に要件があれば残す。不要ならこのブロックごと削除してOK。
$role = strtolower((string)($user['role'] ?? 'user'));
if (in_array($role, ['admin', 'owner'], true)) {
  json_out(403, ['ok' => false, 'error' => 'forbidden_role']);
  exit;
}

// email 照合（DB実体に合わせる）
$dbEmail = mb_strtolower(trim((string)($user['email'] ?? '')));
$emailOk = ($dbEmail !== '' && $dbEmail === $inEmail);

// password 照合（カラム揺れにも対応）
$hash = (string)(($user['password_hash'] ?? '') ?: ($user['password'] ?? ''));
$pwOk = ($hash !== '' && password_verify($inPass, $hash));

// 追加：入力パスの状態だけ（値は出さない）
$passLen = strlen($inPass);
$passHasSpace = preg_match('/\s/u', $inPass) ? true : false;

if (!$emailOk || !$pwOk) {
  json_out(400, [
    'ok'=>false,
    'error'=>'invalid_credentials',
    'debug'=>[
      'email_ok' => $emailOk,
      'pw_ok' => $pwOk,
      'pass_len' => $passLen,
      'pass_has_space' => $passHasSpace,
      'hash_prefix' => substr($hash, 0, 4), // "$2y$" などだけ確認用
    ]
  ]);
  exit;
}


// 削除処理（関連テーブルは必要に応じて追加）
try {
  $pdo->beginTransaction();

  // 例：スコア等を持っているならここで消す（カラム名はあなたの実テーブルに合わせて）
  // $stmt = $pdo->prepare("DELETE FROM user_scores_sql WHERE user_doc_id = ?");
  // $stmt->execute([$sub]);

  // ユーザー削除
  $stmt = $pdo->prepare("DELETE FROM users_sql WHERE doc_id = ? LIMIT 1");
  $stmt->execute([$sub]);

  $pdo->commit();

  json_out(200, ['ok' => true]);
  exit;

} catch (Throwable $e) {
  $pdo->rollBack();
  json_out(500, ['ok' => false, 'error' => 'server_error']);
  exit;
}
