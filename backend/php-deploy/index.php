<?php
/**
 * Persat Finance — PHP API front controller (LyteHosting / Apache).
 *
 * Document root on LyteHosting should be this folder (php-deploy/).
 * All /v1/* and /health routes match the dApp client in frontend/src/lib/api.ts.
 *
 * Auto-faucet mint + keeper still need the optional Node sidecar later.
 * This package covers: health, SIWS auth, deal-links, marketplace, faucet cooldown,
 * oracle proxy, bridge health stub.
 */
declare(strict_types=1);

require_once __DIR__ . '/lib/bootstrap.php';

$cfg = persat_boot();

// Path after rewrite (e.g. /health, /v1/auth/challenge)
$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH) ?: '/';
$path = rtrim($path, '/') ?: '/';

// Strip optional subdirectory prefix if site is not at domain root
// e.g. /api/health → /health when installed under /api
foreach (['/api', '/public'] as $prefix) {
    if (str_starts_with($path, $prefix . '/') || $path === $prefix) {
        $path = substr($path, strlen($prefix)) ?: '/';
        break;
    }
}

$method = Http::method();

try {
    // ---------- /health ----------
    if ($path === '/health' && $method === 'GET') {
        $dbStatus = Database::ping();
        $oracleStatus = null;
        try {
            require_once __DIR__ . '/routes/oracle.php';
            $price = persat_fetch_btc_usd($cfg);
            $oracleStatus = $price
                ? (number_format($price['price'], 2) . ' USD, stale=' . ($price['isStale'] ? 'true' : 'false'))
                : 'unreachable';
        } catch (Throwable $e) {
            $oracleStatus = 'error';
        }

        Http::json([
            'ok'           => true,
            'service'      => 'persat-api',
            'version'      => '0.2.0-php',
            'runtime'      => 'php-mysql',
            'cluster'      => $cfg['cluster'] ?? 'devnet',
            'checks'       => [
                'storage' => str_starts_with($dbStatus, 'ok') ? 'configured' : 'error',
                'rpc'     => 'client_side', // PHP stack does not hold RPC for mint
                'cluster' => $cfg['cluster'] ?? 'devnet',
            ],
            'dependencies' => [
                'database' => $dbStatus,
                'oracle'   => $oracleStatus,
                'bridges'  => 'manual_stub',
                'faucet'   => 'cooldown_only', // no server mint without Node
            ],
            'timestamp'    => gmdate('Y-m-d\TH:i:s\Z'),
        ]);
    }

    // ---------- Auth ----------
    if ($path === '/v1/auth/status' && $method === 'GET') {
        Http::json([
            'ok'     => true,
            'mode'   => Auth::mode(),
            'scheme' => 'SIWS-challenge + Bearer session token',
            'notes'  => [
                'DOM/Inspect edits never grant authority.',
                'On-chain actions require a wallet-signed Solana transaction.',
                'API writes require Authorization: Bearer <session> bound to the signing wallet.',
                'Session is issued only after Ed25519 verify on a one-time challenge.',
                'Hosted on PHP/MySQL (LyteHosting). Auto-faucet mint needs optional Node sidecar.',
            ],
        ]);
    }

    if ($path === '/v1/auth/challenge' && $method === 'POST') {
        $body = Http::body();
        $wallet = trim((string) ($body['wallet'] ?? ''));
        Http::json(Auth::issueChallenge($wallet, $cfg));
    }

    if ($path === '/v1/auth/verify' && $method === 'POST') {
        $body = Http::body();
        $challengeId = trim((string) ($body['challengeId'] ?? $body['challenge_id'] ?? ''));
        $signature   = trim((string) ($body['signature'] ?? ''));
        $wallet      = isset($body['wallet']) ? trim((string) $body['wallet']) : null;
        Http::json(Auth::verifyAndCreateSession($challengeId, $signature, $wallet, $cfg));
    }

    if ($path === '/v1/auth/me' && $method === 'GET') {
        $wallet = Auth::requireSession();
        Http::json([
            'wallet'        => $wallet,
            'mode'          => Auth::mode(),
            'authenticated' => true,
        ]);
    }

    if ($path === '/v1/auth/logout' && $method === 'POST') {
        Auth::revoke(Http::bearerToken());
        http_response_code(204);
        exit;
    }

    if ($path === '/v1/auth/introspect' && $method === 'POST') {
        $token = Http::bearerToken();
        if ($token === null) {
            Http::json(['active' => false], 401);
        }
        try {
            $hash = hash('sha256', $token);
            $stmt = Database::pdo()->prepare(
                'SELECT wallet FROM wallet_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1'
            );
            $stmt->execute([$hash]);
            $row = $stmt->fetch();
            if (!$row) {
                Http::json(['active' => false], 401);
            }
            Http::json(['active' => true, 'wallet' => $row['wallet'], 'mode' => Auth::mode()]);
        } catch (Throwable $e) {
            Http::json(['active' => false], 401);
        }
    }

    // ---------- Oracle ----------
    if ($path === '/v1/oracle/btc-usd' && $method === 'GET') {
        require_once __DIR__ . '/routes/oracle.php';
        $price = persat_fetch_btc_usd($cfg);
        if (!$price) {
            Http::error('BTC/USD price unavailable — Hermes unreachable', 503, [
                'isStale'   => true,
                'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
            ]);
        }
        Http::json([
            'price'         => $price['price'],
            'confidence'    => $price['conf'],
            'confidenceBps' => $price['maxConfidenceBps'],
            'publishTime'   => $price['publishTime'],
            'ageSeconds'    => $price['ageSeconds'],
            'isStale'       => $price['isStale'],
            'timestamp'     => gmdate('Y-m-d\TH:i:s\Z'),
        ]);
    }

    // ---------- Bridges (honest stub — no ZEUS/THRESHOLD keys) ----------
    if ($path === '/v1/bridges/health' && $method === 'GET') {
        Http::json([
            'bridges' => [
                [
                    'id'          => 'manual',
                    'name'        => 'Manual deposit',
                    'available'   => true,
                    'mode'        => 'manual',
                    'successRate' => 1.0,
                    'note'        => 'ZEUS/THRESHOLD keys not configured — use on-chain tBTC/zBTC you already hold.',
                ],
            ],
            'recommended' => 'manual',
            'timestamp'   => gmdate('Y-m-d\TH:i:s\Z'),
        ]);
    }

    // ---------- Faucet (cooldown only — no server mint) ----------
    if (str_starts_with($path, '/v1/faucet')) {
        require_once __DIR__ . '/routes/faucet.php';
        persat_handle_faucet($path, $method, $cfg);
    }

    // ---------- Marketplace ----------
    if (str_starts_with($path, '/v1/marketplace')) {
        require_once __DIR__ . '/routes/marketplace.php';
        persat_handle_marketplace($path, $method);
    }

    // ---------- Deal links ----------
    if (str_starts_with($path, '/v1/deal-links')) {
        require_once __DIR__ . '/routes/deal_links.php';
        persat_handle_deal_links($path, $method);
    }

    Http::error('Not found', 404, ['path' => $path]);
} catch (PDOException $e) {
    Http::error('Database error — check config.local.php and schema import.', 503, [
        'detail' => substr($e->getMessage(), 0, 160),
    ]);
} catch (Throwable $e) {
    Http::error('Internal server error — try again.', 500, [
        'requestId' => bin2hex(random_bytes(8)),
        // Never leak stack in production; short message only for founder debugging
        'detail'    => substr($e->getMessage(), 0, 120),
    ]);
}
