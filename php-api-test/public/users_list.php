<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

/**
 * GET /api/scores
 * - admin/owner: 全件
 * - user/teacher: 自分の分のみ（user_idで絞る）
 */

function jwt_payload_scores_list(): array {
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

function colOrNull(array $has, string $col, string $as): string {
  return isset($has[$col]) ? "`$col` AS `$as`" : "NULL AS `$as`";
}

try {
  $payload = jwt_payload_scores_list();
  if (!$payload) {
    json_out(401, ['ok'=>false, 'error'=>'unauthorized']);
  }

  $userId = (string)(
    $payload['uid']
    ?? $payload['userId']
    ?? $payload['id']
    ?? $payload['sub']
    ?? ''
  );
  $role = strtolower((string)($payload['role'] ?? 'user'));

  if ($userId === '') {
    json_out(400, ['ok'=>false, 'error'=>'missing_user_id']);
  }

  $pdo = pdo();

  // 件数
  $limit = (int)($_GET['limit'] ?? 5000);
  if ($limit <= 0 || $limit > 50000) $limit = 5000;

  // user_scores_sql の列一覧
  $cols = $pdo->query("
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_scores_sql'
  ")->fetchAll(PDO::FETCH_COLUMN);
  $has = array_flip($cols);

  // フロントが拾えるキーに寄せて返す
  $select = implode(",\n", [
    colOrNull($has, 'id',            'id'),
    colOrNull($has, 'doc_id',        'id'), // idが無い場合の保険（重複してもOK）
    colOrNull($has, 'user_id',       'user_id'),
    colOrNull($has, 'theme_id',      'theme_id'),
    colOrNull($has, 'score',         'score'),
    colOrNull($has, 'duration_s',    'duration_s'),
    colOrNull($has, 'duration_sec',  'duration_s'), // 別名吸収
    colOrNull($has, 'is_pass',       'is_pass'),
    colOrNull($has, 'status',        'status'),
    colOrNull($has, 'level',         'level'),
    colOrNull($has, 'type',          'type'),
    colOrNull($has, 'sub',           'sub'),
    colOrNull($has, 'no',            'no'),
    colOrNull($has, 'display_id',    'display_id'),
    colOrNull($has, 'memo',          'memo'),
    colOrNull($has, 'char_count',    'char_count'),
    colOrNull($has, 'transcript_raw','transcript_raw'),
    colOrNull($has, 'transcript_hira','transcript_hira'),
    colOrNull($has, 'taken_at',      'taken_at'),
    colOrNull($has, 'evaluated_at',  'evaluated_at'),
    colOrNull($has, 'created_at',    'created_at'),
    colOrNull($has, 'updated_at',    'updated_at'),
  ]);

  // 並び順（存在する列で決める）
  $orderBy = '1';
  foreach (['taken_at','evaluated_at','updated_at','created_at'] as $c) {
    if (isset($has[$c])) { $orderBy = "`$c` DESC"; break; }
  }

  $isAdminLike = in_array($role, ['admin','owner'], true);

  if ($isAdminLike) {
    $sql = "SELECT $select FROM user_scores_sql ORDER BY $orderBy LIMIT $limit";
    $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
  } else {
    // ★ここが重要：一般ユーザーは自分だけ
    $sql = "SELECT $select FROM user_scores_sql WHERE user_id = :uid ORDER BY $orderBy LIMIT $limit";
    $st = $pdo->prepare($sql);
    $st->execute([':uid' => $userId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
  }

  // id がNULLになるケースの保険
  foreach ($rows as &$r) {
    if (empty($r['id']) && !empty($r['doc_id'])) $r['id'] = $r['doc_id'];
  }
  unset($r);

  json_out(200, [
    'ok' => true,
    'items' => $rows,
  ]);

} catch (Throwable $e) {
  error_log('[scores_list.php] '.$e->getMessage());
  json_out(500, ['ok'=>false, 'error'=>'internal_error', 'detail'=>$e->getMessage()]);
}
