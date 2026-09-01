"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { useState, useCallback, useEffect, ChangeEvent } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { AppFrame } from "@/components/AppFrame";
import { Button, Card, Input } from "@/lib/design-system";
import { useProtocol } from "@/lib/protocol/hooks";
import { MINTS, explorerAddress, explorerTx } from "@/lib/protocol/config";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useDevnetBundle, dispenseTestnetAssets, DispenseResult } from "@/lib/protocol/bundle";
import { api } from "@/lib/api";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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

  const [airdropState, setAirdropState] = useState<{ status: "idle" | "busy" | "ok" | "err"; message: string }>({ status: "idle", message: "" });
  const [dispenseState, setDispenseState] = useState<{ busy: boolean; result: DispenseResult | null; message: string; explorerUrl?: string }>({ busy: false, result: null, message: "" });
  const [autoFaucetState, setAutoFaucetState] = useState<{ busy: boolean; message: string; explorerUrl?: string; error?: string }>({ busy: false, message: "" });
  const [customRecipient, setCustomRecipient] = useState("");
  const [manualJson, setManualJson] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [cooldownInfo, setCooldownInfo] = useState<string | null>(null);
  const [serverDispenseAvailable, setServerDispenseAvailable] = useState<boolean | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!publicKey) {
      setSolBalance(null);
      return;
    }
    try {
      const lamports = await connection.getBalance(publicKey, "confirmed");
      setSolBalance(lamports / LAMPORTS_PER_SOL);
    } catch {}
  }, [connection, publicKey]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  useEffect(() => {
    // Check if server dispense is available
    if (publicKey) {
      api.faucetStatus(publicKey.toBase58()).then((res: any) => {
        setServerDispenseAvailable(res.serverDispenseAvailable ?? false);
      }).catch(() => setServerDispenseAvailable(false));
    }
  }, [publicKey]);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const res = loadBundle(text);
        setDispenseState({ busy: false, result: null, message: res.ok ? res.message : `Error: ${res.message}` });
      }
    };
    reader.readAsText(file);
  };

  const handleAutoFaucet = useCallback(async (targetPubkey: PublicKey) => {
    setAutoFaucetState({ busy: true, message: "Requesting full pack from server — 0.5 SOL + 0.1 tBTC + 0.1 zBTC + 0.1 BTC + 5k USDC + 5k USDT..." });
    setCooldownInfo(null);
    try {
      // Prefer server auto-mint, then claim (cooldown + optional dispense)
      const autoRes = await api.faucetAuto(targetPubkey.toBase58(), "ALL").catch(() => null);
      const res = await api.faucetClaim(targetPubkey.toBase58(), "ALL").catch(() => null);

      if (autoRes?.ok && autoRes?.signature) {
        setAutoFaucetState({ busy: false, message: `✅ Auto-dispensed full pack to ${targetPubkey.toBase58().slice(0, 4)}…${targetPubkey.toBase58().slice(-4)}!`, explorerUrl: autoRes.explorerUrl });
        await refreshBalance();
        return;
      }

      if (res?.ok && res?.mode === "server_dispense") {
        setAutoFaucetState({ busy: false, message: res.message, explorerUrl: res.explorerUrl });
        await refreshBalance();
        return;
      }

      if (res?.error && res.error.includes("cooldown")) {
        setCooldownInfo(res.error);
        setAutoFaucetState({ busy: false, message: res.error, error: res.error });
        return;
      }

      // Cooldown-only / mint not live — optional advanced local dispense if already loaded
      if (res?.mode === "client_bundle" || res?.mode === "client_bundle_fallback" || res?.mode === "cooldown_only") {
        if (deployerKeypair) {
          await handleDispense(targetPubkey, { sol: 0.5, tbtc: 0.1, zbtc: 0.1, btc: 0.1, usdc: 5000, usdt: 5000 });
          setAutoFaucetState({ busy: false, message: "Claim recorded and local dispense completed." });
        } else {
          setAutoFaucetState({
            busy: false,
            message: "Faucet claim recorded. Full pack mint is not live yet — try again shortly, or use public Devnet SOL below.",
          });
        }
        return;
      }

      setAutoFaucetState({ busy: false, message: res?.message || "Faucet claim recorded.", explorerUrl: res?.explorerUrl });
    } catch (err) {
      setAutoFaucetState({ busy: false, message: err instanceof Error ? err.message : String(err), error: String(err) });
    }
  }, [refreshBalance, deployerKeypair]);

  const handleDispense = useCallback(
    async (
      targetPubkey: PublicKey,
      opts: { sol?: number; tbtc?: number; zbtc?: number; btc?: number; usdc?: number; usdt?: number },
    ) => {
      if (!deployerKeypair) {
        setDispenseState({ busy: false, result: null, message: "Use One-Click Auto-Faucet above (no upload). Advanced local mint only if you load a deployer bundle yourself." });
        return;
      }

      try {
        const walletStr = targetPubkey.toBase58();
        const assetLabel = opts.sol ? "SOL" : opts.tbtc ? "tBTC" : opts.zbtc ? "zBTC" : opts.btc ? "BTC" : opts.usdc ? "USDC" : opts.usdt ? "USDT" : "ALL";
        const cooldownRes = await api.faucetClaim(walletStr, assetLabel).catch(() => null);
        if (cooldownRes?.error && cooldownRes.error.includes("cooldown")) {
          setCooldownInfo(cooldownRes.error);
          setDispenseState({ busy: false, result: null, message: cooldownRes.error });
          return;
        }
        setCooldownInfo(null);
      } catch {}

      setDispenseState({ busy: true, result: null, message: "Dispensing full pack SOL+tBTC+zBTC+BTC+USDC+USDT — single tx, ATA creation idempotent..." });
      try {
        const res = await dispenseTestnetAssets({
          connection,
          deployerKeypair,
          recipient: targetPubkey,
          solAmount: opts.sol,
          tbtcAmount: opts.tbtc ?? opts.btc,
          zbtcAmount: opts.zbtc,
          btcAmount: opts.btc,
          usdcAmount: opts.usdc,
          usdtAmount: opts.usdt,
        });

        if (res.ok) {
          setDispenseState({ busy: false, result: res, message: `Dispensed full pack to ${targetPubkey.toBase58().slice(0, 4)}…${targetPubkey.toBase58().slice(-4)}!`, explorerUrl: res.explorerUrl });
          await refreshBalance();
        } else {
          setDispenseState({ busy: false, result: res, message: `Dispense failed: ${res.error ?? "Unknown"}` });
        }
      } catch (err) {
        setDispenseState({ busy: false, result: null, message: err instanceof Error ? err.message : String(err) });
      }
    },
    [connection, deployerKeypair, refreshBalance],
  );

  const handleFullPack = useCallback(
    (target: PublicKey) => {
      void handleDispense(target, { sol: 0.5, tbtc: 0.1, zbtc: 0.1, btc: 0.1, usdc: 5000, usdt: 5000 });
    },
    [handleDispense],
  );

  useEffect(() => {
    if (!autoFund || !isBundleLoaded || !deployerKeypair || !publicKey || solBalance === null) return;
    if (solBalance < 0.1 && !dispenseState.busy) {
      handleFullPack(publicKey);
    }
  }, [autoFund, isBundleLoaded, deployerKeypair, publicKey, solBalance, dispenseState.busy, handleFullPack]);

  async function claimPublicSol() {
    if (!publicKey) return;
    setAirdropState({ status: "busy", message: "Requesting Devnet SOL from public faucet..." });
    try {
      const sig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      setAirdropState({ status: "ok", message: "1 Devnet SOL claimed." });
      await refreshBalance();
    } catch (error) {
      setAirdropState({ status: "err", message: error instanceof Error ? error.message : "Airdrop rate-limited — use auto-faucet or faucet.solana.com" });
    }
  }

  const mintEntries = Object.entries(MINTS) as [string, (typeof MINTS)[keyof typeof MINTS]][];

  return (
    <ErrorBoundary>
      <AppFrame eyebrow="Testnet — One-Click No Upload Needed" title="Faucet — Auto Full Pack SOL + tBTC + zBTC + BTC + USDC + USDT">
        <div className="mt-4 flex flex-wrap gap-2 font-mono text-[10px]">
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-400">● One-Click Auto (No Bundle Needed)</span>
          <span className="rounded-full border border-white/10 bg-white/[0.02] px-2.5 py-1 text-white/50">BTC Default → Auto tBTC/zBTC</span>
          <span className="rounded-full border border-white/10 bg-white/[0.02] px-2.5 py-1 text-white/50">24h Cooldown</span>
          <span className="rounded-full border border-amber/20 bg-amber/10 px-2.5 py-1 text-amber">Inter + Plus Jakarta · Antialiased</span>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* PRIMARY: Auto-Faucet No Upload */}
            <Card>
              <p className="eyebrow">For All Users — No Upload Required</p>
              <h2 className="mt-1 font-display text-2xl uppercase">⚡ One-Click Test Funds — Auto From Treasury</h2>
              <p className="mt-2 text-sm leading-6 text-orange-50">Click and get full pack instantly. Server dispenses 0.5 SOL + 0.1 tBTC + 0.1 zBTC + 0.1 BTC + 5000 USDC + 5000 USDT from deployer wallet. No bundle upload needed. BTC is default — system auto-converts to best bridge (tBTC/zBTC) based on live health checker.</p>

              {cooldownInfo && <div className="mt-4 rounded border border-amber/30 bg-amber/10 p-3 font-mono text-xs text-amber">{cooldownInfo}</div>}

              {publicKey ? (
                <div className="mt-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber/15 bg-surfaceDeep p-3 font-mono text-xs">
                    <span className="text-orange-50">Your Wallet: {publicKey.toBase58().slice(0, 8)}…{publicKey.toBase58().slice(-8)}</span>
                    <span className="text-amber">Balance: {solBalance !== null ? `${solBalance.toFixed(3)} SOL` : "…"}</span>
                  </div>

                  <Button className="w-full py-4 text-sm" disabled={autoFaucetState.busy} onClick={() => handleAutoFaucet(publicKey)}>
                    {autoFaucetState.busy ? "Dispensing From Treasury…" : "⚡ Claim Full Pack — 0.5 SOL + 0.1 tBTC + 0.1 zBTC + 0.1 BTC + 5k USDC + 5k USDT (One Click)"}
                  </Button>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Button variant="secondary" disabled={autoFaucetState.busy} onClick={() => handleAutoFaucet(publicKey)}>+ 0.5 SOL</Button>
                    <Button variant="secondary" disabled={autoFaucetState.busy} onClick={() => handleAutoFaucet(publicKey)}>+ 0.1 tBTC</Button>
                    <Button variant="secondary" disabled={autoFaucetState.busy} onClick={() => handleAutoFaucet(publicKey)}>+ 0.1 zBTC</Button>
                    <Button variant="secondary" disabled={autoFaucetState.busy} onClick={() => handleAutoFaucet(publicKey)}>+ 0.1 BTC (auto)</Button>
                    <Button variant="secondary" disabled={autoFaucetState.busy} onClick={() => handleAutoFaucet(publicKey)}>+ 5k USDC</Button>
                    <Button variant="secondary" disabled={autoFaucetState.busy} onClick={() => handleAutoFaucet(publicKey)}>+ 5k USDT</Button>
                  </div>

                  {autoFaucetState.message && (
                    <div className={`mt-4 rounded p-3 font-mono text-xs ${autoFaucetState.error ? "border border-red-500/30 bg-red-500/10 text-orange-50" : "border border-emerald-500/30 bg-emerald-500/10 text-white"}`}>
                      <p>{autoFaucetState.message}</p>
                      {autoFaucetState.explorerUrl && <p className="mt-1"><a href={autoFaucetState.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-amber underline">View on Explorer ↗</a></p>}
                    </div>
                  )}

                  <div className="mt-4 rounded border border-white/5 bg-white/[0.02] p-3 font-mono text-[11px] text-white/40">
                    <p>💡 Default deposit is BTC — system auto-converts to tBTC/zBTC based on live bridge health (3 signals: pause/status, success rate, liquidity). You can also manually select tBTC or zBTC if you already have them.</p>
                    <p className="mt-1">Server status: {serverDispenseAvailable === null ? "checking..." : serverDispenseAvailable ? "✅ Auto-dispense configured" : "○ Claim recorded — full pack mint not live on API yet"}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-6"><Button className="w-full" onClick={() => setVisible(true)}>Connect Wallet to Claim Full Pack (One Click)</Button></div>
              )}

              <div className="mt-6 border-t border-amber/10 pt-4">
                <p className="font-mono text-xs uppercase tracking-wider text-orange-50">Or claim for another address:</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Input value={customRecipient} onChange={(e) => setCustomRecipient(e.target.value.trim())} placeholder="Paste any Solana Devnet address" className="flex-1" />
                  <Button disabled={autoFaucetState.busy || !customRecipient} onClick={() => { try { const pub = new PublicKey(customRecipient); void handleAutoFaucet(pub); } catch { setAutoFaucetState({ busy: false, message: "Invalid Solana public key.", error: "Invalid key" }); } }}>Claim For Address</Button>
                </div>
              </div>
            </Card>

            {/* SECONDARY: Advanced Bundle Upload (for devs) */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Advanced — For Devs Only</p>
                  <h2 className="mt-1 font-display text-xl uppercase">Manual Bundle Dispenser (Optional)</h2>
                </div>
                <span className={`rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${isBundleLoaded ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/10 bg-white/[0.02] text-white/40"}`}>
                  {isBundleLoaded ? "● Bundle Loaded" : "○ Optional"}
                </span>
              </div>

              <p className="mt-2 text-sm leading-6 text-orange-50/70">For developers who want local minting without server. Normal users should use One-Click above — no upload needed. Bundle stays in browser memory only.</p>

              {isBundleLoaded ? (
                <div className="mt-4 space-y-3 font-mono text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber/10 pb-2">
                    <span className="text-orange-50">Deployer:</span>
                    <span className="text-white">{deployerPubkey?.slice(0, 16)}…</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber/10 pb-2">
                    <span className="text-orange-50">Operator:</span>
                    <span className="text-white">{operatorPubkey?.slice(0, 16)}…</span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-4 pt-2">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-orange-50">
                      <input type="checkbox" checked={autoFund} onChange={(e) => setAutoFundEnabled(e.target.checked)} className="accent-amber" />
                      <span>Auto-fund new wallets</span>
                    </label>
                    <Button variant="secondary" onClick={unloadBundle} className="text-xs">Unload Bundle</Button>
                  </div>

                  {publicKey && (
                    <div className="mt-4 space-y-2">
                      <Button className="w-full py-3 text-xs" disabled={dispenseState.busy} onClick={() => handleFullPack(publicKey)}>
                        {dispenseState.busy ? "Dispensing…" : "⚡ Dispense via Bundle (Advanced)"}
                      </Button>
                      <div className="grid grid-cols-3 gap-2">
                        <Button variant="secondary" disabled={dispenseState.busy} onClick={() => handleDispense(publicKey, { sol: 0.5 })}>+ SOL</Button>
                        <Button variant="secondary" disabled={dispenseState.busy} onClick={() => handleDispense(publicKey, { tbtc: 0.1 })}>+ tBTC</Button>
                        <Button variant="secondary" disabled={dispenseState.busy} onClick={() => handleDispense(publicKey, { zbtc: 0.1 })}>+ zBTC</Button>
                        <Button variant="secondary" disabled={dispenseState.busy} onClick={() => handleDispense(publicKey, { btc: 0.1 })}>+ BTC</Button>
                        <Button variant="secondary" disabled={dispenseState.busy} onClick={() => handleDispense(publicKey, { usdc: 5000 })}>+ USDC</Button>
                        <Button variant="secondary" disabled={dispenseState.busy} onClick={() => handleDispense(publicKey, { usdt: 5000 })}>+ USDT</Button>
                      </div>
                    </div>
                  )}

                  {dispenseState.message && (
                    <div className={`mt-4 rounded p-3 font-mono text-xs ${dispenseState.result?.ok ? "border border-emerald-500/30 bg-emerald-500/10 text-white" : "border border-amber/30 bg-surfaceDeep text-amber"}`}>
                      <p>{dispenseState.message}</p>
                      {dispenseState.explorerUrl && <p className="mt-1"><a href={dispenseState.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-amber underline">View Explorer ↗</a></p>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="cursor-pointer rounded border border-white/10 bg-white/[0.02] px-5 py-3 font-mono text-xs uppercase tracking-widest text-white/60 transition hover:bg-white/[0.05] hover:text-white">
                      Select Keypair JSON (Devs)
                      <input type="file" accept=".json,application/json" onChange={handleFileUpload} className="hidden" />
                    </label>
                    <Button variant="secondary" onClick={() => setShowPaste(!showPaste)}>{showPaste ? "Hide Paste" : "Paste JSON"}</Button>
                  </div>
                  {showPaste && (
                    <div className="mt-3 space-y-2">
                      <textarea value={manualJson} onChange={(e) => setManualJson(e.target.value)} placeholder="Paste JSON here..." className="h-28 w-full rounded border border-amber/20 bg-surfaceDeep p-3 font-mono text-xs text-white" />
                      <Button onClick={() => { const res = loadBundle(manualJson); setDispenseState({ busy: false, result: null, message: res.ok ? res.message : `Error: ${res.message}` }); if (res.ok) setManualJson(""); }}>Load From Text</Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <p className="eyebrow">Public Fallback — Rate-Limited</p>
              <h2 className="mt-1 font-display text-xl uppercase">Solana Devnet Faucet</h2>
              <p className="mt-3 text-sm leading-6 text-orange-50">Direct RPC request, subject to 429. Auto-faucet above is preferred.</p>
              <Button className="mt-5 w-full text-xs" disabled={airdropState.status === "busy"} onClick={publicKey ? claimPublicSol : () => setVisible(true)}>
                {airdropState.status === "busy" ? "Requesting…" : publicKey ? "Claim 1 Public Devnet SOL" : "Connect Wallet"}
              </Button>
              {airdropState.status !== "idle" && <p role="status" className={`mt-3 text-xs ${airdropState.status === "err" ? "text-orange-50" : "text-white"}`}>{airdropState.message}</p>}
              <div className="mt-4 border-t border-amber/10 pt-3"><a href="https://faucet.solana.com" target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-amber underline hover:text-white">Open Official Faucet ↗</a></div>
            </Card>

            <Card>
              <p className="eyebrow">Token Registry — Real Architecture</p>
              <h2 className="mt-1 font-display text-xl uppercase">Deployed Test Mints — Full Pack</h2>
              <p className="mt-2 font-mono text-[11px] text-white/50">BTC default auto-converts to best bridge. Same as mainnet, only address differs.</p>
              <ul className="mt-4 space-y-3 font-mono text-xs">
                {mintEntries.map(([symbol, mint]) => (
                  <li key={symbol} className="flex items-center justify-between gap-3 border-b border-amber/5 pb-2">
                    <span className="font-semibold text-white">{symbol}</span>
                    {mint ? <a className="text-amber underline" href={explorerAddress(mint)} target="_blank" rel="noopener noreferrer">{mint.toBase58().slice(0, 6)}…{mint.toBase58().slice(-4)}</a> : <span className="text-orange-50/60">—</span>}
                  </li>
                ))}
              </ul>
              <div className="mt-4 rounded border border-white/5 bg-white/[0.02] p-3 font-mono text-[10px] text-white/40">
                <p>SOL: native gas — auto 0.5</p>
                <p>BTC: default deposit — auto tBTC/zBTC via live health</p>
                <p>tBTC: Threshold 79AL…NhDg 8d — manual option</p>
                <p>zBTC: Zeus DqQ1…QEt 8d — manual option</p>
                <p>USDC: FsSP…Muqe 6d $1 — loan currency</p>
                <p>USDT: 8zdn…RxaJ 6d $1 — loan currency</p>
              </div>
            </Card>
          </div>
        </div>
      </AppFrame>
    </ErrorBoundary>
  );
}
