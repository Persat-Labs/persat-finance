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

try {
    $pdo = Database::getConnection();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $wallet = trim($body['wallet'] ?? '');

    if (!$wallet) {
        http_response_code(400);
        echo json_encode(['error' => 'Wallet address required']);
        exit;
    }

    $id = bin2hex(random_bytes(16));
    $nonce = bin2hex(random_bytes(32));
    $nonceHash = hash('sha256', $nonce);
    $issuedAt = gmdate('Y-m-d\TH:i:s\Z');
    $expiresAt = date('Y-m-d H:i:s', time() + 300); // 5 minutes

    $message = "Persat Finance Sign-In\nWallet: {$wallet}\nNonce: {$nonce}\nIssued At: {$issuedAt}";

    $stmt = $pdo->prepare("
        INSERT INTO wallet_auth_challenges (id, wallet, nonce_hash, message, expires_at)
        VALUES (:id, :wallet, :hash, :msg, :exp)
    ");
    $stmt->execute([
        'id' => $id,
        'wallet' => $wallet,
        'hash' => $nonceHash,
        'msg' => $message,
        'exp' => $expiresAt,
    ]);

    echo json_encode([
        'ok' => true,
        'challenge_id' => $id,
        'message' => $message,
        'expires_at' => $expiresAt,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
