"use client";
import { useState, useCallback } from "react";
import { Button, Modal } from "@/lib/design-system";
import { useProtocol } from "@/lib/protocol/hooks";
import { useDevnetBundle, dispenseTestnetAssets, DispenseResult } from "@/lib/protocol/bundle";

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
  const { isLoaded: isBundleLoaded, deployerKeypair, loadBundle } = useDevnetBundle();

  const [dispenseState, setDispenseState] = useState<{
    busy: boolean;
    result: DispenseResult | null;
    message: string;
  }>({ busy: false, result: null, message: "" });

  const handleDispense = useCallback(
    async (opts: { sol?: number; tbtc?: number; usdc?: number; usdt?: number }) => {
      if (!publicKey) return;

      if (!deployerKeypair) {
        setDispenseState({
          busy: false,
          result: null,
          message: "Please load your persat-devnet-keypairs-KEEP-SECRET.json file once to authorize automated test dispenser.",
        });
        return;
      }

      setDispenseState({ busy: true, result: null, message: "Dispensing assets on Solana Devnet…" });
      try {
        const res = await dispenseTestnetAssets({
          connection,
          deployerKeypair,
          recipient: publicKey,
          solAmount: opts.sol,
          tbtcAmount: opts.tbtc,
          usdcAmount: opts.usdc,
          usdtAmount: opts.usdt,
        });

        if (res.ok) {
          setDispenseState({
            busy: false,
            result: res,
            message: "Successfully funded wallet on Devnet!",
          });
          if (onSuccess) onSuccess();
        } else {
          setDispenseState({
            busy: false,
            result: res,
            message: `Dispense error: ${res.error ?? "Failed"}`,
          });
        }
      } catch (err) {
        setDispenseState({
          busy: false,
          result: null,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [connection, deployerKeypair, publicKey, onSuccess],
  );

  return (
    <Modal open={open} onClose={onClose} title="Fund Testnet Wallet">
      <div className="space-y-5">
        <p className="text-sm text-white/80 leading-6">
          {reason || "To test peer-to-peer Bitcoin-backed loans on Solana Devnet, your wallet needs a small amount of test SOL for gas and stand-in tokens."}
        </p>

        {publicKey ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 font-mono text-xs text-white/60 flex items-center justify-between">
              <span>Connected Target:</span>
              <span className="text-white font-semibold">{publicKey.toBase58().slice(0, 6)}…{publicKey.toBase58().slice(-4)}</span>
            </div>

            {!isBundleLoaded && (
              <div className="rounded-xl border border-amber/30 bg-amber/5 p-3.5 space-y-2 text-xs">
                <p className="text-amber font-semibold">One-Time Testnet Dispenser Authorization</p>
                <p className="text-white/70">
                  Select your local <code className="text-amber">persat-devnet-keypairs-KEEP-SECRET.json</code> to activate automated in-app funding (runs 100% in local browser memory):
                </p>
                <label className="inline-block cursor-pointer rounded-full border border-amber/50 bg-amber/15 px-4 py-2 font-mono text-[11px] text-amber hover:bg-amber/25 transition">
                  Choose Keypair JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        const text = event.target?.result as string;
                        if (text) loadBundle(text);
                      };
                      reader.readAsText(file);
                    }}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {/* Primary Action: Dispense Full Pack */}
            <Button
              className="w-full py-4 text-xs"
              disabled={!isBundleLoaded || dispenseState.busy}
              onClick={() => handleDispense({ sol: 0.5, tbtc: 0.1, usdc: 5000 })}
            >
              {dispenseState.busy ? "Dispensing On-Chain…" : "⚡ Dispense Full Pack (0.5 SOL + 0.1 tBTC + 5,000 USDC)"}
            </Button>

            {/* Quick Granular Chips */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button
                variant="secondary"
                disabled={!isBundleLoaded || dispenseState.busy}
                onClick={() => handleDispense({ sol: 0.5 })}
                className="text-[11px] py-2"
              >
                + 0.5 SOL
              </Button>
              <Button
                variant="secondary"
                disabled={!isBundleLoaded || dispenseState.busy}
                onClick={() => handleDispense({ tbtc: 0.1 })}
                className="text-[11px] py-2"
              >
                + 0.1 tBTC
              </Button>
              <Button
                variant="secondary"
                disabled={!isBundleLoaded || dispenseState.busy}
                onClick={() => handleDispense({ usdc: 5000 })}
                className="text-[11px] py-2"
              >
                + 5k USDC
              </Button>
              <Button
                variant="secondary"
                disabled={!isBundleLoaded || dispenseState.busy}
                onClick={() => handleDispense({ usdt: 5000 })}
                className="text-[11px] py-2"
              >
                + 5k USDT
              </Button>
            </div>

            {dispenseState.message && (
              <div
                className={`rounded-xl p-3 font-mono text-xs ${
                  dispenseState.result?.ok
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-white"
                    : "border border-amber/30 bg-black/40 text-amber"
                }`}
              >
                <p>{dispenseState.message}</p>
                {dispenseState.result?.explorerUrl && (
                  <a
                    href={dispenseState.result.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-amber underline hover:text-white"
                  >
                    View Confirmation on Solana Explorer ↗
                  </a>
                )}
              </div>
            )}
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
            className="font-ui-persat text-xs uppercase tracking-wider text-white/50 hover:text-white transition"
          >
            Maybe Later — Let Me Explore First
          </button>
        </div>
      </div>
    </Modal>
  );
}
