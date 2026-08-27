<?php
declare(strict_types=1);

/**
 * Solana Crypto Helpers for PHP 8.2+
 * Utilizing PHP's native Libsodium extension.
 */
class SolanaCrypto {
    private static string $base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

    /**
     * Decode a Base58 string (Solana Public Keys and Signatures).
     */
    public static function base58Decode(string $base58): string {
        $alphabet = self::$base58Alphabet;
        $bytes = [0];

        for ($i = 0; $i < strlen($base58); $i++) {
            $char = $base58[$i];
            $value = strpos($alphabet, $char);
            if ($value === false) {
                throw new InvalidArgumentException("Invalid Base58 character: $char");
            }

            $carry = $value;
            for ($j = 0; $j < count($bytes); $j++) {
                $carry += $bytes[$j] * 58;
                $bytes[$j] = $carry & 0xff;
                $carry >>= 8;
            }

            while ($carry > 0) {
                $bytes[] = $carry & 0xff;
                $carry >>= 8;
            }
        }

        // Handle leading zeroes (which decode to 1s in Base58)
        for ($i = 0; $i < strlen($base58) && $base58[$i] === $alphabet[0]; $i++) {
            $bytes[] = 0;
        }

        return pack('C*', ...array_reverse($bytes));
    }

    /**
     * Verifies that a detached Ed25519 signature is valid for a given message and Solana public key.
     */
    public static function verifySignature(string $signatureBase58, string $message, string $publicKeyBase58): bool {
        try {
            $signature = self::base58Decode($signatureBase58);
            $publicKey = self::base58Decode($publicKeyBase58);

            if (strlen($signature) !== 64 || strlen($publicKey) !== 32) {
                return false;
            }

            return sodium_crypto_sign_verify_detached($signature, $message, $publicKey);
        } catch (Throwable $e) {
            return false;
        }
    }
}
