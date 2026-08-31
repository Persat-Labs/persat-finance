<?php
declare(strict_types=1);

/**
 * SIWS challenge + Bearer session — matches Node sessionStore contract.
 * Frontend expects: challengeId, message, token, wallet, mode.
 */
class Auth
{
    public static function mode(): string
    {
        $status = Database::ping();
        return str_starts_with($status, 'ok') ? 'database' : 'error';
    }

    public static function requireSession(): string
    {
        $token = Http::bearerToken();
        if ($token === null || strlen($token) < 20) {
            Http::error(
                'Wallet session required.',
                401,
                [
                    'hint' => 'POST /v1/auth/challenge → sign message in wallet → POST /v1/auth/verify → Authorization: Bearer <token>',
                ]
            );
        }

        $hash = hash('sha256', $token);
        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT wallet FROM wallet_sessions
             WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()
             LIMIT 1'
        );
        $stmt->execute([$hash]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Session expired or revoked — sign in again.', 401);
        }
        return (string) $row['wallet'];
    }

    public static function issueChallenge(string $wallet, array $cfg): array
    {
        if (strlen($wallet) < 32 || strlen($wallet) > 44) {
            Http::error('Invalid Solana wallet', 400);
        }

        $id = Uuid::v4();
        $nonce = bin2hex(random_bytes(32));
        $nonceHash = hash('sha256', $nonce);
        $ttl = (int) ($cfg['challenge_ttl_seconds'] ?? 300);
        $appUrl = (string) ($cfg['app_url'] ?? 'https://dapp.persat.finance');
        $issuedAt = gmdate('Y-m-d\TH:i:s\Z');
        $expiresAt = date('Y-m-d H:i:s', time() + $ttl);

        // Message shape the wallet signs — keep stable for verify
        $message = "Persat Finance wants you to sign in with your Solana account:\n"
            . "{$wallet}\n\n"
            . "URI: {$appUrl}\n"
            . "Version: 1\n"
            . "Chain ID: devnet\n"
            . "Nonce: {$nonce}\n"
            . "Issued At: {$issuedAt}";

        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'INSERT INTO wallet_auth_challenges (id, wallet, nonce_hash, message, expires_at)
             VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([$id, $wallet, $nonceHash, $message, $expiresAt]);

        return [
            'challengeId' => $id,
            'message'     => $message,
            'expiresAt'   => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiresAt)),
            'mode'        => 'database',
        ];
    }

    public static function verifyAndCreateSession(string $challengeId, string $signature, ?string $clientWallet, array $cfg): array
    {
        if ($challengeId === '' || $signature === '') {
            Http::error('Invalid authentication response', 400);
        }

        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'SELECT id, wallet, message, used_at, expires_at
             FROM wallet_auth_challenges
             WHERE id = ?
             LIMIT 1'
        );
        $stmt->execute([$challengeId]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Challenge expired or already used.', 401);
        }
        if ($row['used_at'] !== null) {
            Http::error('Challenge expired or already used.', 401);
        }
        if (strtotime((string) $row['expires_at']) < time()) {
            Http::error('Challenge expired or already used.', 401);
        }

        $wallet = (string) $row['wallet'];
        if ($clientWallet !== null && $clientWallet !== '' && $clientWallet !== $wallet) {
            Http::error('Wallet mismatch — sign with the connected account only.', 401);
        }

        if (!SolanaCrypto::verifySignature($signature, (string) $row['message'], $wallet)) {
            Http::error('Signature verification failed.', 401);
        }

        $pdo->prepare('UPDATE wallet_auth_challenges SET used_at = NOW() WHERE id = ?')
            ->execute([$challengeId]);

        $sessionId = Uuid::v4();
        $token = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $token);
        $ttl = (int) ($cfg['session_ttl_seconds'] ?? 86400);
        $expiresAt = date('Y-m-d H:i:s', time() + $ttl);

        $pdo->prepare(
            'INSERT INTO wallet_sessions (id, wallet, token_hash, expires_at)
             VALUES (?, ?, ?, ?)'
        )->execute([$sessionId, $wallet, $tokenHash, $expiresAt]);

        return [
            'token'            => $token,
            'wallet'           => $wallet,
            'expiresInSeconds' => $ttl,
            'mode'             => 'database',
        ];
    }

    public static function revoke(?string $token): void
    {
        if ($token === null || $token === '') {
            return;
        }
        $hash = hash('sha256', $token);
        try {
            Database::pdo()
                ->prepare('UPDATE wallet_sessions SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL')
                ->execute([$hash]);
        } catch (Throwable $e) {
            // ignore
        }
    }
}
