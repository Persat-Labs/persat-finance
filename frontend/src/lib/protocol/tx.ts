/**
 * Wallet transaction submission.
 *
 * Wraps the wallet-adapter flow: build → recent blockhash → wallet signature →
 * send → confirm with active status polling (so transactions resolve in 1-2s
 * instead of hanging on devnet WebSockets).
 */
import type { Connection, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { Transaction as Tx } from "@solana/web3.js";
import { describeFailure, type Failure } from "./errors";
import { explorerTx } from "./config";

export type WalletSigner = {
  publicKey: PublicKey | null;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
};

export type SendResult =
  | { ok: true; signature: string; explorerUrl: string }
  | { ok: false; failure: Failure };

const CONFIRM_TIMEOUT_MS = 35_000;

export async function sendAndConfirm(
  connection: Connection,
  wallet: WalletSigner,
  instructions: TransactionInstruction[],
): Promise<SendResult> {
  if (!wallet.publicKey) {
    return { ok: false, failure: { kind: "wallet-rejected", message: "Connect your wallet first." } };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const message = new Tx().add(...instructions);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      message.recentBlockhash = blockhash;
      message.feePayer = wallet.publicKey;

      const signed = await wallet.signTransaction(message);
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 4,
      });

      // Poll signature status actively so devnet confirms in 1-2s without waiting on WebSockets
      const outcome = await Promise.race([
        (async () => {
          for (let i = 0; i < 25; i++) {
            try {
              const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
              if (
                status?.value?.confirmationStatus === "confirmed" ||
                status?.value?.confirmationStatus === "finalized"
              ) {
                return { value: { err: status.value.err } };
              }
            } catch {
              // Transient RPC blip
            }
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
          return connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Confirmation timed out on Devnet.")), CONFIRM_TIMEOUT_MS),
        ),
      ]);

      if (outcome?.value?.err) {
        return { ok: false, failure: describeFailure({ message: "The transaction failed on-chain.", logs: [] }) };
      }
      return { ok: true, signature, explorerUrl: explorerTx(signature) };
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.kind === "blockhash-expired" && attempt === 0) continue;
      return { ok: false, failure };
    }
  }
  return { ok: false, failure: { kind: "unknown", message: "Transaction could not be confirmed on Devnet." } };
}
