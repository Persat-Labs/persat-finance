<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/../../src/Database.php';

try {
    $pdo = Database::getConnection();

    // GET /api/profiles?wallet=... OR ?username=...
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $wallet = $_GET['wallet'] ?? null;
        $username = $_GET['username'] ?? null;

        if ($wallet) {
            $stmt = $pdo->prepare("SELECT * FROM user_profiles WHERE wallet = :val LIMIT 1");
            $stmt->execute(['val' => $wallet]);
            $row = $stmt->fetch();
            echo json_encode(['profile' => $row ?: null]);
            exit;
        }

        if ($username) {
            $cleanUser = ltrim(strtolower(trim($username)), '@');
            $stmt = $pdo->prepare("SELECT * FROM user_profiles WHERE LOWER(username) = :val LIMIT 1");
            $stmt->execute(['val' => $cleanUser]);
            $row = $stmt->fetch();
            echo json_encode(['profile' => $row ?: null]);
            exit;
        }

        http_response_code(400);
        echo json_encode(['error' => 'Missing wallet or username parameter']);
        exit;
    }

    // POST /api/profiles - create or update profile
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $wallet = trim($body['wallet'] ?? '');
        $username = ltrim(strtolower(trim($body['username'] ?? '')), '@');
        $displayName = trim($body['display_name'] ?? '');
        $bio = trim($body['bio'] ?? '');
        $avatarSeed = trim($body['avatar_seed'] ?? '');

        if (!$wallet || !$username) {
            http_response_code(400);
            echo json_encode(['error' => 'Wallet and username are required']);
            exit;
        }

        $stmt = $pdo->prepare("
            INSERT INTO user_profiles (wallet, username, display_name, bio, avatar_seed)
            VALUES (:wallet, :username, :display_name, :bio, :avatar_seed)
            ON DUPLICATE KEY UPDATE
              username = VALUES(username),
              display_name = VALUES(display_name),
              bio = VALUES(bio),
              avatar_seed = VALUES(avatar_seed)
        ");

        $stmt->execute([
            'wallet' => $wallet,
            'username' => $username,
            'display_name' => $displayName ?: "@{$username}",
            'bio' => $bio,
            'avatar_seed' => $avatarSeed,
        ]);

        echo json_encode(['ok' => true, 'message' => 'Profile saved successfully']);
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
