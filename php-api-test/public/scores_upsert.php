<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

/**
 * POST /api/scores
 * body: {
 *   user_id, theme_id, score, is_pass, duration_s, char_count,
 *   level, type, sub, display_id,
 *   transcript_raw, transcript_hira, raw
 * }
 */

$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(.+)$/i', $auth)) {
  json_out(401, ['ok' => false, 'error' => 'unauthorized']);
}

$body = json_body();
if (!$body) json_out(400, ['ok' => false, 'error' => 'invalid_json']);

$user_id  = trim((string)($body['user_id'] ?? ''));
$theme_id = trim((string)($body['theme_id'] ?? ''));
if ($user_id === '' || $theme_id === '') {
  json_out(400, ['ok' => false, 'error' => 'missing_user_or_theme']);
}

$score      = (int)($body['score'] ?? 0);
$is_pass    = (int)($body['is_pass'] ?? 0);
$duration_s = (int)($body['duration_s'] ?? 0);
$char_count = (int)($body['char_count'] ?? 0);

$level      = isset($body['level']) ? (string)$body['level'] : null;
$type       = isset($body['type']) ? (string)$body['type'] : null;
$sub        = isset($body['sub']) ? (string)$body['sub'] : null;
$display_id = isset($body['display_id']) ? (string)$body['display_id'] : null;

$tr_raw  = isset($body['transcript_raw'])  ? (string)$body['transcript_raw']  : null;
$tr_hira = isset($body['transcript_hira']) ? (string)$body['transcript_hira'] : null;

$raw_json = null;
if (isset($body['raw'])) {
  $raw_json = json_encode($body['raw'], JSON_UNESCAPED_UNICODE);
  if ($raw_json === false) $raw_json = null;
}

$db = pdo();

// doc_id は user×theme で固定生成（既存があれば更新）
$doc_id = substr(hash('sha256', $user_id . '::' . $theme_id), 0, 32);

$stmt = $db->prepare("
  INSERT INTO scores_sql (
    doc_id, user_id, theme_id,
    level, type, sub, display_id,
    score, is_pass, duration_s, char_count,
    transcript_raw, transcript_hira, raw,
    created_at, updated_at
  ) VALUES (
    :doc_id, :user_id, :theme_id,
    :level, :type, :sub, :display_id,
    :score, :is_pass, :duration_s, :char_count,
    :tr_raw, :tr_hira, :raw,
    NOW(), NOW()
  )
  ON DUPLICATE KEY UPDATE
    level=VALUES(level),
    type=VALUES(type),
    sub=VALUES(sub),
    display_id=VALUES(display_id),
    score=VALUES(score),
    is_pass=VALUES(is_pass),
    duration_s=VALUES(duration_s),
    char_count=VALUES(char_count),
    transcript_raw=VALUES(transcript_raw),
    transcript_hira=VALUES(transcript_hira),
    raw=VALUES(raw),
    updated_at=NOW()
");
$stmt->execute([
  ':doc_id'     => $doc_id,
  ':user_id'    => $user_id,
  ':theme_id'   => $theme_id,
  ':level'      => $level,
  ':type'       => $type,
  ':sub'        => $sub,
  ':display_id' => $display_id,
  ':score'      => $score,
  ':is_pass'    => $is_pass ? 1 : 0,
  ':duration_s' => $duration_s,
  ':char_count' => $char_count,
  ':tr_raw'     => $tr_raw,
  ':tr_hira'    => $tr_hira,
  ':raw'        => $raw_json,
]);

json_out(200, ['ok' => true, 'doc_id' => $doc_id]);
