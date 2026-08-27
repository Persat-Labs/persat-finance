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

    // GET /api/messages?wallet=... [&partner=...]
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $wallet = $_GET['wallet'] ?? '';
        $partner = $_GET['partner'] ?? null;

        if (!$wallet) {
            http_response_code(400);
            echo json_encode(['error' => 'Wallet address required']);
            exit;
        }

        if ($partner) {
            $convId = implode('::', [min($wallet, $partner), max($wallet, $partner)]);
            $stmt = $pdo->prepare("SELECT * FROM direct_messages WHERE conversation_id = :conv ORDER BY created_at ASC");
            $stmt->execute(['conv' => $convId]);
            $rows = $stmt->fetchAll();
            echo json_encode(['messages' => $rows]);
            exit;
        }

        // List all conversations for this wallet
        $stmt = $pdo->prepare("
            SELECT * FROM direct_messages
            WHERE sender_wallet = :w1 OR recipient_wallet = :w2
            ORDER BY created_at DESC
        ");
        $stmt->execute(['w1' => $wallet, 'w2' => $wallet]);
        $rows = $stmt->fetchAll();
        echo json_encode(['messages' => $rows]);
        exit;
    }

    // POST /api/messages - Send message
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $sender = trim($body['sender_wallet'] ?? '');
        $recipient = trim($body['recipient_wallet'] ?? '');
        $text = trim($body['message_text'] ?? '');
        $dealProposal = $body['deal_proposal'] ?? null;

        if (!$sender || !$recipient || !$text) {
            http_response_code(400);
            echo json_encode(['error' => 'Sender, recipient, and message text are required']);
            exit;
        }

        $id = bin2hex(random_bytes(16));
        $convId = implode('::', [min($sender, $recipient), max($sender, $recipient)]);

        $stmt = $pdo->prepare("
            INSERT INTO direct_messages (id, conversation_id, sender_wallet, recipient_wallet, message_text, deal_proposal_json)
            VALUES (:id, :conv, :sender, :recipient, :msg, :proposal)
        ");

        $stmt->execute([
            'id' => $id,
            'conv' => $convId,
            'sender' => $sender,
            'recipient' => $recipient,
            'msg' => $text,
            'proposal' => $dealProposal ? json_encode($dealProposal) : null,
        ]);

        echo json_encode(['ok' => true, 'id' => $id]);
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
