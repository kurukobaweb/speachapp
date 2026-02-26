<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// 実ファイルがあればそれを返す（css/js/img 等）
$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
  return false;
}

// /api/* は index.php へ
if (str_starts_with($path, '/api/')) {
  require __DIR__ . '/index.php';
  exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  require __DIR__ . '/index.php';
  return true;
}

// それ以外も index.php（SPA/画面側）
require __DIR__ . '/index.php';
