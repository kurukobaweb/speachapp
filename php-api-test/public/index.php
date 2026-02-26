<?php
declare(strict_types=1);
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

/**
 * public/index.php — API Router（完全版 / Entitlement統合）
 * - CORS / OPTIONS / ルーティングを一元管理
 * - php://input を index.php で “消費しない” （RAW_JSONに1回だけキャッシュ）
 * - free期限(=free_until) で利用制限（402 free_expired）
 * - /api/entitlement でフロントのポップアップ判定用情報を返す
 */

/* =========================================================
 * bootstrap 読み込み
 * ======================================================= */
$bootCandidates = [
  __DIR__ . '/../bootstrap.php',
  __DIR__ . '/bootstrap.php',
  dirname(__DIR__) . '/bootstrap.php',
];
$boot = null;
foreach ($bootCandidates as $p) {
  if (is_file($p)) { $boot = $p; break; }
}
if (!$boot) {
  http_response_code(500);
  echo json_encode(['ok'=>false,'error'=>'bootstrap_not_found','candidates'=>$bootCandidates], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $boot;

/* =========================================================
 * CORS（dev）
 * ======================================================= */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allow = [
  'http://localhost:8100',
  'http://localhost:8080',
  'http://localhost:8200',
];

// allowlist に合うときだけ Origin を返す（Credentials を使うなら "*" は不可）
if ($origin && in_array($origin, $allow, true)) {
  header("Access-Control-Allow-Origin: $origin");
  header("Vary: Origin");
} else {
  // curl 等（Origin なし）の場合は "*" でOK（credentials なし想定）
  header("Access-Control-Allow-Origin: *");
}

header("Access-Control-Allow-Credentials: true");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Content-Type: application/json; charset=utf-8");

/* =========================================================
 * OPTIONS（プリフライト）
 * ======================================================= */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
  http_response_code(204);
  exit;
}

/* =========================================================
 * Body を “読むなら一回だけ” ここでキャッシュ
 * ======================================================= */
$GLOBALS['RAW_JSON'] = file_get_contents('php://input') ?: '';

/* =========================================================
 * PDO 準備
 * ======================================================= */
if (!function_exists('pdo')) {
  http_response_code(500);
  echo json_encode(['ok'=>false,'error'=>'pdo_function_not_found'], JSON_UNESCAPED_UNICODE);
  exit;
}
$pdo = pdo();

/* =========================================================
 * Auth / Entitlement helpers（完全版・最小構成）
 * ======================================================= */

const FREE_TRIAL_DAYS = 7; // ← 将来変更するなら env/config に寄せてもOK
const FREE_CUTOFF_AT  = '2026-03-01 00:00:00'; // JST基準

function now_jst(): DateTime {
  return new DateTime('now', new DateTimeZone('Asia/Tokyo'));
}

function json_fail(int $status, array $payload): void {
  http_response_code($status);
  echo json_encode($payload, JSON_UNESCAPED_UNICODE);
}

function parse_jwt_payload_from_bearer(): array {
  $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
  if (!preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) return [];

  $token = $m[1];
  $parts = explode('.', $token);
  if (count($parts) < 2) return [];

  $b64 = strtr($parts[1], '-_', '+/');
  $pad = strlen($b64) % 4;
  if ($pad) $b64 .= str_repeat('=', 4 - $pad);

  $json = base64_decode($b64, true);
  if ($json === false) return [];

  $p = json_decode($json, true);
  return is_array($p) ? $p : [];
}

function require_auth_payload(): array {
  $payload = parse_jwt_payload_from_bearer();
  if (!$payload || empty($payload['sub'])) {
    json_out(401, ['ok'=>false, 'error'=>'unauthorized']);
    exit;
  }
  return $payload;
}

function fetch_user_by_doc_id(PDO $pdo, string $docId): ?array {
  $st = $pdo->prepare("
    SELECT
      doc_id,
      email,
      role,
      course_id,
      created_at,
      free_until,
      password_hash
    FROM users_sql
    WHERE doc_id = :doc_id
    LIMIT 1
  ");
  $st->execute([':doc_id' => $docId]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}


function compute_free_until(array $user): string {
  // created_at は DATETIME 前提（違う場合はここだけ調整）
  $tz = new DateTimeZone('Asia/Tokyo');
  $createdAt = new DateTime((string)$user['created_at'], $tz);
  $cutoff    = new DateTime(FREE_CUTOFF_AT, $tz);
  $days      = FREE_TRIAL_DAYS;

  $freeUntil = ($createdAt < $cutoff)
    ? (clone $cutoff)->modify("+{$days} days")
    : (clone $createdAt)->modify("+{$days} days");

  return $freeUntil->format('Y-m-d H:i:s');
}

function ensure_free_until(PDO $pdo, array &$user): void {
  if (!empty($user['free_until'])) return;

  $freeUntil = compute_free_until($user);
  $st = $pdo->prepare("UPDATE users_sql SET free_until = :free_until WHERE doc_id = :doc_id LIMIT 1");
  $st->execute([
    ':free_until' => $freeUntil,
    ':doc_id'     => $user['doc_id'],
  ]);

  $user['free_until'] = $freeUntil;
}

function is_paid_user(array $user): bool {
  // 暫定：course_id で判定（本番は subscriptions.status など推奨）
  $course = strtolower((string)($user['course_id'] ?? 'free'));
  return $course !== '' && $course !== 'free';
}

function require_entitled(PDO $pdo, array &$user): void {

  // ★ admin / owner は常にOK（期限無視）
  $role = strtolower((string)($user['role'] ?? 'user'));
  if (in_array($role, ['admin', 'owner'], true)) {
    return;
  }

  // paid ユーザーも常にOK
  if (is_paid_user($user)) {
    return;
  }

  // free ユーザーは期限チェック
  ensure_free_until($pdo, $user);

  $now   = now_jst();
  $until = new DateTime((string)$user['free_until'], new DateTimeZone('Asia/Tokyo'));

  if ($now > $until) {
    json_out(402, [
      'ok'         => false,
      'error'      => 'free_expired',
      'paywall'    => true,
      'free_until' => $user['free_until'],
    ]);
    exit;
  }
}


function entitlement_payload(PDO $pdo, array &$user): array {

  // ★ admin / owner は期限もポップアップも無視（常にOK扱い）
  $role = strtolower((string)($user['role'] ?? 'user'));
  if (in_array($role, ['admin','owner'], true)) {
    return [
      'ok'         => true,
      'plan'       => 'admin',
      'paywall'    => false,
      'show_popup' => false,
    ];
  }

  // paid もOK
  if (is_paid_user($user)) {
    return [
      'ok'         => true,
      'plan'       => 'paid',
      'paywall'    => false,
      'show_popup' => false,
    ];
  }

  // free の場合
  ensure_free_until($pdo, $user);

  $now    = now_jst();
  $until  = new DateTime((string)$user['free_until'], new DateTimeZone('Asia/Tokyo'));
  $active = ($now <= $until);

  $daysLeft = $active ? ((int)$now->diff($until)->format('%a') + 1) : 0;

  return [
    'ok'          => true,
    'plan'        => 'free',
    'free_until'  => $user['free_until'],
    'free_active' => $active,
    'days_left'   => $daysLeft,
    'paywall'     => !$active,
    'show_popup'  => (!$active) || ($daysLeft <= 2),
    'popup_type'  => !$active ? 'expired' : 'warning',
  ];
}


function require_admin_like(array $user): void {
  $role = strtolower((string)($user['role'] ?? 'user'));
  if (!in_array($role, ['admin','owner'], true)) {
    json_out(403, ['ok'=>false,'error'=>'forbidden']);
    exit;
  }
}

/* =========================================================
 * パス解決
 * ======================================================= */
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri    = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path   = rtrim($uri, '/');
if ($path === '') $path = '/';

try {

  /* =======================================================
   * Public (no auth)
   * ===================================================== */

  if ($method === 'POST' && $path === '/api/register/email') {
    require __DIR__ . '/register_email.php';
    exit;
  }

  if ($method === 'POST' && $path === '/api/register/verify') {
    require __DIR__ . '/register_verify.php';
    exit;
  }

  if ($method === 'POST' && $path === '/api/users') {
    require __DIR__ . '/users_create.php';
    exit;
  }

  if ($method === 'POST' && $path === '/api/login') {
    require __DIR__ . '/login.php';
    exit;
  }

  // echo（debug）
  if ($method === 'POST' && $path === '/api/_echo') {
    json_out(200, [
      'ct'  => $_SERVER['CONTENT_TYPE'] ?? '',
      'raw' => $GLOBALS['RAW_JSON'] ?? '',
      'all' => $_POST,
    ]);
    exit;
  }

  /* =======================================================
   * Auth required (but NOT entitled)
   * ===================================================== */

  // /api/entitlement（ポップアップ判定用）
  if ($method === 'GET' && $path === '/api/entitlement') {
    $payload = require_auth_payload();
    $sub = (string)$payload['sub'];

    $user = fetch_user_by_doc_id($pdo, $sub);
    if (!$user) { json_out(401, ['ok'=>false,'error'=>'unauthorized_user_not_found']); exit; }

    json_out(200, entitlement_payload($pdo, $user));
    exit;
  }

  // /api/me（本人情報）
  if ($method === 'GET' && $path === '/api/me') {
    // me.php 側で auth しているならここでは不要だが、
    // ここで認証しておくと me.php は “本人が確定済み” として書ける
    $payload = require_auth_payload();
    $sub = (string)$payload['sub'];

    $user = fetch_user_by_doc_id($pdo, $sub);
    if (!$user) { json_out(401, ['ok'=>false,'error'=>'unauthorized_user_not_found']); exit; }

    // me.php に user を渡したい場合はこうする（必要なければ削除OK）
    $GLOBALS['AUTH_USER'] = $user;

    require __DIR__ . '/me.php';
    exit;
  }

  /* =======================================================
   * Entitled required（ここから “利用できる人のみ”）
   * ===================================================== */

  // =====================================================
  // Theme options
  // GET /api/theme-options
  //  - free(user) は 初級〜超級 ＆ type=二択 のみ
  //  - admin/owner, user+pro は 全部
  // =====================================================
  if ($method === 'GET' && $path === '/api/theme-options') {

    $payload = require_auth_payload();
    $sub = (string)$payload['sub'];

    $user = fetch_user_by_doc_id($pdo, $sub);
    if (!$user) { json_out(401, ['ok'=>false,'error'=>'unauthorized_user_not_found']); exit; }

    require_entitled($pdo, $user);

    $role = strtolower((string)($payload['role'] ?? ($user['role'] ?? 'user')));
    $course_id = strtolower((string)($user['course_id'] ?? 'free'));

    $adminLike = in_array($role, ['admin','owner'], true)
      || ($role === 'user' && $course_id === 'pro');

    $levelsAll = $pdo->query("
      SELECT DISTINCT level
      FROM themes_sql
      WHERE enabled = 1 AND level IS NOT NULL
      ORDER BY level
    ")->fetchAll(PDO::FETCH_COLUMN);

    $typesAll = $pdo->query("
      SELECT DISTINCT type
      FROM themes_sql
      WHERE enabled = 1 AND type IS NOT NULL
      ORDER BY type
    ")->fetchAll(PDO::FETCH_COLUMN);

    $levelsAll = array_values(array_filter($levelsAll, fn($v)=>$v!==null && $v!==''));
    $typesAll  = array_values(array_filter($typesAll,  fn($v)=>$v!==null && $v!==''));

    // free制限（運用に合わせて調整）
    $FREE_LEVELS = ["初級","中級","上級","超級"];
    $FREE_TYPES  = ["二択"]; // 単体も許すなら ["二択","単体"]

    if ($adminLike) {
      $levels = $levelsAll;
      $types  = $typesAll;
    } else {
      $levels = array_values(array_filter($levelsAll, fn($v)=>in_array($v, $FREE_LEVELS, true)));
      $types  = array_values(array_filter($typesAll,  fn($v)=>in_array($v, $FREE_TYPES,  true)));
    }

    json_out(200, [
      'ok' => true,
      'role' => $role,
      'course' => $course_id,
      'levels' => $levels,
      'types'  => $types,
      'categories' => [],
      'options' => [
        'levels' => $levels,
        'types'  => $types,
        'categories' => [],
      ],
      'plan' => [
        'canUseThemes' => $adminLike,
        'themeLimit'   => 9999,
      ],
    ]);
    exit;
  }

  // =====================================================
  // Themes 一覧
  // GET /api/themes
  // =====================================================
  if ($method === 'GET' && $path === '/api/themes') {

    $payload = require_auth_payload();
    $sub = (string)$payload['sub'];

    $user = fetch_user_by_doc_id($pdo, $sub);
    if (!$user) { json_out(401, ['ok'=>false,'error'=>'unauthorized_user_not_found']); exit; }

    require_entitled($pdo, $user);

    $sql = "
      SELECT
        doc_id,
        id,
        title,
        level,
        category,
        lang,
        order_no,
        type,
        sub,
        question
      FROM themes_sql
      WHERE enabled = 1
      ORDER BY
        level,
        COALESCE(order_no, CAST(doc_id AS UNSIGNED))
    ";

    $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);

    $all = [];
    foreach ($rows as $r) {
      $id    = (string)(($r['id'] ?? '') !== '' ? $r['id'] : $r['doc_id']);
      $title = (string)($r['title'] ?? '');
      $order = ($r['order_no'] === null) ? (int)$r['doc_id'] : (int)$r['order_no'];

      $all[] = [
        'id'       => $id,
        'doc_id'   => (string)$r['doc_id'],
        'title'    => $title,
        'name'     => $title,
        'label'    => $title,
        'level'    => (string)($r['level'] ?? ''),
        'type'     => (string)($r['type'] ?? ''),
        'sub'      => (string)($r['sub'] ?? ''),
        'question' => (string)($r['question'] ?? ''),
        'order'    => $order,
        'order_no' => $order,
        'orderNo'  => $order,
      ];
    }

    json_out(200, [
      'ok'     => true,
      'total'  => count($all),
      'all'    => $all,
      'themes' => $all,
    ]);
    exit;
  }

  // =====================================================
  // Scores
  // GET /api/scores
  // POST /api/scores
  // =====================================================
  if (($method === 'GET' || $method === 'POST') && $path === '/api/scores') {

    $payload = require_auth_payload();
    $sub = (string)$payload['sub'];

    $user = fetch_user_by_doc_id($pdo, $sub);
    if (!$user) { json_out(401, ['ok'=>false,'error'=>'unauthorized_user_not_found']); exit; }

    require_entitled($pdo, $user);

    if ($method === 'GET')  { require __DIR__ . '/scores_list.php'; exit; }
    if ($method === 'POST') { require __DIR__ . '/scores.php'; exit; }
  }

  // =====================================================
  // Admin users
  // GET/POST /api/admin/users
  // PUT/DELETE /api/admin/users/{id}
  // =====================================================
  if (($method === 'GET' || $method === 'POST') && $path === '/api/admin/users') {

    $payload = require_auth_payload();
    $sub = (string)$payload['sub'];

    $user = fetch_user_by_doc_id($pdo, $sub);
    if (!$user) { json_out(401, ['ok'=>false,'error'=>'unauthorized_user_not_found']); exit; }

    require_entitled($pdo, $user);
    require_admin_like($user);

    require __DIR__ . '/admin_users.php';
    exit;
  }

  if (($method === 'PUT' || $method === 'DELETE') && preg_match('#^/api/admin/users/([^/]+)$#', $path, $m)) {

    $payload = require_auth_payload();
    $sub = (string)$payload['sub'];

    $user = fetch_user_by_doc_id($pdo, $sub);
    if (!$user) { json_out(401, ['ok'=>false,'error'=>'unauthorized_user_not_found']); exit; }

    require_entitled($pdo, $user);
    require_admin_like($user);

    $_GET['admin_user_id'] = urldecode($m[1]);
    require __DIR__ . '/admin_user_one.php';
    exit;
  }

  // =====================================================
  // profile: users（必要なら entitled を入れる/入れないを選ぶ）
  // ここは「誰が見れるべきか」次第なので、今は現状維持（entitledなし）
  // =====================================================
  if ($path === '/api/users' && $method === 'GET') {
    require __DIR__ . '/users_list.php';
    exit;
  }
  if (preg_match('#^/api/users/([^/]+)$#', $path, $m)) {
    $_GET['user_id'] = urldecode($m[1]);
    require __DIR__ . '/user_one.php';
    exit;
  }

  // =====================================================
  // Password
  // =====================================================
  if ($method === 'POST' && $path === '/api/password/forgot') {
    require __DIR__ . '/password_forgot.php';
    exit;
  }

  if ($method === 'POST' && $path === '/api/password/reset') {
    require __DIR__ . '/password_reset.php';
    exit;
  }

    // =====================================================
  // Account delete（解約 / アカウント削除）
  // =====================================================
  if ($method === 'POST' && $path === '/api/account/delete') {

    // 認証必須
    $payload = require_auth_payload();
    $sub = (string)$payload['sub'];

    $user = fetch_user_by_doc_id($pdo, $sub);
    if (!$user) {
      json_out(401, ['ok'=>false,'error'=>'unauthorized_user_not_found']);
      exit;
    }

    // admin / owner は削除不可にするならここで弾く
    if (in_array(strtolower((string)$user['role']), ['admin','owner'], true)) {
      json_out(403, ['ok'=>false,'error'=>'forbidden_role']);
      exit;
    }

    // 実処理は handler に委譲
    require __DIR__ . '/../handlers/account_delete.php';
    exit;
  }

  // Not Found
  json_out(404, [
    'error' => 'not_found',
    'path'  => $path,
    'method'=> $method,
  ]);

} catch (Throwable $e) {
  error_log('[index] ' . $e->getMessage());
  json_out(500, [
    'error'  => 'internal_error',
    'detail' => $e->getMessage(),
  ]);
}
