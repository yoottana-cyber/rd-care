<?php
declare(strict_types=1);

/*
 * RD CONNECT PHP migration entry point.
 *
 * This is NOT the complete RD CONNECT API. All data and login routes are
 * deliberately disabled until individually ported and tested.
 *
 * Install this file into <school-web-root>/api/index.php and keep everything
 * under php-hosting/private OUTSIDE the public document root.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function migration_response(int $status, string $error): never
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $error], JSON_UNESCAPED_UNICODE);
    exit;
}

if (PHP_VERSION_ID < 80200) {
    migration_response(503, 'php_version_not_supported');
}

$private = getenv('RD_CONNECT_PRIVATE_DIR');
if (!is_string($private) || $private === '' || $private[0] !== '/' ||
    !is_file($private . '/bootstrap.php')) {
    migration_response(503, 'migration_configuration_missing');
}

try {
    require $private . '/bootstrap.php';
    \RDConnect\Migration\dispatch($_SERVER);
} catch (Throwable $error) {
    // Never expose database credentials, exception messages, or stack traces.
    error_log('RD CONNECT PHP migration exception: ' . get_class($error));
    migration_response(503, 'migration_service_unavailable');
}
