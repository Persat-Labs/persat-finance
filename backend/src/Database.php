<?php
declare(strict_types=1);

class Database {
    private static ?PDO $pdo = null;

    public static function getConnection(): PDO {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        // Prefer DB_* names from .env.example / docs; fall back to common Laravel-style aliases
        $host = getenv('DB_HOST') ?: '127.0.0.1';
        $port = getenv('DB_PORT') ?: '3306';
        $db   = getenv('DB_NAME') ?: (getenv('DB_DATABASE') ?: 'persat_finance');
        $user = getenv('DB_USER') ?: (getenv('DB_USERNAME') ?: 'root');
        $pass = getenv('DB_PASS') !== false && getenv('DB_PASS') !== ''
            ? (string) getenv('DB_PASS')
            : (getenv('DB_PASSWORD') ?: '');
        $charset = 'utf8mb4';

        $dsn = "mysql:host={$host};port={$port};dbname={$db};charset={$charset}";
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];

        self::$pdo = new PDO($dsn, $user, $pass, $options);
        return self::$pdo;
    }
}
