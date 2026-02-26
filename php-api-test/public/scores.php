<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

/**
 * POST /api/scores
 * - user_id は JWT から強制
 * - uq_user_theme (user_id, theme_id) がある前提で UPSERT
 */

function jwt_payload(): array {
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

try {
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  if ($method !== 'POST') {
    json_out(405, ['ok'=>false, 'error'=>'method_not_allowed']);
  }

  $payload = jwt_payload();
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
  if ($userId === '') {
    json_out(400, ['ok'=>false, 'error'=>'missing_user_id']);
  }

  $pdo = pdo();

  $body = json_body();
  if (!is_array($body)) {
    json_out(400, ['ok'=>false, 'error'=>'invalid_json']);
  }

  $themeId = (string)($body['theme_id'] ?? '');
  if ($themeId === '') {
    json_out(400, ['ok'=>false, 'error'=>'missing_theme_id']);
  }

  $score      = isset($body['score']) ? (int)$body['score'] : null;
  $isPass     = !empty($body['is_pass']) ? 1 : 0;
  $status     = (string)($body['status'] ?? 'completed');
  $durationS  = isset($body['duration_s']) ? (int)$body['duration_s'] : null;
  $charCount  = isset($body['char_count']) ? (int)$body['char_count'] : null;
  $trRaw      = isset($body['transcript_raw']) ? (string)$body['transcript_raw'] : null;
  $trHira     = isset($body['transcript_hira']) ? (string)$body['transcript_hira'] : null;

  $rawJson = null;
  if (array_key_exists('raw', $body)) {
    $rawJson = json_encode($body['raw'], JSON_UNESCAPED_UNICODE);
    if ($rawJson === false) $rawJson = null;
  }

  // ★ uq_user_theme (user_id, theme_id) で UPSERT
  $sql = "
    INSERT INTO user_scores_sql
    (
      user_id,
      theme_id,
      score,
      is_pass,
      status,
      duration_s,
      char_count,
      transcript_raw,
      transcript_hira,
      raw,
      taken_at,
      created_at
    )
    VALUES
    (
      :user_id,
      :theme_id,
      :score,
      :is_pass,
      :status,
      :duration_s,
      :char_count,
      :transcript_raw,
      :transcript_hira,
      :raw,
      NOW(),
      NOW()
    )
    ON DUPLICATE KEY UPDATE
      score          = VALUES(score),
      is_pass        = VALUES(is_pass),
      status         = VALUES(status),
      duration_s     = VALUES(duration_s),
      char_count     = VALUES(char_count),
      transcript_raw = VALUES(transcript_raw),
      transcript_hira= VALUES(transcript_hira),
      raw            = VALUES(raw),
      taken_at       = NOW()
  ";

  $st = $pdo->prepare($sql);
  $st->execute([
    ':user_id'         => $userId,
    ':theme_id'        => $themeId,
    ':score'           => $score,
    ':is_pass'         => $isPass,
    ':status'          => $status,
    ':duration_s'      => $durationS,
    ':char_count'      => $charCount,
    ':transcript_raw'  => $trRaw,
    ':transcript_hira' => $trHira,
    ':raw'             => $rawJson,
  ]);

  json_out(200, ['ok' => true]);

} catch (Throwable $e) {
  error_log('[scores.php] '.$e->getMessage());
  json_out(500, [
    'ok'=>false,
    'error'=>'internal_error',
    'detail'=>$e->getMessage()
  ]);
}
