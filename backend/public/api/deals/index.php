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

    // GET /api/deals?deal_id=...
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $dealId = $_GET['deal_id'] ?? '';
        if (!$dealId) {
            http_response_code(400);
            echo json_encode(['error' => 'deal_id required']);
            exit;
        }

        $stmt = $pdo->prepare("SELECT * FROM deal_links WHERE deal_id = :id LIMIT 1");
        $stmt->execute(['id' => $dealId]);
        $row = $stmt->fetch();

        echo json_encode(['deal' => $row ?: null]);
        exit;
    }

    // POST /api/deals
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $dealId = trim($body['deal_id'] ?? '');
        $initiator = trim($body['initiator_wallet'] ?? '');
        $termsJson = $body['terms'] ?? null;
        $expiresHours = (int)($body['expires_in_hours'] ?? 72);

        if (!$dealId || !$initiator) {
            http_response_code(400);
            echo json_encode(['error' => 'deal_id and initiator_wallet required']);
            exit;
        }

        $id = bin2hex(random_bytes(16));
        $tokenHash = hash('sha256', $dealId . bin2hex(random_bytes(16)));
        $expiresAt = date('Y-m-d H:i:s', time() + ($expiresHours * 3600));

        $stmt = $pdo->prepare("
            INSERT INTO deal_links (id, deal_id, token_hash, initiator_wallet, terms_json, expires_at)
            VALUES (:id, :deal_id, :token_hash, :initiator, :terms, :expires_at)
            ON DUPLICATE KEY UPDATE terms_json = VALUES(terms_json)
        ");

        $stmt->execute([
            'id' => $id,
            'deal_id' => $dealId,
            'token_hash' => $tokenHash,
            'initiator' => $initiator,
            'terms' => $termsJson ? json_encode($termsJson) : null,
            'expires_at' => $expiresAt,
        ]);

        echo json_encode(['ok' => true, 'deal_id' => $dealId, 'token_hash' => $tokenHash]);
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
