/**
 * Wallet transaction submission.
 *
 * Wraps the wallet-adapter flow: build → recent blockhash → wallet signature →
 * send → confirm, with one retry for transient blockhash expiry and human
 * error reporting via describeFailure.
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

const CONFIRM_TIMEOUT_MS = 60_000;

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

      const outcome = await Promise.race([
        connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Confirmation timed out.")), CONFIRM_TIMEOUT_MS),
        ),
      ]);
      if (outcome?.value?.err) {
        return { ok: false, failure: describeFailure({ message: "The transaction failed on-chain.", logs: [] }) };
      }
      return { ok: true, signature, explorerUrl: explorerTx(signature) };
    } catch (error) {
      const failure = describeFailure(error);
      // Blockhash expiry is the one failure worth retrying with a fresh hash.
      if (failure.kind === "blockhash-expired" && attempt === 0) continue;
      return { ok: false, failure };
    }
  }
  return { ok: false, failure: { kind: "unknown", message: "Transaction could not be sent." } };
}
