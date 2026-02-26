<?php
declare(strict_types=1);

// bootstrap.php の先頭付近に置く（他の出力より先）

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowOrigins = [
  'http://localhost:8100',
];

if ($origin && in_array($origin, $allowOrigins, true)) {
  header("Access-Control-Allow-Origin: $origin");
  header("Vary: Origin");
} else {
  // 開発中は緩めるなら * でも良いが、今は8100固定推奨
  header("Access-Control-Allow-Origin: http://localhost:8100");
  header("Vary: Origin");
}

header("Access-Control-Allow-Credentials: true");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");

// preflight
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
  http_response_code(204);
  exit;
}

/**
 * public/bootstrap.php（完全版・再宣言事故防止）
 * - 例外/エラーは JSON で返す
 * - env / load_env_once / json_out / raw_body / json_body / pdo / mailer
 * - normalize_email / uuidv4 も提供
 *
 * 前提: PHPMailer は composer で導入（vendor/autoload.php を探索）
 */

// =====================================================
// Error handling (return JSON)
// =====================================================
ini_set('display_errors', '0');
error_reporting(E_ALL);

set_error_handler(function (int $severity, string $message, string $file, int $line) {
  throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(function (Throwable $e) {
  http_response_code(500);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode([
    'error'  => 'php_exception',
    'detail' => $e->getMessage(),
    'where'  => basename($e->getFile()) . ':' . $e->getLine(),
  ], JSON_UNESCAPED_UNICODE);
  exit;
});

// 「共通で JSON API」とする前提（HTMLを返すエンドポイントがあるなら各ファイル側で上書き）
header('Content-Type: application/json; charset=utf-8');


// =====================================================
// env helpers
// =====================================================
if (!function_exists('env')) {
  function env(string $key, ?string $default = null): ?string {
    $v = getenv($key);
    if ($v !== false) return $v;
    if (isset($_ENV[$key])) return (string)$_ENV[$key];
    return $default;
  }
}

if (!function_exists('load_env_once')) {
  function load_env_once(string $path): void {
    static $loaded = [];
    if (isset($loaded[$path])) return;
    $loaded[$path] = true;

    if (!is_file($path)) return;

    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
      $line = trim($line);
      if ($line === '' || str_starts_with($line, '#')) continue;

      [$k, $v] = array_pad(explode('=', $line, 2), 2, '');
      $k = trim($k);
      $v = trim($v);

      // remove surrounding quotes
      $v = trim($v, "\"'");

      if ($k === '') continue;

      putenv($k . '=' . $v);
      $_ENV[$k] = $v;
    }
  }
}

// public/.env を読む（必要ならパス変更）
load_env_once(__DIR__ . '/../.env');


// =====================================================
// JSON response
// =====================================================
if (!function_exists('json_out')) {
  function json_out(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
  }
}


// =====================================================
// Request body helpers
// =====================================================
if (!function_exists('raw_body')) {
  function raw_body(): string {
    static $cached = null;
    if ($cached !== null) return $cached;

    $raw = file_get_contents('php://input');
    if ($raw === false) $raw = '';

    // UTF-8 BOM 除去
    $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw) ?? $raw;

    $cached = $raw;
    return $raw;
  }
}

if (!function_exists('json_body')) {
  function json_body(): ?array {
    $raw = raw_body();
    if ($raw === '') return null;

    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
  }
}


// =====================================================
// Utility: normalize email, uuid
// =====================================================
if (!function_exists('normalize_email')) {
  function normalize_email(string $email): string {
    $email = trim($email);
    $email = mb_strtolower($email, 'UTF-8');
    // 全角スペースなど混入対策
    $email = preg_replace('/\s+/u', '', $email) ?? $email;
    return $email;
  }
}

if (!function_exists('uuidv4')) {
  function uuidv4(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
  }
}


