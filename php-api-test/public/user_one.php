<?php
declare(strict_types=1);

/**
 * user_one.php
 * GET  /api/users/{user_id}
 * PUT  /api/users/{user_id}
 */

require_once __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$pdo    = pdo();

/**
 * index.php が
 *   $_GET['user_id'] = {uuid}
 * をセットしてから require してくる前提
 */
$userId = (string)($_GET['user_id'] ?? '');
if ($userId === '') {
  json_out(400, ['ok'=>false,'error'=>'missing_user_id']);
}

/* -----------------------------
 * 認証・権限
 * --------------------------- */
$payload = require_auth();          // ★ bootstrap.php の関数
$sub     = (string)($payload['sub'] ?? '');
$role    = strtolower((string)($payload['role'] ?? 'user'));
$admin   = in_array($role, ['admin','owner'], true);

// 本人 or admin/owner のみ許可
if (!$admin && $sub !== $userId) {
  json_out(403, ['ok'=>false,'error'=>'forbidden','detail'=>'self_only']);
}

/* -----------------------------
 * GET: プロフィール取得
 * --------------------------- */
if ($method === 'GET') {

  $st = $pdo->prepare("
    SELECT
      doc_id,
      email,
      display_name,
      affiliation,
      role,
      course_id,
      status,
      created_at,
      updated_at
    FROM users_sql
    WHERE doc_id = :id
    LIMIT 1
  ");
  $st->execute([':id' => $userId]);
  $row = $st->fetch(PDO::FETCH_ASSOC);

  if (!$row) {
    json_out(404, ['ok'=>false,'error'=>'not_found']);
  }

  json_out(200, [
    'ok' => true,
    'user' => [
      'id'           => (string)$row['doc_id'],
      'doc_id'       => (string)$row['doc_id'],
      'email'        => (string)($row['email'] ?? ''),
      'display_name' => (string)($row['display_name'] ?? ''),
      'name'         => (string)($row['display_name'] ?? ''),
      'affiliation'  => (string)($row['affiliation'] ?? ''),
      'role'         => (string)($row['role'] ?? 'user'),
      'course_id'    => (string)($row['course_id'] ?? ''),
      'status'       => (string)($row['status'] ?? ''),
      'created_at'   => $row['created_at'],
      'updated_at'   => $row['updated_at'],
    ]
  ]);
}

/* -----------------------------
 * PUT: プロフィール更新
 * --------------------------- */
if ($method === 'PUT') {

  $input = json_body();
  if (!is_array($input)) {
    json_out(400, ['ok'=>false,'error'=>'invalid_json']);
  }

  $fields = [];
  $params = [':id' => $userId];

  // 本人でも変更可
  if (isset($input['display_name']) || isset($input['name'])) {
    $name = trim((string)($input['display_name'] ?? $input['name']));
    $fields[] = 'display_name = :display_name';
    $params[':display_name'] = $name;
  }

  if (isset($input['affiliation'])) {
    $fields[] = 'affiliation = :affiliation';
    $params[':affiliation'] = trim((string)$input['affiliation']);
  }

// ★ password 変更（本人でもOK）
if (!empty($input['password'])) {
  $fields[] = 'password_hash = :password_hash';
  $params[':password_hash'] = password_hash((string)$input['password'], PASSWORD_DEFAULT);
}


  // admin/owner のみ
  if ($admin && (isset($input['course_id']) || isset($input['courseId']))) {
    $fields[] = 'course_id = :course_id';
    $params[':course_id'] = trim((string)($input['course_id'] ?? $input['courseId']));
  }

  if ($admin && isset($input['role'])) {
    $r = strtolower(trim((string)$input['role']));
    if (!in_array($r, ['user','teacher','admin','owner'], true)) {
      json_out(400, ['ok'=>false,'error'=>'invalid_role']);
    }
    $fields[] = 'role = :role';
    $params[':role'] = $r;
  }

  if ($admin && isset($input['status'])) {
    $fields[] = 'status = :status';
    $params[':status'] = trim((string)$input['status']);
  }

  if (!$fields) {
    json_out(400, ['ok'=>false,'error'=>'no_fields_to_update']);
  }

  $sql = "UPDATE users_sql
          SET " . implode(', ', $fields) . ",
              updated_at = NOW()
          WHERE doc_id = :id";

  $pdo->prepare($sql)->execute($params);

  json_out(200, ['ok'=>true]);
}

json_out(405, ['ok'=>false,'error'=>'method_not_allowed']);
