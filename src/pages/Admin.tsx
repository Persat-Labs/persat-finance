// oxlint-disable
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWriteContract } from 'wagmi'
import { encodeFunctionData, formatUnits, isAddress, parseUnits } from 'viem'
import { toast } from 'sonner'
import { RefreshCw, ShieldCheck, Users, Link2, CheckCircle2, Circle, Lock } from 'lucide-react'
import { Card, Button, Input, Badge } from '../components/ui'
import { useArcNetwork } from '../hooks/useArcNetwork'
import { getArcClient } from '../lib/arcClient'
import { REGISTRY_ABI, VAULT_ABI } from '../contracts/abis'
import { usesOfficialCirBtc } from '../contracts/addresses'
import { parseOnchainError, shortAddr } from '../lib/utils'
import { SAFE_ABI, describeOwner, safeTxArgs, safeTxHash, approvalsFor, prevalidatedSignatures, type OwnerInfo } from '../lib/safe'

const ZERO = '0x0000000000000000000000000000000000000000'

const FEED_ABI = [
  {
    name: 'latestRoundData', type: 'function', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' }, { name: 'answer', type: 'int256' }, { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' }, { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const
const PEG_ABI = [{ name: 'twapPriceE18', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }] as const
const ERC20_ABI = [
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'mint', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const
const OWNABLE2STEP_ABI = [
  { name: 'pendingOwner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'transferOwnership', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'newOwner', type: 'address' }], outputs: [] },
  { name: 'acceptOwnership', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const

type Target = 'registry' | 'vault'

interface Status {
  registry: { owner: `0x${string}`; pendingOwner: `0x${string}`; paused: boolean; vault: `0x${string}` }
  vault: {
    owner: `0x${string}`; pendingOwner: `0x${string}`; paused: boolean; feeBps: bigint; currentFeeBps: bigint
    pendingFeeBps: bigint; feeChangeEffectiveAt: bigint; feeRecipient: `0x${string}`; claimableUsdc: bigint
    claimableCirBtc: bigint; lastTokenPauseAt: bigint; pegGuard: `0x${string}`; stalenessThreshold: bigint
    liquidationsPausedUntil: bigint
  }
  oracle: { price: number; age: number } | null
  peg: number | null
}

interface Call {
  fn: string
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
}

interface ActionDef {
  id: string
  target: Target
  title: string
  help: string
  fields?: { key: string; label: string; placeholder: string; hint?: string }[]
  actor: 'owner' | 'pendingOwner'
  build: (v: Record<string, string>, ctx: { vault: `0x${string}`; tokenDecimals?: number }) => Call | string
}

const ACTIONS: ActionDef[] = [
  {
    id: 'vault.pause', target: 'vault', actor: 'owner', title: 'Pause the vault',
    help: 'Blocks new loan activations only. Repayments, liquidations and withdrawals keep working.',
    build: () => ({ fn: 'pause', abi: VAULT_ABI, functionName: 'pause' }),
  },
  {
    id: 'vault.unpause', target: 'vault', actor: 'owner', title: 'Resume the vault', help: 'Allows new activations again.',
    build: () => ({ fn: 'unpause', abi: VAULT_ABI, functionName: 'unpause' }),
  },
  {
    id: 'registry.pause', target: 'registry', actor: 'owner', title: 'Pause the registry',
    help: 'Blocks new deals, claims and offers. Existing loans are not affected.',
    build: () => ({ fn: 'pause', abi: REGISTRY_ABI, functionName: 'pause' }),
  },
  {
    id: 'registry.unpause', target: 'registry', actor: 'owner', title: 'Resume the registry', help: 'Allows new deals again.',
    build: () => ({ fn: 'unpause', abi: REGISTRY_ABI, functionName: 'unpause' }),
  },
  {
    id: 'vault.setFeeBps', target: 'vault', actor: 'owner', title: 'Change the protocol fee',
    help: 'Queued for 4 days before it applies, so deals already accepted keep the current fee. Maximum 50 bps (0.5%).',
    fields: [{ key: 'bps', label: 'New fee (bps)', placeholder: '25', hint: '25 bps = 0.25% of the principal' }],
    build: (v) => {
      const n = Number(v.bps)
      if (!Number.isInteger(n) || n < 0 || n > 50) return 'Enter a whole number between 0 and 50.'
      return { fn: `setFeeBps(${n})`, abi: VAULT_ABI, functionName: 'setFeeBps', args: [BigInt(n)] }
    },
  },
  {
    id: 'vault.pauseLiquidations', target: 'vault', actor: 'owner', title: 'Pause liquidations (emergency)',
    help: 'For an oracle or market incident. At most 24 hours, followed by a 6-hour grace period so borrowers can repay or add collateral. A new pause is only possible 3 days after the previous one ends.',
    fields: [{ key: 'hours', label: 'Duration (hours)', placeholder: '4', hint: '1 to 24 hours' }],
    build: (v) => {
      const h = Number(v.hours)
      if (!Number.isInteger(h) || h < 1 || h > 24) return 'Enter a whole number of hours between 1 and 24.'
      return { fn: `pauseLiquidations(${h * 3600})`, abi: VAULT_ABI, functionName: 'pauseLiquidations', args: [BigInt(h * 3600)] }
    },
  },
  {
    id: 'vault.setFeeRecipient', target: 'vault', actor: 'owner', title: 'Change the fee recipient',
    help: 'Address that receives the protocol fee at each activation.',
    fields: [{ key: 'to', label: 'New recipient', placeholder: '0x...' }],
    build: (v) => {
      if (!isAddress(v.to ?? '')) return 'Enter a valid address.'
      return { fn: `setFeeRecipient(${v.to})`, abi: VAULT_ABI, functionName: 'setFeeRecipient', args: [v.to as `0x${string}`] }
    },
  },
  {
    id: 'vault.rescueERC20', target: 'vault', actor: 'owner', title: 'Recover tokens sent by mistake',
    help: 'Cannot touch cirBTC collateral or funds credited to users; only the free balance can be recovered.',
    fields: [
      { key: 'token', label: 'Token address', placeholder: '0x3600… (USDC)' },
      { key: 'to', label: 'Send to', placeholder: '0x...' },
      { key: 'amount', label: 'Amount (token units)', placeholder: '100' },
    ],
    build: (v, ctx) => {
      if (!isAddress(v.token ?? '') || !isAddress(v.to ?? '')) return 'Enter valid token and recipient addresses.'
      if (ctx.tokenDecimals === undefined) return 'Reading token decimals…'
      let amount: bigint
      try { amount = parseUnits(v.amount || '0', ctx.tokenDecimals) } catch { return 'Enter a valid amount.' }
      if (amount <= 0n) return 'Enter an amount above zero.'
      return {
        fn: `rescueERC20(token ${v.token}, to ${v.to}, amount ${v.amount})`,
        abi: VAULT_ABI, functionName: 'rescueERC20', args: [v.token as `0x${string}`, v.to as `0x${string}`, amount],
      }
    },
  },
  {
    id: 'registry.setVault', target: 'registry', actor: 'owner', title: 'Wire the vault into the registry',
    help: 'One-time setup. The deploy script normally does it already.',
    build: (_v, ctx) => ({ fn: `setVault(${ctx.vault})`, abi: REGISTRY_ABI, functionName: 'setVault', args: [ctx.vault] }),
  },
  {
    id: 'registry.transferOwnership', target: 'registry', actor: 'owner', title: 'Transfer registry ownership',
    help: 'Step 1 of 2. The new owner must then accept ownership.',
    fields: [{ key: 'to', label: 'New owner', placeholder: '0x... (multisig recommended)' }],
    build: (v) => isAddress(v.to ?? '')
      ? { fn: `transferOwnership(${v.to})`, abi: OWNABLE2STEP_ABI, functionName: 'transferOwnership', args: [v.to as `0x${string}`] }
      : 'Enter a valid address.',
  },
  {
    id: 'vault.transferOwnership', target: 'vault', actor: 'owner', title: 'Transfer vault ownership',
    help: 'Step 1 of 2. The new owner must then accept ownership.',
    fields: [{ key: 'to', label: 'New owner', placeholder: '0x... (multisig recommended)' }],
    build: (v) => isAddress(v.to ?? '')
      ? { fn: `transferOwnership(${v.to})`, abi: OWNABLE2STEP_ABI, functionName: 'transferOwnership', args: [v.to as `0x${string}`] }
      : 'Enter a valid address.',
  },
  {
    id: 'registry.acceptOwnership', target: 'registry', actor: 'pendingOwner', title: 'Accept registry ownership',
    help: 'Step 2 of 2, done by the pending owner.',
    build: () => ({ fn: 'acceptOwnership', abi: OWNABLE2STEP_ABI, functionName: 'acceptOwnership' }),
  },
  {
    id: 'vault.acceptOwnership', target: 'vault', actor: 'pendingOwner', title: 'Accept vault ownership',
    help: 'Step 2 of 2, done by the pending owner.',
    build: () => ({ fn: 'acceptOwnership', abi: OWNABLE2STEP_ABI, functionName: 'acceptOwnership' }),
  },
]

function readHashSelection(): { id: string; values: Record<string, string> } | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const id = params.get('action')
  if (!id || !ACTIONS.some((a) => a.id === id)) return null
  const values: Record<string, string> = {}
  params.forEach((v, k) => { if (k !== 'action') values[k] = v })
  return { id, values }
}

function availability(a: ActionDef, s: Status): string | null {
  const t = s[a.target]
  if (a.id.endsWith('.pause') && t.paused) return 'Already paused'
  if (a.id.endsWith('.unpause') && !t.paused) return 'Not paused'
  if (a.id === 'registry.setVault' && s.registry.vault !== ZERO) return 'Already wired'
  if (a.actor === 'pendingOwner' && t.pendingOwner === ZERO) return 'No pending transfer'
  return null
}

const Row = ({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) => (
  <div className="flex justify-between items-center gap-4 text-sm py-1">
    <span style={{ color: 'var(--subtle)' }}>{k}</span>
    <span className={mono ? 'mono text-xs text-right break-all' : 'text-right'} style={{ color: 'var(--ink)' }}>{v}</span>
  </div>
)

function OwnerLine({ info }: { info: OwnerInfo | undefined }) {
  if (!info) return <>—</>
  if (info.kind === 'safe') return <>Safe {info.threshold}-of-{info.owners.length} · {shortAddr(info.address)}</>
  if (info.kind === 'eoa') return <>Single wallet · {shortAddr(info.address)}</>
  return <>Contract · {shortAddr(info.address)}</>
}

export default function Admin() {
  const { address, isWrongChain, addresses } = useArcNetwork()
  const client = getArcClient()
  const [status, setStatus] = useState<Status | null>(null)
  const [owners, setOwners] = useState<Record<string, OwnerInfo>>({})
  const [loading, setLoading] = useState(false)
  const initial = useMemo(readHashSelection, [])
  const [selectedId, setSelectedId] = useState<string>(initial?.id ?? '')
  const [values, setValues] = useState<Record<string, string>>(initial?.values ?? {})
  const [tokenDecimals, setTokenDecimals] = useState<number | undefined>(undefined)
  const [safeState, setSafeState] = useState<{ hash: `0x${string}`; approvers: `0x${string}`[]; nonce: bigint } | null>(null)
  const [mint, setMint] = useState({ to: '', amount: '1' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = addresses.registry
      const v = addresses.vault
      const rd = (address: `0x${string}`, abi: any, functionName: string, args: any[] = []) =>
        client.readContract({ address, abi, functionName, args } as any) as Promise<any>
      const [rOwner, rPending, rPaused, rVault, vOwner, vPending, vPaused, fee, curFee, pendFee, feeAt, feeTo, clU, clC, lastPause, peg, stale, liqUntil] =
        await Promise.all([
          rd(r, REGISTRY_ABI, 'owner'), rd(r, OWNABLE2STEP_ABI, 'pendingOwner'), rd(r, REGISTRY_ABI, 'paused'), rd(r, REGISTRY_ABI, 'vault'),
          rd(v, VAULT_ABI, 'owner'), rd(v, OWNABLE2STEP_ABI, 'pendingOwner'), rd(v, VAULT_ABI, 'paused'),
          rd(v, VAULT_ABI, 'feeBps'), rd(v, VAULT_ABI, 'currentFeeBps'), rd(v, VAULT_ABI, 'pendingFeeBps'), rd(v, VAULT_ABI, 'feeChangeEffectiveAt'),
          rd(v, VAULT_ABI, 'feeRecipient'), rd(v, VAULT_ABI, 'totalClaimable', [addresses.usdc]), rd(v, VAULT_ABI, 'totalClaimable', [addresses.cirBtc]),
          rd(v, VAULT_ABI, 'lastTokenPauseAt'), rd(v, VAULT_ABI, 'pegGuard'), rd(v, VAULT_ABI, 'stalenessThreshold'),
          rd(v, VAULT_ABI, 'liquidationsPausedUntil'),
        ])
      let oracle: Status['oracle'] = null
      try {
        const feed = (await rd(v, VAULT_ABI, 'priceFeed')) as `0x${string}`
        const round = await rd(feed, FEED_ABI, 'latestRoundData')
        oracle = { price: Number(round[1]) / 1e8, age: Math.floor(Date.now() / 1000) - Number(round[3]) }
      } catch { /* oracle unavailable */ }
      let pegPrice: number | null = null
      if (peg !== ZERO) {
        try { pegPrice = Number(await rd(peg, PEG_ABI, 'twapPriceE18')) / 1e18 } catch { /* pool unavailable */ }
      }
      const next: Status = {
        registry: { owner: rOwner, pendingOwner: rPending, paused: rPaused, vault: rVault },
        vault: {
          owner: vOwner, pendingOwner: vPending, paused: vPaused, feeBps: fee, currentFeeBps: curFee, pendingFeeBps: pendFee,
          feeChangeEffectiveAt: feeAt, feeRecipient: feeTo, claimableUsdc: clU, claimableCirBtc: clC, lastTokenPauseAt: lastPause, liquidationsPausedUntil: liqUntil,
          pegGuard: peg, stalenessThreshold: stale,
        },
        oracle,
        peg: pegPrice,
      }
      setStatus(next)
      const who = [...new Set([rOwner, rPending, vOwner, vPending].filter((a: string) => a !== ZERO).map((a: string) => a.toLowerCase()))]
      const infos = await Promise.all(who.map((a) => describeOwner(client, a as `0x${string}`)))
      setOwners(Object.fromEntries(infos.map((i) => [i.address.toLowerCase(), i])))
    } catch (e) {
      console.error('Admin status load error:', e)
      toast.error('Could not read the contracts. Check the network and the configured addresses.')
    } finally {
      setLoading(false)
    }
  }, [client, addresses.registry, addresses.vault, addresses.usdc, addresses.cirBtc])

  useEffect(() => { void load() }, [load])

  const action = ACTIONS.find((a) => a.id === selectedId)
  const actorAddress = action && status ? status[action.target][action.actor] : undefined
  const actor = actorAddress ? owners[actorAddress.toLowerCase()] : undefined
  const targetAddress = action ? addresses[action.target] : undefined

  useEffect(() => {
    setTokenDecimals(undefined)
    if (selectedId !== 'vault.rescueERC20' || !isAddress(values.token ?? '')) return
    client.readContract({ address: values.token as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' })
      .then((d) => setTokenDecimals(Number(d)))
      .catch(() => setTokenDecimals(undefined))
  }, [client, selectedId, values.token])

  const built = action && status ? action.build(values, { vault: addresses.vault, tokenDecimals }) : null
  const call = built && typeof built !== 'string'
    ? { ...built, data: encodeFunctionData({ abi: built.abi as any, functionName: built.functionName as any, args: built.args as any }) as `0x${string}` }
    : null
  const buildError = typeof built === 'string' ? built : null

  const refreshSafe = useCallback(async () => {
    setSafeState(null)
    if (!call || !targetAddress || actor?.kind !== 'safe') return
    const nonce = (await client.readContract({ address: actor.address, abi: SAFE_ABI, functionName: 'nonce' })) as bigint
    const hash = await safeTxHash(client, actor.address, targetAddress, call.data, nonce)
    const approvers = await approvalsFor(client, actor.address, actor.owners, hash)
    setSafeState({ hash, approvers, nonce })
  }, [client, call?.data, targetAddress, actor])

  useEffect(() => { void refreshSafe() }, [refreshSafe])

  const { writeContractAsync, isPending } = useWriteContract()
  const [busy, setBusy] = useState(false)

  async function send(params: any, label: string) {
    if (!address) return
    setBusy(true)
    try {
      const { gas: _gas, ...sim } = params
      await client.simulateContract({ ...sim, account: address })
      const hash = await writeContractAsync(params)
      const receipt = await client.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('reverted')
      toast.success(`${label}: confirmed`)
      await load()
      await refreshSafe()
    } catch (e) {
      toast.error(parseOnchainError(e), { duration: 8000 })
    } finally {
      setBusy(false)
    }
  }

  const me = address?.toLowerCase()
  const isDirectActor = actor?.kind === 'eoa' && me === actor.address.toLowerCase()
  const isSafeSigner = actor?.kind === 'safe' && !!me && actor.owners.some((o) => o.toLowerCase() === me)
  const iApproved = !!safeState && !!me && safeState.approvers.some((a) => a.toLowerCase() === me)
  const approvalCount = safeState ? new Set([...safeState.approvers.map((a) => a.toLowerCase()), ...(isSafeSigner && me ? [me] : [])]).size : 0
  const canExecute = actor?.kind === 'safe' && isSafeSigner && approvalCount >= actor.threshold

  function selectAction(id: string) {
    setSelectedId(id)
    setValues({})
    window.history.replaceState(null, '', `${window.location.pathname}#action=${id}`)
  }

  function setField(key: string, value: string) {
    const next = { ...values, [key]: value }
    setValues(next)
    const p = new URLSearchParams({ action: selectedId, ...next })
    window.history.replaceState(null, '', `${window.location.pathname}#${p.toString()}`)
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied. Co-signers open it to approve the same transaction.')
    } catch {
      toast.error('Copy failed. Copy the address bar instead.')
    }
  }

  const fmtTime = (ts: bigint) => (ts === 0n ? '—' : new Date(Number(ts) * 1000).toLocaleString())
  const pegDev = status?.oracle && status.peg ? ((status.peg - status.oracle.price) / status.oracle.price) * 100 : null

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="display text-2xl font-bold mb-1" style={{ color: 'var(--ink)' }}>Protocol Admin</h1>
          <p className="text-sm max-w-2xl" style={{ color: 'var(--subtle)' }}>
            Only the owner, the pending owner and the signers of an owner Safe can open this page. The contracts reject
            actions from any other address. When the owner is a Safe multisig, each signer approves here and any signer
            executes once the threshold is reached.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {isWrongChain && (
        <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(245,158,11,0.12)', color: '#fcd34d' }}>
          Switch your wallet to Arc Mainnet (chain ID 5042).
        </div>
      )}

      {status && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>Deal registry</p>
            <Row k="Address" v={shortAddr(addresses.registry)} mono />
            <Row k="Owner" v={<OwnerLine info={owners[status.registry.owner.toLowerCase()]} />} />
            {status.registry.pendingOwner !== ZERO && <Row k="Pending owner" v={<OwnerLine info={owners[status.registry.pendingOwner.toLowerCase()]} />} />}
            <Row k="New deals" v={status.registry.paused ? <Badge className="bg-red-900/40 text-red-300">Paused</Badge> : <Badge className="bg-emerald-900/40 text-emerald-300">Open</Badge>} />
            <Row k="Vault wired" v={status.registry.vault === ZERO ? 'No' : shortAddr(status.registry.vault)} mono />
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>Escrow vault</p>
            <Row k="Address" v={shortAddr(addresses.vault)} mono />
            <Row k="Owner" v={<OwnerLine info={owners[status.vault.owner.toLowerCase()]} />} />
            {status.vault.pendingOwner !== ZERO && <Row k="Pending owner" v={<OwnerLine info={owners[status.vault.pendingOwner.toLowerCase()]} />} />}
            <Row k="Activations" v={status.vault.paused ? <Badge className="bg-red-900/40 text-red-300">Paused</Badge> : <Badge className="bg-emerald-900/40 text-emerald-300">Open</Badge>} />
            <Row k="Fee" v={`${Number(status.vault.currentFeeBps) / 100}%`} />
            {status.vault.feeChangeEffectiveAt > 0n && (
              <Row k="Queued fee" v={`${Number(status.vault.pendingFeeBps) / 100}% from ${fmtTime(status.vault.feeChangeEffectiveAt)}`} />
            )}
            <Row k="Fee recipient" v={shortAddr(status.vault.feeRecipient)} mono />
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>Prices</p>
            <Row k="BTC/USD oracle" v={status.oracle ? `$${status.oracle.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Unavailable'} />
            <Row k="Oracle age" v={status.oracle ? `${Math.round(status.oracle.age / 60)} min (limit ${Number(status.vault.stalenessThreshold) / 3600} h)` : '—'} />
            <Row k="cirBTC pool (30-min TWAP)" v={status.peg ? `$${status.peg.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : status.vault.pegGuard === ZERO ? 'Peg guard off' : 'Unavailable'} />
            <Row k="Deviation" v={pegDev === null ? '—' : <span style={{ color: Math.abs(pegDev) > 2 ? 'var(--danger)' : 'var(--success)' }}>{pegDev.toFixed(2)}% (new loans blocked above 2%)</span>} />
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>Held for users</p>
            <Row k="USDC credited" v={formatUnits(status.vault.claimableUsdc, 6)} />
            <Row k="cirBTC credited" v={formatUnits(status.vault.claimableCirBtc, 8)} />
            <Row k="Last token pause recorded" v={fmtTime(status.vault.lastTokenPauseAt)} />
            <Row
              k="Liquidations"
              v={status.vault.liquidationsPausedUntil > BigInt(Math.floor(Date.now() / 1000))
                ? `Paused until ${fmtTime(status.vault.liquidationsPausedUntil)} (grace included)`
                : 'Open'}
            />
            <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>
              Payments that could not be delivered (freeze or pause). They belong to users and cannot be recovered by the owner.
            </p>
          </Card>
        </div>
      )}

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>Actions</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {ACTIONS.map((a) => {
            const off = status ? availability(a, status) : 'Loading'
            return (
              <button
                key={a.id}
                onClick={() => selectAction(a.id)}
                disabled={!!off}
                className="text-left rounded-xl px-3 py-2.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  borderColor: selectedId === a.id ? 'var(--accent)' : 'var(--border)',
                  background: selectedId === a.id ? 'rgba(255,138,0,0.08)' : 'var(--surface-muted)',
                }}
              >
                <span className="text-sm font-semibold block" style={{ color: 'var(--ink)' }}>{a.title}</span>
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>{off ?? (a.target === 'vault' ? 'Escrow vault' : 'Deal registry')}</span>
              </button>
            )
          })}
        </div>
      </Card>

      {action && status && (
        <Card className="border border-[var(--accent)]/40">
          <p className="text-base font-semibold mb-1" style={{ color: 'var(--ink)' }}>{action.title}</p>
          <p className="text-sm mb-4" style={{ color: 'var(--subtle)' }}>{action.help}</p>

          {action.fields && (
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              {action.fields.map((f) => (
                <Input
                  key={f.key}
                  id={`admin-${f.key}`}
                  label={f.label}
                  placeholder={f.placeholder}
                  hint={f.hint}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              ))}
            </div>
          )}

          {['vault.transferOwnership', 'registry.transferOwnership', 'vault.rescueERC20', 'vault.setFeeRecipient'].includes(action.id) && (
            <div className="rounded-xl p-3 mb-4 text-xs" style={{ background: 'rgba(232,109,122,0.1)', border: '1px solid rgba(232,109,122,0.35)', color: '#fca5a5' }}>
              This action sends control or funds to the address shown below. Check every character of it before approving:
              a link shared by someone else can prefill any address.
            </div>
          )}

          <div className="rounded-xl p-3 mb-4 text-sm" style={{ background: 'var(--surface-muted)' }}>
            <Row k="Contract" v={`${action.target === 'vault' ? 'Escrow vault' : 'Deal registry'} · ${shortAddr(targetAddress ?? '')}`} mono />
            <Row k="Call" v={call ? call.fn : buildError ?? '—'} mono />
            <Row k={action.actor === 'pendingOwner' ? 'Must be done by (pending owner)' : 'Must be done by (owner)'} v={<OwnerLine info={actor} />} />
          </div>

          {!address && (
            <p className="text-sm flex items-center gap-2" style={{ color: 'var(--subtle)' }}>
              <Lock size={14} /> Connect the owner wallet, or a signer of the owner Safe, to continue.
            </p>
          )}

          {address && actor?.kind === 'eoa' && (
            isDirectActor ? (
              <Button variant="primary" disabled={!call || busy || isPending} onClick={() => call && targetAddress && send({ address: targetAddress, abi: call.abi, functionName: call.functionName, args: call.args }, action.title)}>
                <ShieldCheck size={14} /> {busy ? 'Confirming…' : 'Send transaction'}
              </Button>
            ) : (
              <p className="text-sm" style={{ color: 'var(--danger)' }}>Your wallet is not the owner. The contract would reject this call.</p>
            )
          )}

          {address && actor?.kind === 'safe' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
                <Users size={14} /> Approvals: <strong>{approvalCount} / {actor.threshold}</strong>
                {safeState && <span className="mono text-xs" style={{ color: 'var(--subtle)' }}>· Safe nonce {safeState.nonce.toString()} · tx {safeState.hash.slice(0, 10)}…</span>}
              </div>
              <div className="flex flex-col gap-1">
                {actor.owners.map((o) => {
                  const ok = safeState?.approvers.some((a) => a.toLowerCase() === o.toLowerCase())
                  const isMe = o.toLowerCase() === me
                  return (
                    <div key={o} className="flex items-center gap-2 text-xs mono" style={{ color: ok ? 'var(--success)' : 'var(--subtle)' }}>
                      {ok ? <CheckCircle2 size={13} /> : <Circle size={13} />} {o}{isMe ? ' (you)' : ''}
                    </div>
                  )
                })}
              </div>
              {!isSafeSigner ? (
                <p className="text-sm" style={{ color: 'var(--danger)' }}>Your wallet is not a signer of this Safe.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={!call || !safeState || iApproved || busy || isPending}
                    onClick={() => safeState && send({ address: actor.address, abi: SAFE_ABI, functionName: 'approveHash', args: [safeState.hash] }, 'Approval')}
                  >
                    <CheckCircle2 size={14} /> {iApproved ? 'You approved' : 'Approve'}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!call || !safeState || !canExecute || busy || isPending}
                    onClick={() => call && targetAddress && safeState && send({
                      address: actor.address,
                      abi: SAFE_ABI,
                      functionName: 'execTransaction',
                      args: [...safeTxArgs(targetAddress, call.data), prevalidatedSignatures([...safeState.approvers, address])],
                      gas: 600_000n,
                    }, action.title)}
                  >
                    <ShieldCheck size={14} /> Execute
                  </Button>
                  <Button variant="ghost" onClick={() => void copyShareLink()}>
                    <Link2 size={14} /> Copy link for co-signers
                  </Button>
                </div>
              )}
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                Executing counts your own approval, so the last signer can execute directly. If another Safe transaction runs
                first, the nonce changes and approvals must be given again.
              </p>
            </div>
          )}

          {address && actor?.kind === 'contract' && (
            <p className="text-sm" style={{ color: 'var(--subtle)' }}>The owner is a contract that is not a Safe; use that contract's own interface.</p>
          )}
        </Card>
      )}

      {!usesOfficialCirBtc() && (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>Test deployment only</p>
          <p className="text-sm mb-3" style={{ color: 'var(--subtle)' }}>
            This deployment uses a test collateral token that anyone can mint. This tool disappears on deployments that use
            Circle's official cirBTC.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <Input id="mint-amount" label="Amount (test cirBTC)" value={mint.amount} onChange={(e) => setMint({ ...mint, amount: e.target.value })} />
            <Input id="mint-to" label="Recipient (blank = you)" placeholder="0x..." value={mint.to} onChange={(e) => setMint({ ...mint, to: e.target.value })} />
          </div>
          <Button
            variant="secondary"
            disabled={!address || busy}
            onClick={() => {
              const to = (mint.to.trim() || address) as `0x${string}`
              let amount: bigint
              try { amount = parseUnits(mint.amount || '0', 8) } catch { toast.error('Invalid amount'); return }
              void send({ address: addresses.cirBtc, abi: ERC20_ABI, functionName: 'mint', args: [to, amount] }, 'Mint')
            }}
          >
            Mint test cirBTC
          </Button>
        </Card>
      )}
    </div>
  )
}
