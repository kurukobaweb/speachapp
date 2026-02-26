<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

try {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(405, ['error' => 'method_not_allowed']);

  $raw = file_get_contents('php://input');
  $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
  $body = json_decode($raw, true);
  if (!is_array($body)) json_out(400, ['error' => 'invalid_json']);

  $token = trim((string)($body['token'] ?? ''));
  $newPassword = (string)($body['newPassword'] ?? '');

  if ($token === '') json_out(400, ['error' => 'token_required']);
  if (strlen($newPassword) < 8) json_out(400, ['error' => 'password_too_short']);

  $pdo = pdo();

  // token から一致行を探す（salt が必要なので token_hash だけでは引けない設計の場合は「token_hashを直接保存して検索」でOK）
  // ここでは「直近の未使用候補を email なしで探す」ため、token_hash で検索できる構造を推奨。
  // => よって password_resets_sql に token_hash を保存し、token_hash で引けるようにする。
  $st = $pdo->prepare("
    SELECT doc_id, email_norm, salt, expires_at, used_at
      FROM password_resets_sql
     WHERE used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 50
  ");
  $st->execute();
  $cands = $st->fetchAll();

  $hit = null;
  foreach ($cands as $r) {
    $calc = hash('sha256', $r['salt'] . ':' . $token);
    // timing attack を気にするなら hash_equals 推奨
    $st2 = $pdo->prepare("SELECT token_hash FROM password_resets_sql WHERE doc_id=? LIMIT 1");
    $st2->execute([$r['doc_id']]);
    $th = (string)$st2->fetchColumn();
    if ($th !== '' && hash_equals($th, $calc)) {
      $hit = $r;
      break;
    }
  }

  if (!$hit) json_out(400, ['error' => 'invalid_token']);

  // 期限チェック
  if (!empty($hit['expires_at']) && strtotime((string)$hit['expires_at']) < time()) {
    json_out(400, ['error' => 'token_expired']);
  }

  $email_norm = (string)$hit['email_norm'];

  // users_sql のパスワード列（例：password_hash）を更新
  // ※ もし users_sql に password_hash が無いなら ALTER が必要（下に記載）
  $hash = password_hash($newPassword, PASSWORD_DEFAULT);

  $st = $pdo->prepare("UPDATE users_sql SET password_hash = ?, updated_at = NOW() WHERE email_norm = ? LIMIT 1");
  $st->execute([$hash, $email_norm]);

  // 使い捨て化
  $pdo->prepare("UPDATE password_resets_sql SET used_at = NOW(), updated_at = NOW() WHERE doc_id = ? LIMIT 1")
      ->execute([(string)$hit['doc_id']]);

  json_out(200, ['ok' => true]);

} catch (Throwable $e) {
  error_log('[password-reset/confirm] ' . $e->getMessage());
  json_out(500, ['error' => 'internal_error']);
}
