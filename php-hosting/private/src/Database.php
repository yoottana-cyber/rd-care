<?php
declare(strict_types=1);

namespace RDConnect\Migration;

use PDO;
use RuntimeException;

/**
 * Future database adapter. Call only from authenticated/authorized PHP routes.
 * Do not log connection strings or credentials; pass secrets as PHP private
 * configuration or server environment outside public_html.
 */
final class Database
{
    /** @param array{host:string,port?:int,database:string,username:string,password:string} $config */
    public static function connect(array $config): PDO
    {
        foreach (['host', 'database', 'username', 'password'] as $name) {
            if (!array_key_exists($name, $config) || !is_string($config[$name]) || $config[$name] === '') {
                throw new RuntimeException('Missing database setting');
            }
        }

        $port = $config['port'] ?? 3306;
        if (!is_int($port) || $port < 1 || $port > 65535) {
            throw new RuntimeException('Invalid database port');
        }

        // DSN values come exclusively from trusted private configuration, not HTTP.
        foreach (['host', 'database'] as $name) {
            if (!preg_match('/^[a-zA-Z0-9_.-]+$/D', $config[$name])) {
                throw new RuntimeException('Invalid database setting');
            }
        }

        return new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                $config['host'], $port, $config['database']),
            $config['username'],
            $config['password'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    }
}
