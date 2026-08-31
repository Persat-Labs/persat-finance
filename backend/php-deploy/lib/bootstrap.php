<?php
declare(strict_types=1);

/**
 * Shared bootstrap for every PHP route under document root.
 */

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/SolanaCrypto.php';
require_once __DIR__ . '/Http.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Uuid.php';

/**
 * Load config: config.local.php (secrets on server) falls back to config.example.php.
 */
function persat_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $local = __DIR__ . '/../config/config.local.php';
    $example = __DIR__ . '/../config/config.example.php';
    if (is_readable($local)) {
        $cfg = require $local;
    } elseif (is_readable($example)) {
        $cfg = require $example;
    } else {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'API config missing — copy config.example.php to config.local.php']);
        exit;
    }
    return $cfg;
}

/** Apply CORS + JSON headers; handle OPTIONS preflight. */
function persat_boot(): array
{
    $cfg = persat_config();
    Http::applyCors($cfg['cors_origins'] ?? []);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('X-Persat-Api: php-mysql');

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
    return $cfg;
}
