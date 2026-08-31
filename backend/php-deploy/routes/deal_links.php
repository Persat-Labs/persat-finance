<?php
declare(strict_types=1);

function persat_deal_link_hash(string $token): string
{
    return hash('sha256', $token);
}

function persat_create_deal_link_token(): array
{
    // base64url 32 bytes — matches Node createDealLinkToken
    $raw = random_bytes(32);
    $token = rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    return ['token' => $token, 'tokenHash' => persat_deal_link_hash($token)];
}

function persat_handle_deal_links(string $path, string $method): void
{
    // POST /v1/deal-links
    if ($path === '/v1/deal-links' && $method === 'POST') {
        $sessionWallet = Auth::requireSession();
        $body = Http::body();

        $dealId = trim((string) ($body['dealId'] ?? ''));
        $initiator = trim((string) ($body['initiatorWallet'] ?? ''));
        $expiresInMinutes = (int) ($body['expiresInMinutes'] ?? 60);

        if ($dealId === '' || strlen($dealId) > 128) {
            Http::error('Invalid deal-link request', 400);
        }
        if ($initiator !== '' && $initiator !== $sessionWallet) {
            Http::error('initiatorWallet does not match authenticated session.', 403, [
                'sessionWallet' => $sessionWallet,
            ]);
        }
        if ($expiresInMinutes < 5 || $expiresInMinutes > 1440) {
            $expiresInMinutes = 60;
        }

        $pdo = Database::pdo();
        $existing = $pdo->prepare(
            'SELECT id FROM deal_links
             WHERE deal_id = ? AND claimed_at IS NULL AND expires_at > NOW()
             LIMIT 1'
        );
        $existing->execute([$dealId]);
        if ($existing->fetch()) {
            Http::error('An active deal link already exists for this deal.', 409);
        }

        $t = persat_create_deal_link_token();
        $id = Uuid::v4();
        $pdo->prepare(
            'INSERT INTO deal_links (id, deal_id, token_hash, initiator_wallet, expires_at)
             VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))'
        )->execute([$id, $dealId, $t['tokenHash'], $sessionWallet, $expiresInMinutes]);

        Http::json([
            'token'             => $t['token'],
            'expiresInMinutes'  => $expiresInMinutes,
            'dealId'            => $dealId,
            'initiatorWallet'   => $sessionWallet,
        ], 201);
    }

    // POST /v1/deal-links/:token/claim
    if ($method === 'POST' && preg_match('#^/v1/deal-links/([^/]+)/claim$#', $path, $m)) {
        $token = urldecode($m[1]);
        $body = Http::body();
        $wallet = trim((string) ($body['wallet'] ?? ''));
        if (strlen($wallet) < 32 || strlen($token) < 10) {
            Http::error('Invalid deal-link token or wallet', 400);
        }

        $hash = persat_deal_link_hash($token);
        $pdo = Database::pdo();
        $check = $pdo->prepare(
            'SELECT deal_id FROM deal_links
             WHERE token_hash = ? AND claimed_at IS NULL AND expires_at > NOW()
             LIMIT 1'
        );
        $check->execute([$hash]);
        $row = $check->fetch();
        if (!$row) {
            Http::error('This deal link is invalid, expired, or already used — single-use only.', 410);
        }

        $pdo->prepare(
            'UPDATE deal_links SET claimed_by_wallet = ?, claimed_at = NOW()
             WHERE token_hash = ? AND claimed_at IS NULL'
        )->execute([$wallet, $hash]);

        Http::json([
            'dealId'  => $row['deal_id'],
            'claimed' => true,
            'wallet'  => $wallet,
        ]);
    }

    // GET /v1/deal-links/:token/status
    if ($method === 'GET' && preg_match('#^/v1/deal-links/([^/]+)/status$#', $path, $m)) {
        $token = urldecode($m[1]);
        $hash = persat_deal_link_hash($token);
        $stmt = Database::pdo()->prepare(
            'SELECT deal_id, initiator_wallet, claimed_by_wallet, expires_at, claimed_at, created_at
             FROM deal_links WHERE token_hash = ? LIMIT 1'
        );
        $stmt->execute([$hash]);
        $row = $stmt->fetch();
        if (!$row) {
            Http::error('Link not found', 404);
        }
        Http::json($row);
    }

    Http::error('Not found', 404, ['path' => $path]);
}
