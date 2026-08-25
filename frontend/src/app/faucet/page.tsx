"use client";
import { useState } from "react";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card } from "@/lib/design-system";
import { useProtocol } from "@/lib/protocol/hooks";
import { MINTS, explorerAddress } from "@/lib/protocol/config";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export default function Faucet() {
  const { connection, publicKey } = useProtocol();
  const [airdropState, setAirdropState] = useState<{ status: "idle" | "busy" | "ok" | "err"; message: string }>({ status: "idle", message: "" });

  async function claimSol() {
    if (!publicKey) return;
    setAirdropState({ status: "busy", message: "Requesting Devnet SOL…" });
    try {
      const signature = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature, "confirmed");
      setAirdropState({ status: "ok", message: "1 Devnet SOL claimed." });
    } catch (error) {
      setAirdropState({ status: "err", message: error instanceof Error ? error.message : "Airdrop failed — the public faucet is rate-limited; retry shortly." });
    }
  }

  const mintEntries = Object.entries(MINTS) as [string, typeof MINTS[keyof typeof MINTS]][];

  return (
    <AppFrame eyebrow="Testnet utility" title="Get test assets">
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <p className="eyebrow">Network fees</p>
          <h2 className="mt-3 font-display text-2xl uppercase">Devnet SOL</h2>
          <p className="mt-3 text-sm leading-6 text-orange-50">Every on-chain action needs a little SOL for fees. Claim 1 Devnet SOL to the connected wallet (public faucet, rate-limited).</p>
          <Button className="mt-7 w-full" disabled={!publicKey || airdropState.status === "busy"} onClick={claimSol}>
            {airdropState.status === "busy" ? "Claiming…" : publicKey ? "Claim 1 Devnet SOL" : "Connect wallet to claim"}
          </Button>
          {airdropState.status !== "idle" && (
            <p role="status" className={`mt-4 text-sm ${airdropState.status === "err" ? "text-orange-50" : "text-white"}`}>{airdropState.message}</p>
          )}
        </Card>

        <Card>
          <p className="eyebrow">Loan currency &amp; collateral</p>
          <h2 className="mt-3 font-display text-2xl uppercase">Stand-in tokens</h2>
          <p className="mt-3 text-sm leading-6 text-orange-50">
            tBTC / zBTC / USDC / USDT stand-ins are minted by the operator while testing. Ping the keeper channel with your wallet address to receive test collateral and stablecoins.
          </p>
          <ul className="mt-5 space-y-2 font-mono text-xs">
            {mintEntries.map(([symbol, mint]) => (
              <li key={symbol} className="flex justify-between gap-3">
                <span className="text-orange-50">{symbol}</span>
                {mint ? <a className="text-amber underline" href={explorerAddress(mint)} target="_blank" rel="noopener noreferrer">{mint.toBase58().slice(0, 16)}…</a> : <span className="text-orange-50/60">published after first deploy</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppFrame>
  );
}
