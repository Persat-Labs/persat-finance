<?php
declare(strict_types=1);

class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        $cfg = persat_config();
        $host = (string) ($cfg['db_host'] ?? 'localhost');
        $port = (int) ($cfg['db_port'] ?? 3306);
        $db   = (string) ($cfg['db_name'] ?? 'persat_finance');
        $user = (string) ($cfg['db_user'] ?? '');
        $pass = (string) ($cfg['db_pass'] ?? '');

        $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
        self::$pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        return self::$pdo;
    }

    /** Quick ping for /health */
    public static function ping(): string
    {
        try {
            self::pdo()->query('SELECT 1');
            return 'ok';
        } catch (Throwable $e) {
            return 'error: ' . substr($e->getMessage(), 0, 120);
        }
    }
}
