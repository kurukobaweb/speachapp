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
$pdo = pdo();

if ($method === 'GET') {
  $st = $pdo->query("
    SELECT
      doc_id,
      email,
      display_name,
      affiliation,
      role,
      course_id, 
      status,
      course_id,
      created_at,
      updated_at
    FROM users_sql
    ORDER BY created_at DESC
  ");
  $rows = $st->fetchAll(PDO::FETCH_ASSOC);

  // admin.js は id / name / affiliation / email / role を見ます（互換のため寄せる） :contentReference[oaicite:1]{index=1}
    $users = array_map(fn($r)=>[
    'id' => (string)$r['doc_id'],
    'doc_id' => (string)$r['doc_id'],
    'email' => (string)($r['email'] ?? ''),
    'display_name' => (string)($r['display_name'] ?? ''),
    'name' => (string)($r['display_name'] ?? ''),
    'affiliation' => (string)($r['affiliation'] ?? ''),
    'role' => (string)($r['role'] ?? 'user'),
    'course_id' => (string)($r['course_id'] ?? 'free'), // ★ 追加（超重要）
    'status' => (string)($r['status'] ?? ''),
    'created_at' => $r['created_at'],
    'updated_at' => $r['updated_at'],
    ], $rows);


  json_out(200, ['ok'=>true, 'users'=>$users]);
}

if ($method === 'POST') {
  $b = json_body();
  if (!is_array($b)) json_out(400, ['ok'=>false,'error'=>'invalid_json']);

  $email = trim((string)($b['email'] ?? ''));
  $name  = trim((string)($b['display_name'] ?? $b['name'] ?? ''));
  $aff   = trim((string)($b['affiliation'] ?? ''));
  $role  = trim((string)($b['role'] ?? 'user'));
  $pass  = (string)($b['password'] ?? '');

  if ($email === '' || $pass === '') json_out(400, ['ok'=>false,'error'=>'missing_email_or_password']);
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_out(400, ['ok'=>false,'error'=>'invalid_email']);

  $role = in_array($role, ['user','teacher','admin','owner'], true) ? $role : 'user';
  $doc_id = bin2hex(random_bytes(16));
  $hash = password_hash($pass, PASSWORD_DEFAULT);

  try {
    $st = $pdo->prepare("
      INSERT INTO users_sql (doc_id, email, display_name, affiliation, role, password_hash, created_at, updated_at, raw)
      VALUES (:doc_id, :email, :display_name, :affiliation, :role, :password_hash, NOW(), NOW(), JSON_OBJECT())
    ");
    $st->execute([
      ':doc_id'=>$doc_id,
      ':email'=>$email,
      ':display_name'=>$name,
      ':affiliation'=>$aff,
      ':role'=>$role,
      ':password_hash'=>$hash,
    ]);
  } catch (Throwable $e) {
    // email UNIQUE想定
    json_out(409, ['ok'=>false,'error'=>'create_failed','detail'=>$e->getMessage()]);
  }

  json_out(200, ['ok'=>true, 'id'=>$doc_id]);
}

json_out(405, ['ok'=>false,'error'=>'method_not_allowed']);
