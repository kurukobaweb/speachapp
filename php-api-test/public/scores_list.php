<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

/**
 * GET /api/scores
 * - admin/owner: 全件
 * - それ以外: 自分の分だけ
 *
 * 重要:
 * - duration_s を二重 alias で上書きしない
 * - taken_at を返す
 */

$payload = require_auth();

$role = strtolower((string)($payload['role'] ?? 'user'));
$userId = (string)($payload['uid'] ?? $payload['userId'] ?? $payload['id'] ?? $payload['sub'] ?? '');

if ($userId === '') {
  json_out(400, ['ok'=>false, 'error'=>'missing_user_id']);
}

$isAdminLike = in_array($role, ['admin','owner'], true);

$pdo = pdo();

// 件数
$limit = (int)($_GET['limit'] ?? 5000);
if ($limit <= 0 || $limit > 50000) $limit = 5000;

/**
 * duration_s の「別名吸収」を正しくやる
 * - duration_s があるならそれ
 * - duration_sec があるならそれも拾って COALESCE
 */
$cols = $pdo->query("
  SELECT COLUMN_NAME
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_scores_sql'
")->fetchAll(PDO::FETCH_COLUMN);
$has = array_flip($cols);

$durationExpr = "NULL";
if (isset($has['duration_s']) && isset($has['duration_sec'])) {
  $durationExpr = "COALESCE(duration_s, duration_sec)";
} elseif (isset($has['duration_s'])) {
  $durationExpr = "duration_s";
} elseif (isset($has['duration_sec'])) {
  $durationExpr = "duration_sec";
}

// doc_id が主キーなので、id は doc_id を返す（上書き事故防止）
$select = "
  doc_id AS id,
  doc_id,
  user_id,
  theme_id,
  score,
  status,
  is_pass,
  {$durationExpr} AS duration_s,
  taken_at,
  updated_at,
  created_at,
  char_count,
  transcript_raw,
  transcript_hira
";

// 並び順：更新があればそれ、なければ taken_at
$orderBy = "COALESCE(updated_at, taken_at, created_at) DESC";

if ($isAdminLike) {
  $sql = "SELECT {$select} FROM user_scores_sql ORDER BY {$orderBy} LIMIT {$limit}";
  $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
} else {
  $sql = "SELECT {$select} FROM user_scores_sql WHERE user_id = :uid ORDER BY {$orderBy} LIMIT {$limit}";
  $st = $pdo->prepare($sql);
  $st->execute([':uid' => $userId]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC);
}

json_out(200, [
  'ok' => true,
  'items' => $rows,
]);
