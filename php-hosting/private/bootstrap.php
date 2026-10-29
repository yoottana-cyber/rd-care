<?php
declare(strict_types=1);

namespace RDConnect\Migration;

require_once __DIR__ . '/src/Database.php';

/**
 * Migration-only router. A successful health check will be enabled only after
 * all production-critical functionality and security reviews are complete.
 * Until then, never claim this API is ready for real student records.
 */
function dispatch(array $server): never
{
    $method = $server['REQUEST_METHOD'] ?? 'GET';
    $uri = parse_url((string) ($server['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $uri = is_string($uri) ? $uri : '/';
    $pos = strpos($uri, '/api/');
    $endpoint = $pos === false ? '/api/' : substr($uri, $pos);

    header('Allow: GET, POST, OPTIONS');
    if ($method === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    if ($endpoint === '/api/health') {
        if ($method !== 'GET') {
            respond(405, 'method_not_allowed');
        }
        respond(503, 'migration_not_ready');
    }

    // No fallback to the Cloudflare Dev Worker, and no insecure mock login.
    respond(501, 'endpoint_not_migrated');
}

function respond(int $status, string $error): never
{
    http_response_code($status);
    header('Cache-Control: no-store');
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode([
        'ok' => false,
        'error' => $error,
        'service' => 'rd-connect-php-migration'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}
