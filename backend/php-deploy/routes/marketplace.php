<?php
declare(strict_types=1);

function persat_handle_marketplace(string $path, string $method): void
{
    // GET /v1/marketplace/listings
    if ($path === '/v1/marketplace/listings' && $method === 'GET') {
        try {
            $stmt = Database::pdo()->query(
                "SELECT id, listing_id, proposer_wallet, principal_atoms, loan_mint, rate_bps,
                        duration_months, collateral_ltv_bps, status, created_at
                 FROM marketplace_proposals
                 WHERE status = 'pending'
                 ORDER BY created_at DESC
                 LIMIT 100"
            );
            $rows = $stmt->fetchAll();
            Http::json(['listings' => $rows, 'count' => count($rows)]);
        } catch (Throwable $e) {
            Http::json(['listings' => [], 'count' => 0, 'mode' => 'no_persistence_fallback_to_client']);
        }
    }

    // GET /v1/marketplace/proposals/:listingId
    if ($method === 'GET' && preg_match('#^/v1/marketplace/proposals/([0-9a-fA-F-]{36})$#', $path, $m)) {
        $listingId = $m[1];
        try {
            $stmt = Database::pdo()->prepare(
                "SELECT id, proposer_wallet, principal_atoms, loan_mint, rate_bps,
                        duration_months, collateral_ltv_bps, status, created_at
                 FROM marketplace_proposals
                 WHERE listing_id = ?
                 ORDER BY created_at DESC
                 LIMIT 50"
            );
            $stmt->execute([$listingId]);
            Http::json(['listingId' => $listingId, 'proposals' => $stmt->fetchAll()]);
        } catch (Throwable $e) {
            Http::json(['listingId' => $listingId, 'proposals' => [], 'mode' => 'no_persistence']);
        }
    }

    // POST /v1/marketplace/proposals
    if ($path === '/v1/marketplace/proposals' && $method === 'POST') {
        $sessionWallet = Auth::requireSession();
        $body = Http::body();

        $listingId = trim((string) ($body['listingId'] ?? ''));
        $proposer  = trim((string) ($body['proposerWallet'] ?? ''));
        $terms     = $body['terms'] ?? null;

        if ($proposer !== '' && $proposer !== $sessionWallet) {
            Http::error('proposerWallet does not match authenticated session.', 403, [
                'sessionWallet' => $sessionWallet,
            ]);
        }
        $proposer = $sessionWallet;

        if (!preg_match('/^[0-9a-fA-F-]{36}$/', $listingId)) {
            Http::error('Invalid structured proposal', 400, ['field' => 'listingId']);
        }
        if (!is_array($terms)) {
            Http::error('Invalid structured proposal', 400, ['field' => 'terms']);
        }

        $principal = (string) ($terms['principalAtoms'] ?? '');
        $loanMint  = (string) ($terms['loanMint'] ?? '');
        $rateBps   = (int) ($terms['rateBps'] ?? 0);
        $duration  = (int) ($terms['durationMonths'] ?? 0);
        $ltvBps    = (int) ($terms['collateralLtvBps'] ?? 0);

        if (!preg_match('/^\d+$/', $principal)) {
            Http::error('principalAtoms must be an unsigned integer string', 400);
        }
        if (!in_array($loanMint, ['USDC', 'USDT'], true)) {
            Http::error('loanMint must be USDC or USDT', 400);
        }
        if ($rateBps < 1 || $rateBps > 100000) {
            Http::error('rateBps out of range', 400);
        }
        if (!in_array($duration, [6, 12, 24], true)) {
            Http::error('durationMonths must be 6, 12, or 24', 400);
        }
        if ($ltvBps < 1 || $ltvBps > 5000) {
            Http::error('collateralLtvBps out of range', 400);
        }

        $pdo = Database::pdo();
        $existing = $pdo->prepare(
            "SELECT id FROM marketplace_proposals
             WHERE listing_id = ? AND proposer_wallet = ? AND status = 'pending' LIMIT 1"
        );
        $existing->execute([$listingId, $proposer]);
        if ($existing->fetch()) {
            Http::error('You already have a pending proposal for this listing.', 409);
        }

        $id = Uuid::v4();
        $pdo->prepare(
            'INSERT INTO marketplace_proposals
             (id, listing_id, proposer_wallet, principal_atoms, loan_mint, rate_bps, duration_months, collateral_ltv_bps)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$id, $listingId, $proposer, $principal, $loanMint, $rateBps, $duration, $ltvBps]);

        $row = $pdo->prepare(
            'SELECT id, status, created_at FROM marketplace_proposals WHERE id = ? LIMIT 1'
        );
        $row->execute([$id]);
        Http::json(['proposal' => $row->fetch(), 'proposerWallet' => $proposer], 201);
    }

    Http::error('Not found', 404, ['path' => $path]);
}
