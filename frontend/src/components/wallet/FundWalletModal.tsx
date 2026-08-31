"use client";
import { useState, useCallback, useEffect } from "react";
import { Button, Modal } from "@/lib/design-system";
import { useProtocol } from "@/lib/protocol/hooks";
import { api } from "@/lib/api";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

type ClaimState = {
  busy: boolean;
  ok: boolean | null;
  message: string;
  explorerUrl?: string;
};

/**
 * One-click test funds — no keypair JSON upload.
 * Hits POST /v1/faucet/claim + /v1/faucet/auto on the API (server dispenser when
 * PERSAT_DEPLOYER_KEYPAIR is set). Falls back to public Devnet SOL airdrop.
 */
export function FundWalletModal({
  open,
  onClose,
  onSuccess,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  reason?: string;
}) {
  const { connection, publicKey } = useProtocol();
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [state, setState] = useState<ClaimState>({ busy: false, ok: null, message: "" });

  useEffect(() => {
    if (!open || !publicKey) {
      setServerReady(null);
      return;
    }
    let cancelled = false;
    api
      .faucetStatus(publicKey.toBase58())
      .then((res: { serverDispenseAvailable?: boolean }) => {
        if (!cancelled) setServerReady(Boolean(res?.serverDispenseAvailable));
      })
      .catch(() => {
        if (!cancelled) setServerReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, publicKey]);

  useEffect(() => {
    if (!open) setState({ busy: false, ok: null, message: "" });
  }, [open]);

  const claimFullPack = useCallback(async () => {
    if (!publicKey) return;
    const wallet = publicKey.toBase58();
    setState({
      busy: true,
      ok: null,
      message: "Requesting full pack from treasury — 0.5 SOL + tBTC + zBTC + BTC + USDC + USDT…",
    });

    try {
      // Prefer dedicated auto endpoint when present
      const autoRes = await api.faucetAuto(wallet, "ALL").catch((err: Error) => ({
        ok: false as const,
        error: err.message,
        message: err.message,
      }));

      if (autoRes?.ok && (autoRes.signature || autoRes.mode === "server_dispense")) {
        setState({
          busy: false,
          ok: true,
          message: autoRes.message || "Full pack dispensed to your wallet on Devnet.",
          explorerUrl: autoRes.explorerUrl,
        });
        onSuccess?.();
        return;
      }

      const claim = await api.faucetClaim(wallet, "ALL").catch((err: Error) => ({
        ok: false as const,
        error: err.message,
        message: err.message,
      }));

      if (claim?.error && String(claim.error).toLowerCase().includes("cooldown")) {
        setState({ busy: false, ok: false, message: String(claim.error) });
        return;
      }

      if (claim?.ok && (claim.mode === "server_dispense" || claim.signature)) {
        setState({
          busy: false,
          ok: true,
          message: claim.message || "Full pack dispensed to your wallet on Devnet.",
          explorerUrl: claim.explorerUrl,
        });
        onSuccess?.();
        return;
      }

      // API missing deployer key / unreachable — try public SOL airdrop so user isn't stuck
      try {
        setState({
          busy: true,
          ok: null,
          message: "Treasury auto-mint not live yet — claiming 1 Devnet SOL from public faucet…",
        });
        const sig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
        setState({
          busy: false,
          ok: true,
          message:
            "Received 1 Devnet SOL. Full SPL pack (tBTC/zBTC/USDC/USDT) needs PERSAT_DEPLOYER_KEYPAIR on the Node API — see docs/FAUCET_AND_KEEPER_LIVE.md.",
          explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
        });
        onSuccess?.();
        return;
      } catch (airdropErr) {
        const hint = [
          typeof claim === "object" && claim && "message" in claim ? claim.message : null,
          typeof autoRes === "object" && autoRes && "message" in autoRes ? autoRes.message : null,
          typeof autoRes === "object" && autoRes && "error" in autoRes ? autoRes.error : null,
          airdropErr instanceof Error ? airdropErr.message : String(airdropErr),
        ]
          .filter(Boolean)
          .join(" · ");
        setState({
          busy: false,
          ok: false,
          message: `Could not fund wallet yet. ${hint || "API unreachable / airdrop rate-limited"}. Open /faucet or faucet.solana.com. Full pack: set PERSAT_DEPLOYER_KEYPAIR on Node API (docs/FAUCET_AND_KEEPER_LIVE.md).`,
        });
      }
    } catch (err) {
      setState({
        busy: false,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [connection, publicKey, onSuccess]);

  return (
    <Modal open={open} onClose={onClose} title="Claim Test Funds">
      <div className="space-y-5">
        <p className="text-sm leading-6 text-white/80">
          {reason ||
            "One click funds your connected wallet on Solana Devnet — no file upload, no keypair JSON. Full pack when the API treasury is configured; otherwise public Devnet SOL."}
        </p>

        {publicKey ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 font-mono text-xs text-white/60">
              <span>Connected</span>
              <span className="font-semibold text-white">
                {publicKey.toBase58().slice(0, 6)}…{publicKey.toBase58().slice(-4)}
              </span>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 font-mono text-[11px] text-white/50">
              {serverReady === null && <p>Checking treasury dispenser…</p>}
              {serverReady === true && (
                <p className="text-emerald-400">● Server auto-dispense available — full pack ready</p>
              )}
              {serverReady === false && (
                <p className="text-amber">
                  ○ Full SPL pack needs API deployer key. You can still claim public Devnet SOL in one click.
                </p>
              )}
            </div>

            <Button className="w-full py-4 text-xs font-semibold" disabled={state.busy} onClick={() => void claimFullPack()}>
              {state.busy ? "Funding wallet…" : "⚡ Claim Full Pack — One Click"}
            </Button>

            <p className="text-center font-mono text-[10px] text-white/40">
              0.5 SOL · 0.1 tBTC · 0.1 zBTC · 0.1 BTC · 5k USDC · 5k USDT · 24h cooldown
            </p>

            {state.message && (
              <div
                className={`rounded-xl p-3 font-mono text-xs ${
                  state.ok
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-white"
                    : state.ok === false
                      ? "border border-amber/30 bg-black/40 text-amber"
                      : "border border-white/10 bg-white/[0.03] text-white/70"
                }`}
              >
                <p>{state.message}</p>
                {state.explorerUrl && (
                  <a
                    href={state.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-amber underline hover:text-white"
                  >
                    View on Solana Explorer ↗
                  </a>
                )}
              </div>
            )}

            <p className="text-center font-mono text-[11px] text-white/40">
              Prefer the full faucet page?{" "}
              <a href="/faucet" className="text-amber hover:underline">
                Open /faucet →
              </a>
            </p>
          </div>
        ) : (
          <div className="py-4 text-center">
            <p className="font-mono text-xs text-white/50">Connect a wallet to receive test assets.</p>
          </div>
        )}

        <div className="border-t border-white/10 pt-3 text-center">
          <button
            type="button"
            onClick={onClose}
            className="font-ui text-xs uppercase tracking-wider text-white/50 transition hover:text-white"
          >
            Maybe Later — Let Me Explore First
          </button>
        </div>
      </div>
    </Modal>
  );
}
