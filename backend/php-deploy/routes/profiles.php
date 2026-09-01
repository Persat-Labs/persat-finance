<?php
declare(strict_types=1);

/**
 * Persat Finance — /v1/profiles/* PHP routes.
 *
 * Canonical identity = Solana wallet address (SIWS-bound). `id` is an opaque
 * stable UUID (server-issued, never invented by the client) used for cache keys
 * and external links. Username uniqueness is enforced in MySQL (UNIQUE + server
 * check on write), NOT only in the client.
 *
 * Routes:
 *   GET  /v1/profiles/me                        -> auth, get-or-create own profile
 *   PUT  /v1/profiles/me                        -> auth, update own profile
 *   GET  /v1/profiles/username/:name/available  -> public availability (exclude ?wallet=)
 *   GET  /v1/profiles/:walletOrUsername         -> public read by wallet or username
 */

/** Unicode-safe string length (mbstring when available, else byte length). */
function persat_strlen(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s) : strlen($s);
}

/** Normalize a raw username: trim, lowercase, drop leading '@'. */
function persat_normalize_username(string $raw): string
{
    return strtolower(ltrim(trim($raw), '@'));
}

/** Validate username format (matches frontend constraints). Returns null if OK, else reason. */
function persat_validate_username(string $username): ?string
{
    if ($username === '') {
        return 'Username cannot be empty.';
    }
    if (strlen($username) < 3) {
        return 'Username must be at least 3 characters.';
    }
    if (strlen($username) > 20) {
        return 'Username cannot exceed 20 characters.';
    }
    if (!preg_match('/^[a-z0-9_]+$/', $username)) {
        return 'Only lowercase letters, numbers, and underscores allowed.';
    }
    return null;
}

/** Does this username already belong to a different wallet? */
function persat_username_taken(string $username, PDO $pdo, ?string $excludeWallet): bool
{
    if ($excludeWallet !== null && $excludeWallet !== '') {
        $stmt = $pdo->prepare('SELECT wallet FROM user_profiles WHERE username = ? AND wallet != ? LIMIT 1');
        $stmt->execute([$username, $excludeWallet]);
    } else {
        $stmt = $pdo->prepare('SELECT wallet FROM user_profiles WHERE username = ? LIMIT 1');
        $stmt->execute([$username]);
    }
    return (bool) $stmt->fetch();
}

/** Derive a unique default handle from a wallet, guaranteeing DB uniqueness. */
function persat_generate_default_username(string $wallet, PDO $pdo): string
{
    $base = strtolower('user_' . substr($wallet, 0, 4) . substr($wallet, -4));
    $candidate = $base;
    $i = 1;
    while (persat_username_taken($candidate, $pdo, $wallet)) {
        $candidate = $base . '_' . $i;
        $i++;
    }
    return $candidate;
}

/** Backfill a missing `id` UUID for rows created before the id column existed. */
function persat_ensure_profile_id(array $row, PDO $pdo): array
{
    if (!empty($row['id'])) {
        return $row;
    }
    $id = Uuid::v4();
    $pdo->prepare('UPDATE user_profiles SET id = ? WHERE wallet = ? AND (id IS NULL OR id = \'\')')
        ->execute([$id, $row['wallet']]);
    $row['id'] = $id;
    return $row;
}

/** Select a profile by wallet, creating a default row if none exists. */
function persat_get_or_create_profile(string $wallet, PDO $pdo): array
{
    $stmt = $pdo->prepare('SELECT * FROM user_profiles WHERE wallet = ? LIMIT 1');
    $stmt->execute([$wallet]);
    $row = $stmt->fetch();
    if ($row) {
        return persat_ensure_profile_id($row, $pdo);
    }

    $id = Uuid::v4();
    $username = persat_generate_default_username($wallet, $pdo);
    $pdo->prepare(
        'INSERT INTO user_profiles (id, wallet, username, display_name, avatar_seed)
         VALUES (?, ?, ?, ?, ?)'
    )->execute([$id, $wallet, $username, '@' . $username, substr($wallet, 0, 8)]);

    $stmt = $pdo->prepare('SELECT * FROM user_profiles WHERE wallet = ? LIMIT 1');
    $stmt->execute([$wallet]);
    return persat_ensure_profile_id($stmt->fetch(), $pdo);
}

/** Map a DB row to the public response shape (snake_case DB keys, stable ids). */
function persat_profile_payload(array $row): array
{
    return [
        'id'               => $row['id'] ?? null,
        'wallet'           => $row['wallet'] ?? null,
        'username'         => $row['username'] ?? '',
        'display_name'     => $row['display_name'] ?? '',
        'bio'              => $row['bio'] ?? '',
        'avatar_seed'      => $row['avatar_seed'] ?? '',
        'reputation_score' => (int) ($row['reputation_score'] ?? 100),
        'total_deals'      => (int) ($row['total_deals'] ?? 0),
        'active_loans'     => (int) ($row['active_loans'] ?? 0),
        'created_at'       => $row['created_at'] ?? null,
        'updated_at'       => $row['updated_at'] ?? null,
    ];
}

