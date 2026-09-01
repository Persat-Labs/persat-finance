<?php
declare(strict_types=1);

class Http
{
    public static function applyCors(array $allowedOrigins): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allow = '*';
        if ($origin !== '') {
            $ok = false;
            foreach ($allowedOrigins as $o) {
                if ($o === $origin) {
                    $ok = true;
                    break;
                }
                // allow *.persat.finance and e2b previews
                if (str_contains($origin, 'persat.finance') || str_contains($origin, 'e2b.app') || str_contains($origin, 'localhost')) {
                    $ok = true;
                    break;
                }
            }
            if ($ok) {
                $allow = $origin;
                header('Access-Control-Allow-Credentials: true');
            }
        }
        header("Access-Control-Allow-Origin: {$allow}");
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-Id');
        header('Access-Control-Max-Age: 86400');
        header('Vary: Origin');
    }

    public static function json(mixed $data, int $code = 200): never
    {
        http_response_code($code);
        echo json_encode($data, JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function error(string $message, int $code = 400, array $extra = []): never
    {
        self::json(array_merge(['error' => $message], $extra), $code);
    }

    public static function body(): array
    {
        $raw = file_get_contents('php://input') ?: '';
        if ($raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    public static function bearerToken(): ?string
    {
        $auth = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? '';
        // Some Apache setups need RewriteRule to pass Authorization
        if ($auth === '' && function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            foreach ($headers as $k => $v) {
                if (strtolower($k) === 'authorization') {
                    $auth = $v;
                    break;
                }
            }
        }
        if (preg_match('/^Bearer\s+(\S+)/i', $auth, $m)) {
            return $m[1];
        }
        return null;
    }
}