// =====================================================
// DB (PDO) - cached
// =====================================================
if (!function_exists('pdo')) {
  function pdo(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $host = env('DB_HOST', '127.0.0.1');
    $port = env('DB_PORT', '3306');
    $name = env('DB_NAME', '');
    $user = env('DB_USER', '');

    // DB_PASS / DB_PASSWORD 両対応
    $pass = env('DB_PASS');
    if ($pass === null) $pass = env('DB_PASSWORD', '');

    if ($name === '' || $user === '') {
      throw new RuntimeException('DB env missing (DB_NAME / DB_USER)');
    }

    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
    $pdo = new PDO($dsn, $user, (string)$pass, [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    return $pdo;
  }
}


// =====================================================
// Composer autoload (PHPMailer)
// =====================================================
if (!function_exists('require_composer_autoload')) {
  function require_composer_autoload(): void {
    static $done = false;
    if ($done) return;

    $candidates = [
      __DIR__ . '/../vendor/autoload.php',
      __DIR__ . '/vendor/autoload.php',
      dirname(__DIR__) . '/vendor/autoload.php',
    ];

    foreach ($candidates as $p) {
      if (is_file($p)) {
        require_once $p;
        $done = true;
        return;
      }
    }

    throw new RuntimeException('vendor/autoload.php not found. Run: composer require phpmailer/phpmailer');
  }
}


// =====================================================
// mailer(): Gmail SMTP via PHPMailer
// =====================================================
if (!function_exists('mailer')) {
  function mailer(): PHPMailer\PHPMailer\PHPMailer {
    require_composer_autoload();

    if (!class_exists('PHPMailer\\PHPMailer\\PHPMailer')) {
      throw new RuntimeException('PHPMailer not installed. Run: composer require phpmailer/phpmailer');
    }

    $host = env('SMTP_HOST', 'smtp.gmail.com');
    $port = (int)env('SMTP_PORT', '587');
    $user = env('SMTP_USER', '');
    $pass = env('SMTP_PASS', '');
    $from = env('SMTP_FROM', $user);
    $fromName = env('SMTP_FROM_NAME', '日本語スピーチ判定');

    if ($user === '' || $pass === '') {
      throw new RuntimeException('SMTP env missing (SMTP_USER / SMTP_PASS)');
    }

    $m = new PHPMailer\PHPMailer\PHPMailer(true);
    $m->CharSet = 'UTF-8';

    $m->isSMTP();
    $m->Host = $host;
    $m->Port = $port;
    $m->SMTPAuth = true;
    $m->Username = $user;
    $m->Password = $pass;

    // Gmail: 587 => STARTTLS
    $m->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;

    $m->setFrom($from, $fromName);

    // Optional SMTP debug
    if (env('SMTP_DEBUG') === '1') {
      $m->SMTPDebug = 2;
      $m->Debugoutput = function ($str) { error_log('[smtp] ' . $str); };
    }

    return $m;
  }
}

// =====================================================
// Auth: JWT (HS256) verify + require_auth()
// =====================================================
if (!function_exists('base64url_decode')) {
  function base64url_decode(string $b64): string {
    $b64 = strtr($b64, '-_', '+/');
    $pad = strlen($b64) % 4;
    if ($pad) $b64 .= str_repeat('=', 4 - $pad);
    $bin = base64_decode($b64, true);
    return ($bin === false) ? '' : $bin;
  }
}

if (!function_exists('jwt_verify_hs256')) {
  /**
   * @return array<string,mixed>|null
   */
  function jwt_verify_hs256(string $jwt, string $secret): ?array {
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) return null;

    [$h64, $p64, $s64] = $parts;

    $h = json_decode(base64url_decode($h64), true);
    $p = json_decode(base64url_decode($p64), true);
    $sig = base64url_decode($s64);

    if (!is_array($h) || !is_array($p) || $sig === '') return null;
    if (($h['alg'] ?? '') !== 'HS256') return null;

    $expected = hash_hmac('sha256', $h64 . '.' . $p64, $secret, true);
    if (!hash_equals($expected, $sig)) return null;

    // exp チェック
    $now = time();
    if (isset($p['exp']) && is_numeric($p['exp']) && (int)$p['exp'] < $now) return null;

    return $p;
  }
}

if (!function_exists('require_auth')) {
  /**
   * Authorization: Bearer <token> を必須にする
   * @return array<string,mixed> JWT payload
   */
  function require_auth(): array {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/Bearer\s+(.+)/', $auth, $m)) {
      json_out(401, ['error' => 'unauthorized']);
    }

    $secret = env('JWT_SECRET', '');
    if ($secret === '') {
      json_out(500, ['error' => 'env_missing', 'JWT_SECRET' => false]);
    }

    $payload = jwt_verify_hs256($m[1], $secret);
    if (!$payload) {
      json_out(401, ['error' => 'invalid_token']);
    }

    return $payload;
  }
}