function persat_handle_profiles(string $path, string $method): void
{
    // ---------- GET /v1/profiles/me (auth; get-or-create) ----------
    if ($path === '/v1/profiles/me' && $method === 'GET') {
        $wallet = Auth::requireSession();
        $pdo = Database::pdo();
        $profile = persat_get_or_create_profile($wallet, $pdo);
        Http::json(['ok' => true, 'wallet' => $wallet, 'profile' => persat_profile_payload($profile)]);
    }

    // ---------- PUT /v1/profiles/me (auth; update) ----------
    if ($path === '/v1/profiles/me' && $method === 'PUT') {
        $wallet = Auth::requireSession();
        $body = Http::body();
        $pdo = Database::pdo();

        $usernameRaw = trim((string) ($body['username'] ?? ''));
        $displayName = trim((string) ($body['display_name'] ?? $body['displayName'] ?? ''));
        $bio         = trim((string) ($body['bio'] ?? ''));
        $avatarSeed  = trim((string) ($body['avatar_seed'] ?? $body['avatarSeed'] ?? ''));

        $username = persat_normalize_username($usernameRaw);

        $err = persat_validate_username($username);
        if ($err !== null) {
            Http::error($err, 400, ['field' => 'username']);
        }

        if (persat_username_taken($username, $pdo, $wallet)) {
            Http::error("Username @{$username} is already taken by another wallet.", 409, [
                'field'    => 'username',
                'username' => $username,
            ]);
        }

        // Ensure the row exists first (so a wallet that never visited /me can still edit).
        $profile = persat_get_or_create_profile($wallet, $pdo);

        if ($displayName === '') {
            $displayName = '@' . $username;
        }
        if (persat_strlen($displayName) > 64) {
            Http::error('Display name cannot exceed 64 characters.', 400, ['field' => 'display_name']);
        }
        if (persat_strlen($bio) > 1000) {
            Http::error('Bio cannot exceed 1000 characters.', 400, ['field' => 'bio']);
        }

        $pdo->prepare(
            'UPDATE user_profiles
             SET username = ?, display_name = ?, bio = ?, avatar_seed = ?
             WHERE wallet = ?'
        )->execute([$username, $displayName, $bio, $avatarSeed, $wallet]);

        $stmt = $pdo->prepare('SELECT * FROM user_profiles WHERE wallet = ? LIMIT 1');
        $stmt->execute([$wallet]);
        $updated = persat_ensure_profile_id($stmt->fetch(), $pdo);

        Http::json([
            'ok'      => true,
            'wallet'  => $wallet,
            'profile' => persat_profile_payload($updated),
        ]);
    }

    // ---------- GET /v1/profiles/username/:name/available ----------
    if ($method === 'GET' && preg_match('#^/v1/profiles/username/([^/]+)/available$#', $path, $m)) {
        $rawName = urldecode($m[1]);
        $wallet = trim((string) ($_GET['wallet'] ?? ''));
        $username = persat_normalize_username($rawName);

        $err = persat_validate_username($username);
        if ($err !== null) {
            Http::json(['available' => false, 'reason' => $err]);
        }

        $pdo = Database::pdo();
        if (persat_username_taken($username, $pdo, $wallet !== '' ? $wallet : null)) {
            Http::json([
                'available' => false,
                'reason'    => "@{$username} is already claimed by another wallet.",
                'username'  => $username,
            ]);
        }

        Http::json(['available' => true, 'username' => $username]);
    }

    // ---------- GET /v1/profiles/:walletOrUsername ----------
    if ($method === 'GET' && preg_match('#^/v1/profiles/([^/]+)$#', $path, $m)) {
        $identifier = urldecode($m[1]);
        $pdo = Database::pdo();

        // Solana wallets are base58 (32–44 chars). Usernames are 3–20 chars.
        // Disambiguate by length so a wallet and handle never collide.
        $searchWallet = strlen($identifier) >= 32 && strlen($identifier) <= 44;

        if ($searchWallet) {
            $stmt = $pdo->prepare('SELECT * FROM user_profiles WHERE wallet = ? LIMIT 1');
            $stmt->execute([$identifier]);
        } else {
            $normalized = persat_normalize_username($identifier);
            $stmt = $pdo->prepare('SELECT * FROM user_profiles WHERE username = ? LIMIT 1');
            $stmt->execute([$normalized]);
        }

        $row = $stmt->fetch();
        if ($row) {
            Http::json(['ok' => true, 'profile' => persat_profile_payload(persat_ensure_profile_id($row, $pdo))]);
        }

        Http::json(['ok' => true, 'profile' => null], 404);
    }

    Http::error('Not found', 404, ['path' => $path]);
}
