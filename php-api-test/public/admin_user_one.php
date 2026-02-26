<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

function bearer_payload(): array {
  $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
  if (!preg_match('/^Bearer\s+(.+)$/i', $h, $m)) return [];
  $t = $m[1];
  $parts = explode('.', $t);
  if (count($parts) < 2) return [];
  $b64 = strtr($parts[1], '-_', '+/');
  $pad = strlen($b64) % 4;
  if ($pad) $b64 .= str_repeat('=', 4 - $pad);
  $json = base64_decode($b64, true);
  if ($json === false) return [];
  $p = json_decode($json, true);
  return is_array($p) ? $p : [];
}

function require_admin_role(): array {
  $p = bearer_payload();
  if (!$p) json_out(401, ['ok'=>false,'error'=>'unauthorized']);
  $role = strtolower((string)($p['role'] ?? 'user'));
  if (!in_array($role, ['admin','owner'], true)) {
    json_out(403, ['ok'=>false,'error'=>'forbidden','detail'=>'admin_only']);
  }
  return $p;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
require_admin_role();

$id = (string)($_GET['admin_user_id'] ?? '');
if ($id === '') json_out(400, ['ok'=>false,'error'=>'missing_id']);

$pdo = pdo();

if ($method === 'PUT') {
  $b = json_body();
  if (!is_array($b)) json_out(400, ['ok'=>false,'error'=>'invalid_json']);

  $fields = [];
  $params = [':doc_id' => $id];

  // display_name（互換：name でも受ける）
  if (array_key_exists('display_name', $b) || array_key_exists('name', $b)) {
    $fields[] = "display_name = :display_name";
    $params[':display_name'] = trim((string)($b['display_name'] ?? $b['name'] ?? ''));
  }

  // affiliation
  if (array_key_exists('affiliation', $b)) {
    $fields[] = "affiliation = :affiliation";
    $params[':affiliation'] = trim((string)$b['affiliation']);
  }

  // email
  if (array_key_exists('email', $b)) {
    $email = trim((string)$b['email']);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
      json_out(400, ['ok'=>false,'error'=>'invalid_email']);
    }
    $fields[] = "email = :email";
    $params[':email'] = $email;
  }

  // role
  if (array_key_exists('role', $b)) {
    $role = trim((string)$b['role']);
    $role = in_array($role, ['user','teacher','admin','owner'], true) ? $role : 'user';
    $fields[] = "role = :role";
    $params[':role'] = $role;
  }

  // ★ course_id（ここを追加）
  // admin.js から course_id が送られてきた時に DB に保存する
  if (array_key_exists('course_id', $b)) {
    $course = trim((string)$b['course_id']);
    if ($course === '') $course = 'free'; // 空なら free に寄せる（運用次第で変更OK）
    $fields[] = "course_id = :course_id";
    $params[':course_id'] = $course;
  }

  // password
  if (!empty($b['password'])) {
    $fields[] = "password_hash = :password_hash";
    $params[':password_hash'] = password_hash((string)$b['password'], PASSWORD_DEFAULT);
  }

  if (!$fields) json_out(400, ['ok'=>false,'error'=>'no_fields']);

  $sql = "UPDATE users_sql SET " . implode(", ", $fields) . ", updated_at=NOW() WHERE doc_id=:doc_id";

  try {
    $st = $pdo->prepare($sql);
    $st->execute($params);
  } catch (Throwable $e) {
    json_out(409, ['ok'=>false,'error'=>'update_failed','detail'=>$e->getMessage()]);
  }

  json_out(200, ['ok'=>true]);
}

if ($method === 'DELETE') {
  $st = $pdo->prepare("DELETE FROM users_sql WHERE doc_id = :doc_id");
  $st->execute([':doc_id'=>$id]);
  json_out(200, ['ok'=>true]);
}

json_out(405, ['ok'=>false,'error'=>'method_not_allowed']);
