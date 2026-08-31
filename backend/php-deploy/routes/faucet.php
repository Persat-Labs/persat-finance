<?php
declare(strict_types=1);

/**
 * Faucet cooldown + status. Server auto-mint is NOT available on pure PHP
 * (needs @solana/spl-token). Returns mode: client_bundle so the dApp falls back
 * to wallet bundle / client flow.
 */
function persat_handle_faucet(string $path, string $method, array $cfg): void
{
    $COOLDOWN_HOURS = 24;

    // GET /v1/faucet/status/:wallet
    if ($method === 'GET' && preg_match('#^/v1/faucet/status/([1-9A-HJ-NP-Za-km-z]{32,44})$#', $path, $m)) {
        $wallet = $m[1];
        try {
            $stmt = Database::pdo()->prepare(
                'SELECT asset, claimed_at FROM faucet_claims WHERE wallet = ? ORDER BY claimed_at DESC LIMIT 10'
            );
            $stmt->execute([$wallet]);
            $claims = $stmt->fetchAll();
        } catch (Throwable $e) {
            $claims = [];
        }
        Http::json([
            'wallet'                  => $wallet,
            'claims'                  => $claims,
            'serverDispenseAvailable' => false,
            'mode'                    => 'php_cooldown_only',
            'note'                    => 'Auto-mint requires optional Node sidecar with PERSAT_DEPLOYER_KEYPAIR. Cooldown is enforced here when DB is up.',
        ]);
    }

    // POST /v1/faucet/claim  or  /v1/faucet/auto
    if ($method === 'POST' && ($path === '/v1/faucet/claim' || $path === '/v1/faucet/auto')) {
        $body = Http::body();
        $wallet = trim((string) ($body['wallet'] ?? ''));
        $asset  = strtoupper(trim((string) ($body['asset'] ?? 'ALL')));
        if ($path === '/v1/faucet/auto') {
            $asset = 'ALL';
        }

        if (strlen($wallet) < 32 || strlen($wallet) > 44) {
            Http::error('Invalid wallet address', 400);
        }

        // Cooldown check
        try {
            $pdo = Database::pdo();
            $stmt = $pdo->prepare(
                'SELECT claimed_at FROM faucet_claims WHERE wallet = ? AND asset = ? ORDER BY claimed_at DESC LIMIT 1'
            );
            $stmt->execute([$wallet, $asset]);
            $last = $stmt->fetch();
            if ($last) {
                $lastAt = strtotime((string) $last['claimed_at']);
                $hoursSince = (time() - $lastAt) / 3600;
                if ($hoursSince < $COOLDOWN_HOURS) {
                    $remaining = (int) ceil($COOLDOWN_HOURS - $hoursSince);
                    Http::error("Faucet cooldown active — try again in {$remaining}h", 429, [
                        'cooldownHours'   => $COOLDOWN_HOURS,
                        'remainingHours'  => $remaining,
                    ]);
                }
            }
            // Record claim attempt (even for client_bundle) so cooldown sticks
            $pdo->prepare(
                'INSERT INTO faucet_claims (id, wallet, asset) VALUES (?, ?, ?)'
            )->execute([Uuid::v4(), $wallet, $asset]);
        } catch (Throwable $e) {
            // soft-open if DB missing mid-request
        }

        if ($path === '/v1/faucet/auto') {
            Http::error(
                'Auto-faucet not configured on PHP host — server needs Node sidecar + PERSAT_DEPLOYER_KEYPAIR.',
                503,
                ['mode' => 'client_bundle_required']
            );
        }

        Http::json([
            'ok'            => true,
            'wallet'        => $wallet,
            'asset'         => $asset,
            'message'       => 'Faucet claim recorded — dispense via client bundle on /faucet (upload devnet keypair JSON) or deploy Node sidecar for auto-dispense.',
            'mode'          => 'client_bundle',
            'cooldownHours' => $COOLDOWN_HOURS,
        ]);
    }

    Http::error('Not found', 404, ['path' => $path]);
}
