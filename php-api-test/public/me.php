<?php
declare(strict_types=1);

/**
 * GET /api/me : JWT sub から自分の users_sql を返す
 */
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

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') json_out(405, ['ok'=>false,'error'=>'method_not_allowed']);

$p = bearer_payload();
if (!$p) json_out(401, ['ok'=>false,'error'=>'unauthorized']);

$sub = (string)($p['sub'] ?? '');
if ($sub === '') json_out(401, ['ok'=>false,'error'=>'unauthorized','detail'=>'missing_sub']);

$pdo = pdo();
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
$st->execute([':id'=>$sub]);
$row = $st->fetch(PDO::FETCH_ASSOC);

$user = $row ? [
  'id'           => (string)$row['doc_id'],
  'doc_id'       => (string)$row['doc_id'],
  'email'        => (string)($row['email'] ?? ''),
  'display_name' => (string)($row['display_name'] ?? ''),
  'name'         => (string)($row['display_name'] ?? ''),
  'affiliation'  => (string)($row['affiliation'] ?? ''),
  'role'         => (string)($row['role'] ?? 'user'),
  'course_id'    => (string)($row['course_id'] ?? ''),
  'status'       => (string)($row['status'] ?? ''),
  'created_at'   => $row['created_at'] ?? null,
  'updated_at'   => $row['updated_at'] ?? null,
] : null;

json_out(200, ['ok'=>true,'payload'=>$p,'user'=>$user]);
