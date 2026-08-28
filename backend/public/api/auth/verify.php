<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/../../../src/Database.php';
require_once __DIR__ . '/../../../src/SolanaCrypto.php';

try {
    $pdo = Database::getConnection();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    $wallet = trim($body['wallet'] ?? '');
    $challengeId = trim($body['challenge_id'] ?? '');
    $signature = trim($body['signature'] ?? '');

    if (!$wallet || !$challengeId || !$signature) {
        http_response_code(400);
        echo json_encode(['error' => 'wallet, challenge_id, and signature are required']);
        exit;
    }

    $stmt = $pdo->prepare("SELECT * FROM wallet_auth_challenges WHERE id = :id AND wallet = :wallet LIMIT 1");
    $stmt->execute(['id' => $challengeId, 'wallet' => $wallet]);
    $challenge = $stmt->fetch();

    if (!$challenge) {
        http_response_code(404);
        echo json_encode(['error' => 'Auth challenge not found']);
        exit;
    }

    if ($challenge['used_at'] !== null) {
        http_response_code(400);
        echo json_encode(['error' => 'Auth challenge has already been used']);
        exit;
    }

    if (strtotime($challenge['expires_at']) < time()) {
        http_response_code(400);
        echo json_encode(['error' => 'Auth challenge has expired']);
        exit;
    }

    // Verify Ed25519 signature
    $valid = SolanaCrypto::verifySignature($signature, $challenge['message'], $wallet);
    if (!$valid) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid Solana wallet signature']);
        exit;
    }

    // Mark challenge as used
    $pdo->prepare("UPDATE wallet_auth_challenges SET used_at = NOW() WHERE id = :id")->execute(['id' => $challengeId]);

    // Issue session token
    $sessionId = bin2hex(random_bytes(16));
    $sessionToken = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $sessionToken);
    $sessionExpires = date('Y-m-d H:i:s', time() + (86400 * 7)); // 7 days

    $pdo->prepare("
        INSERT INTO wallet_sessions (id, wallet, token_hash, expires_at)
        VALUES (:id, :wallet, :token, :exp)
    ")->execute([
        'id' => $sessionId,
        'wallet' => $wallet,
        'token' => $tokenHash,
        'exp' => $sessionExpires,
    ]);

    echo json_encode([
        'ok' => true,
        'wallet' => $wallet,
        'session_token' => $sessionToken,
        'expires_at' => $sessionExpires,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
