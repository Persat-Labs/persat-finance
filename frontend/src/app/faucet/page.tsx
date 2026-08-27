"use client";
import { useState, useCallback, useEffect, ChangeEvent } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input } from "@/lib/design-system";
import { useProtocol } from "@/lib/protocol/hooks";
import { MINTS, explorerAddress } from "@/lib/protocol/config";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useDevnetBundle, dispenseTestnetAssets, DispenseResult } from "@/lib/protocol/bundle";

export default function Faucet() {
  const { connection, publicKey } = useProtocol();
  const { setVisible } = useWalletModal();
  const {
    isLoaded: isBundleLoaded,
    deployerKeypair,
    deployerPubkey,
    operatorPubkey,
    loadBundle,
    unloadBundle,
    autoFund,
    setAutoFundEnabled,
  } = useDevnetBundle();

  const [airdropState, setAirdropState] = useState<{ status: "idle" | "busy" | "ok" | "err"; message: string }>({
    status: "idle",
    message: "",
  });

  const [dispenseState, setDispenseState] = useState<{
    busy: boolean;
    result: DispenseResult | null;
    message: string;
  }>({ busy: false, result: null, message: "" });

  const [customRecipient, setCustomRecipient] = useState("");
  const [manualJson, setManualJson] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);

  // Fetch current wallet SOL balance
  const refreshBalance = useCallback(async () => {
    if (!publicKey) {
      setSolBalance(null);
      return;
    }
    try {
      const lamports = await connection.getBalance(publicKey, "confirmed");
      setSolBalance(lamports / LAMPORTS_PER_SOL);
    } catch {
      // Ignore
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  // Handle JSON file upload
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const res = loadBundle(text);
        if (res.ok) {
          setDispenseState({ busy: false, result: null, message: res.message });
        } else {
          setDispenseState({ busy: false, result: null, message: `Error: ${res.message}` });
        }
      }
    };
    reader.readAsText(file);
  };

  // Dispense assets directly
  const handleDispense = useCallback(
    async (
      targetPubkey: PublicKey,
      opts: { sol?: number; tbtc?: number; usdc?: number; usdt?: number },
    ) => {
      if (!deployerKeypair) {
        setDispenseState({
          busy: false,
          result: null,
          message: "Upload persat-devnet-keypairs-KEEP-SECRET.json first to activate the dispenser.",
        });
        return;
      }

      setDispenseState({ busy: true, result: null, message: "Dispensing assets on Devnet…" });
      try {
        const res = await dispenseTestnetAssets({
          connection,
          deployerKeypair,
          recipient: targetPubkey,
          solAmount: opts.sol,
          tbtcAmount: opts.tbtc,
          usdcAmount: opts.usdc,
          usdtAmount: opts.usdt,
        });

        if (res.ok) {
          setDispenseState({
            busy: false,
            result: res,
            message: `Successfully dispensed to ${targetPubkey.toBase58().slice(0, 4)}…${targetPubkey.toBase58().slice(-4)}!`,
          });
          await refreshBalance();
        } else {
          setDispenseState({
            busy: false,
            result: res,
            message: `Dispense failed: ${res.error ?? "Unknown error"}`,
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
    [connection, deployerKeypair, refreshBalance],
  );

  // Auto-fund connected wallet if it has 0 SOL
  useEffect(() => {
    if (!autoFund || !isBundleLoaded || !deployerKeypair || !publicKey || solBalance === null) return;
    if (solBalance < 0.1 && !dispenseState.busy) {
      // Automatically fund test pack
      void handleDispense(publicKey, { sol: 0.5, tbtc: 0.1, usdc: 5000 });
    }
  }, [autoFund, isBundleLoaded, deployerKeypair, publicKey, solBalance, dispenseState.busy, handleDispense]);

  // Standard public faucet
  async function claimPublicSol() {
    if (!publicKey) return;
    setAirdropState({ status: "busy", message: "Requesting Devnet SOL from public faucet…" });
    try {
      const signature = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature, "confirmed");
      setAirdropState({ status: "ok", message: "1 Devnet SOL claimed." });
      await refreshBalance();
    } catch (error) {
      setAirdropState({
        status: "err",
        message: error instanceof Error ? error.message : "Airdrop rate-limited. Use the automated dispenser above or faucet.solana.com.",
      });
    }
  }

  const mintEntries = Object.entries(MINTS) as [string, (typeof MINTS)[keyof typeof MINTS]][];

  return (
    <AppFrame eyebrow="Testnet Utility" title="Automated Faucet & Dispenser">
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Left Column: 1-Click Automated Dispenser */}
        <div className="space-y-6 lg:col-span-2">
          {/* Keypair Loader Card */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Dispenser Authority</p>
                <h2 className="mt-1 font-display text-xl uppercase">Operator Keypair Bundle</h2>
              </div>
              <span
                className={`rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
                  isBundleLoaded
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-amber/30 bg-surface text-amber"
                }`}
              >
                {isBundleLoaded ? "● Dispenser Active" : "○ Bundle Required"}
              </span>
            </div>

            {isBundleLoaded ? (
              <div className="mt-4 space-y-3 font-mono text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber/10 pb-2">
                  <span className="text-orange-50">Deployer (Mint Authority):</span>
                  <span className="text-white">{deployerPubkey?.slice(0, 16)}…</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber/10 pb-2">
                  <span className="text-orange-50">Operator (Keeper):</span>
                  <span className="text-white">{operatorPubkey?.slice(0, 16)}…</span>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-4 pt-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-orange-50">
                    <input
                      type="checkbox"
                      checked={autoFund}
                      onChange={(e) => setAutoFundEnabled(e.target.checked)}
                      className="accent-amber"
                    />
                    <span>Auto-fund new wallets upon connection (0.5 SOL + 0.1 tBTC + 5k USDC)</span>
                  </label>
                  <Button variant="secondary" onClick={unloadBundle} className="text-xs">
                    Unload Bundle
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <p className="text-sm leading-6 text-orange-50">
                  Upload your local <code className="text-amber">persat-devnet-keypairs-KEEP-SECRET.json</code> file to
                  activate the automated dispenser. The keys stay 100% in your local browser memory and never leave your machine.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="cursor-pointer rounded border border-amber bg-amber/10 px-5 py-3 font-mono text-xs uppercase tracking-widest text-amber transition hover:bg-amber/20 hover:text-white">
                    Select Keypair JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  <Button variant="secondary" onClick={() => setShowPaste(!showPaste)}>
                    {showPaste ? "Hide Text Paste" : "Paste JSON Directly"}
                  </Button>
                </div>

                {showPaste && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={manualJson}
                      onChange={(e) => setManualJson(e.target.value)}
                      placeholder="Paste content of persat-devnet-keypairs-KEEP-SECRET.json here..."
                      className="h-28 w-full rounded border border-amber/20 bg-surfaceDeep p-3 font-mono text-xs text-white"
                    />
                    <Button
                      onClick={() => {
                        const res = loadBundle(manualJson);
                        setDispenseState({
                          busy: false,
                          result: null,
                          message: res.ok ? res.message : `Error: ${res.message}`,
                        });
                        if (res.ok) setManualJson("");
                      }}
                    >
                      Load From Text
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* 1-Click Dispenser Card */}
          <Card>
            <p className="eyebrow">Zero-Friction Testing</p>
            <h2 className="mt-1 font-display text-2xl uppercase">1-Click Test Pack Dispenser</h2>
            <p className="mt-2 text-sm leading-6 text-orange-50">
              Instantly creates token accounts, transfers SOL, and mints test collateral and loan capital in a single atomic transaction.
            </p>

            {publicKey ? (
              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber/15 bg-surfaceDeep p-3 font-mono text-xs">
                  <span className="text-orange-50">Target: {publicKey.toBase58().slice(0, 8)}…{publicKey.toBase58().slice(-8)}</span>
                  <span className="text-amber">
                    Balance: {solBalance !== null ? `${solBalance.toFixed(3)} SOL` : "…"}
                  </span>
                </div>

                <Button
                  className="w-full py-4 text-sm"
                  disabled={!isBundleLoaded || dispenseState.busy}
                  onClick={() => handleDispense(publicKey, { sol: 0.5, tbtc: 0.1, usdc: 5000 })}
                >
                  {dispenseState.busy
                    ? "Dispensing On-Chain…"
                    : "⚡ Dispense Full Pack (0.5 SOL + 0.1 tBTC + 5,000 USDC)"}
                </Button>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button
                    variant="secondary"
                    disabled={!isBundleLoaded || dispenseState.busy}
                    onClick={() => handleDispense(publicKey, { sol: 0.5 })}
                  >
                    + 0.5 SOL
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!isBundleLoaded || dispenseState.busy}
                    onClick={() => handleDispense(publicKey, { tbtc: 0.1 })}
                  >
                    + 0.1 tBTC
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!isBundleLoaded || dispenseState.busy}
                    onClick={() => handleDispense(publicKey, { usdc: 5000 })}
                  >
                    + 5k USDC
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!isBundleLoaded || dispenseState.busy}
                    onClick={() => handleDispense(publicKey, { usdt: 5000 })}
                  >
                    + 5k USDT
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-6">
                <Button className="w-full" onClick={() => setVisible(true)}>
                  Connect Wallet to Dispense Assets
                </Button>
              </div>
            )}

            {/* Custom Recipient Dispense */}
            <div className="mt-6 border-t border-amber/10 pt-4">
              <p className="font-mono text-xs uppercase tracking-wider text-orange-50">
                Or fund another address without switching wallets:
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Input
                  value={customRecipient}
                  onChange={(e) => setCustomRecipient(e.target.value.trim())}
                  placeholder="Paste any Solana Devnet address"
                  className="flex-1"
                />
                <Button
                  disabled={!isBundleLoaded || dispenseState.busy || !customRecipient}
                  onClick={() => {
                    try {
                      const pub = new PublicKey(customRecipient);
                      void handleDispense(pub, { sol: 0.5, tbtc: 0.1, usdc: 5000 });
                    } catch {
                      setDispenseState({ busy: false, result: null, message: "Invalid Solana public key." });
                    }
                  }}
                >
                  Dispense Pack
                </Button>
              </div>
            </div>

            {dispenseState.message && (
              <div
                className={`mt-4 rounded p-3 font-mono text-xs ${
                  dispenseState.result?.ok
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-white"
                    : dispenseState.result?.error
                    ? "border border-red-500/30 bg-red-500/10 text-orange-50"
                    : "border border-amber/30 bg-surfaceDeep text-amber"
                }`}
              >
                <p>{dispenseState.message}</p>
                {dispenseState.result?.explorerUrl && (
                  <p className="mt-1">
                    <a
                      href={dispenseState.result.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber underline"
                    >
                      View on Solana Explorer ↗
                    </a>
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Public Faucet & Stand-in Token Info */}
        <div className="space-y-6">
          <Card>
            <p className="eyebrow">Public Fallback</p>
            <h2 className="mt-1 font-display text-xl uppercase">Solana Devnet Faucet</h2>
            <p className="mt-3 text-sm leading-6 text-orange-50">
              Direct public RPC request (subject to 429 rate limits).
            </p>
            <Button
              className="mt-5 w-full text-xs"
              disabled={airdropState.status === "busy"}
              onClick={publicKey ? claimPublicSol : () => setVisible(true)}
            >
              {airdropState.status === "busy"
                ? "Requesting…"
                : publicKey
                ? "Claim 1 Public Devnet SOL"
                : "Connect Wallet"}
            </Button>
            {airdropState.status !== "idle" && (
              <p
                role="status"
                className={`mt-3 text-xs ${
                  airdropState.status === "err" ? "text-orange-50" : "text-white"
                }`}
              >
                {airdropState.message}
              </p>
            )}
            <div className="mt-4 border-t border-amber/10 pt-3">
              <a
                href="https://faucet.solana.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-amber underline hover:text-white"
              >
                Open Official Web Faucet (faucet.solana.com) ↗
              </a>
            </div>
          </Card>

          <Card>
            <p className="eyebrow">Token Registry</p>
            <h2 className="mt-1 font-display text-xl uppercase">Deployed Test Mints</h2>
            <ul className="mt-4 space-y-3 font-mono text-xs">
              {mintEntries.map(([symbol, mint]) => (
                <li key={symbol} className="flex items-center justify-between gap-3 border-b border-amber/5 pb-2">
                  <span className="font-semibold text-white">{symbol}</span>
                  {mint ? (
                    <a
                      className="text-amber underline"
                      href={explorerAddress(mint)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {mint.toBase58().slice(0, 6)}…{mint.toBase58().slice(-4)}
                    </a>
                  ) : (
                    <span className="text-orange-50/60">—</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AppFrame>
  );
}
