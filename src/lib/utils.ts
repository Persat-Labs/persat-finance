import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { keccak256, encodePacked, encodeAbiParameters, concat, slice, pad } from 'viem'
import { privateKeyToAddress } from 'viem/accounts'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Deterministically derive salt for a private deal when reservedFor counterparty is known */
export function deriveSaltForCounterparty(dealId: `0x${string}`, reservedFor: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(['bytes16', 'address'], [dealId, reservedFor]))
}

/** Shorten an address for display: 0x1234...abcd */
export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

/** Format a basis-points rate as a percentage string: 500 → "5.00%" */
export function formatBps(bps: bigint | number): string {
  const n = typeof bps === 'bigint' ? Number(bps) : bps
  return `${(n / 100).toFixed(2)}%`
}

/** Format USDC amount (6 decimals) to display string */
export function formatUsdc(raw: bigint): string {
  const n = Number(raw) / 1e6
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/** Parse a USDC display string to raw bigint (6 decimals) */
export function parseUsdc(display: string): bigint {
  const n = parseFloat(display.replace(/,/g, ''))
  if (isNaN(n)) return 0n
  return BigInt(Math.round(n * 1e6))
}

/** Format cirBTC amount (8 decimals) to display string */
export function formatBtc(raw: bigint): string {
  return (Number(raw) / 1e8).toFixed(8).replace(/\.?0+$/, '')
}

/** Parse cirBTC display string to raw bigint (8 decimals) */
export function parseBtc(display: string): bigint {
  const n = parseFloat(display)
  if (isNaN(n)) return 0n
  return BigInt(Math.round(n * 1e8))
}

/**
 * Compute monthly payment schedule for a fixed-rate loan.
 * interest = principal * rateBps * durationMonths / (10000 * 12)
 */
export function computeRepayment(
  principal: bigint,
  rateBps: bigint,
  durationMonths: number,
): { interest: bigint; total: bigint } {
  const interest = (principal * rateBps * BigInt(durationMonths)) / (10_000n * 12n)
  return { interest, total: principal + interest }
}

/**
 * Compute current LTV given collateral amount, BTC/USD price (8 dec), and principal (6 dec USDC).
 * Returns basis points (e.g. 7500 = 75%).
 */
export function computeLtv(
  collateralRaw: bigint,
  btcPriceRaw: bigint,
  principalUsdc: bigint,
): number {
  if (collateralRaw === 0n || btcPriceRaw === 0n) return 0
  // collateralUsdValue (6 dec) = collateralRaw(8 dec) * btcPrice(8 dec) / 1e8 / 1e2
  // = collateralRaw * btcPriceRaw / 1e10
  const collateralUsdValue = (collateralRaw * btcPriceRaw) / 10_000_000_000n
  if (collateralUsdValue === 0n) return 0
  return Number((principalUsdc * 10_000n) / collateralUsdValue)
}

/**
 * Compute RLTV (Repayable Loan-to-Value) — collateral value vs total repayable amount.
 * Protects the lender's yield by checking collateral covers principal + all interest.
 * Returns a percentage number (e.g. 76.5).
 */
export function computeRltv(
  collateralRaw: bigint,   // satoshis (8 dec)
  btcPriceUsd: number,     // whole dollars (from Pyth/CoinGecko)
  principal: bigint,       // USDC 6-dec
  rateBps: bigint,
  durationMonths: number,
): number {
  if (collateralRaw === 0n || btcPriceUsd === 0 || principal === 0n) return 0
  const { total } = computeRepayment(principal, rateBps, durationMonths)
  // collateralValueUsdc (6-dec) = sats * priceUsd / 100
  const collateralValue = collateralRaw * BigInt(Math.floor(btcPriceUsd)) / 100n
  if (collateralValue === 0n) return 0
  return Number((total * 10_000n) / collateralValue) / 100
}

/** DealState enum values matching the contract */
export const DealState = {
  Proposed: 0,
  Confirmed: 1,
  Active: 2,
  Completed: 3,
  Defaulted: 4,
  Liquidated: 5,
  Cancelled: 6,
} as const

export type DealStateValue = (typeof DealState)[keyof typeof DealState]

export function dealStateLabel(s: number): string {
  const map: Record<number, string> = {
    0: 'Proposed',
    1: 'Confirmed',
    2: 'Active',
    3: 'Completed',
    4: 'Defaulted',
    5: 'Liquidated',
    6: 'Cancelled',
  }
  return map[s] ?? 'Unknown'
}

export function dealStateColor(s: number): string {
  if (s === DealState.Active) return 'text-emerald-300 bg-emerald-900/40'
  if (s === DealState.Confirmed) return 'text-blue-300 bg-blue-900/40'
  if (s === DealState.Proposed) return 'text-amber-300 bg-amber-900/40'
  if (s === DealState.Completed) return 'text-slate-300 bg-slate-700/50'
  if (s === DealState.Defaulted || s === DealState.Liquidated)
    return 'text-rose-300 bg-rose-900/40'
  return 'text-slate-400 bg-slate-800/50'
}

/** Generate a cryptographically random bytes32 salt */
export function randomSalt(): `0x${string}` {
  const arr = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

/** Random 8-byte nonce used as the second half of a deal ID */
export function randomDealNonce(): `0x${string}` {
  const arr = crypto.getRandomValues(new Uint8Array(8))
  return `0x${Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Deal ID bound to its proposer (security fix F-08): the first 8 bytes must equal
 * bytes8(keccak256(abi.encode(proposer))), mirroring PersatDealRegistry.dealIdPrefix().
 */
export function deriveDealId(proposer: `0x${string}`, nonce: `0x${string}`): `0x${string}` {
  const prefix = slice(keccak256(encodeAbiParameters([{ type: 'address' }], [proposer])), 0, 8)
  return concat([prefix, nonce])
}

/**
 * Open private links (no reserved counterparty) use an ephemeral key pair (security fix F-07).
 * The private key travels only inside the share link; the chain stores its address (left-padded to 32 bytes).
 */
export function openLinkOnchainSalt(claimKey: `0x${string}`): `0x${string}` {
  return pad(privateKeyToAddress(claimKey), { size: 32 })
}

/** Empty 16-byte deal ID (0x + 32 zeros) */
export const EMPTY_DEAL_ID = '0x00000000000000000000000000000000' as `0x${string}`

/** Check if string is a valid hexadecimal deal ID (either 16-byte or 32-byte hash) */
export function isValidDealId(id?: string | null): boolean {
  if (!id) return false
  const clean = id.trim().toLowerCase()
  if (!clean.startsWith('0x')) return false
  const hexPart = clean.slice(2)
  if (!/^[0-9a-f]+$/.test(hexPart)) return false
  return hexPart.length === 32 || hexPart.length === 64
}

/** Normalize any incoming deal ID into a valid bytes16 (34-character hex string) */
export function normalizeDealId(id?: string | null): `0x${string}` {
  if (!id) return EMPTY_DEAL_ID
  let clean = id.trim().toLowerCase()
  if (!clean.startsWith('0x')) clean = `0x${clean}`
  const hexPart = clean.slice(2)
  if (!/^[0-9a-f]+$/.test(hexPart)) return EMPTY_DEAL_ID
  if (clean.length === 34) return clean as `0x${string}`
  if (clean.length >= 34) return clean.slice(0, 34) as `0x${string}`
  return clean.padEnd(34, '0') as `0x${string}`
}

export function parseOnchainError(error: unknown): string {
  const msg = (error as { message?: string })?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction cancelled.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance'))
    return 'Insufficient balance to cover this transaction.'
  if (msg.includes('dealnotactive')) return 'Deal is not in the required state.'
  if (msg.includes('notborrower')) return 'Only the borrower can call this function.'
  if (msg.includes('notdealparty')) return 'Only the borrower or the lender of this deal can start the loan.'
  if (msg.includes('termshash')) return 'Deal terms have changed — please refresh.'
  if (msg.includes('ltvhealthy')) return 'LTV is healthy — liquidation not available.'
  if (msg.includes('oraclestale')) return 'Price oracle is stale. Try again shortly.'
  if (msg.includes('invalidclaimtoken')) return 'This claim link is invalid or already used.'
  if (msg.includes('invalidsignature')) return 'This claim link is invalid (signature check failed).'
  if (msg.includes('signaturerequired')) return 'This open link must be claimed with its full invitation URL.'
  if (msg.includes('selfmatch')) return 'You cannot take the other side of your own deal.'
  if (msg.includes('invaliddealid')) return 'Deal ID does not match your wallet. Reload the page and try again.'
  if (msg.includes('initialltvtoohigh')) return 'Loan-to-value is above the 65% maximum at the current BTC price. Add collateral or lower the amount.'
  if (msg.includes('dealnotfound')) return 'Deal not found on this network.'
  if (msg.includes('dealalreadyexists')) return 'A deal with this ID already exists. Refresh to generate a new one.'
  if (msg.includes('invalidterms')) return 'Invalid deal terms. Please check amounts and duration.'
  if (msg.includes('cirbtcdepegged')) return 'cirBTC is trading more than 2% away from BTC right now, so new loans are paused. Try again later.'
  if (msg.includes('tokenpaused') || msg.includes('pausable: paused')) return 'USDC or cirBTC is paused by its issuer. Liquidations wait until the pause ends.'
  if (msg.includes('tokensnotpaused')) return 'Neither USDC nor cirBTC is paused at the moment.'
  if (msg.includes('nothingtowithdraw')) return 'Nothing to withdraw.'
  if (msg.includes('blacklisted')) return 'This address is frozen by the token issuer. Funds stay credited and can be withdrawn once it is unfrozen.'
  if (msg.includes('dealexpired')) return 'This offer has expired (30 days). Ask for a new one.'
  if (msg.includes('activationwindowclosed')) return 'The 24-hour window to start the loan has closed. Cancel and create a new deal.'
  if (msg.includes('activeofferexists')) return 'You already have an active offer on this order. Cancel it first.'
  if (msg.includes('principaltoolow')) return 'The minimum amount is 100 USDC.'
  if (msg.includes('offerexpired')) return 'This offer expired (offers last 7 days). Ask for a new one.'
  if (msg.includes('proposerrejected')) return 'The creator of this order declined your offers.'
  if (msg.includes('liquidationspaused')) return 'Liquidations are paused for a short time by the protocol. Try again later.'
  if (msg.includes('liquidationpausecooldown')) return 'Liquidations were paused recently. A new pause is not allowed yet.'
  if (msg.includes('liquidationpausetoolong')) return 'A liquidation pause can last at most 24 hours.'
  if (msg.includes('maxcounteroffersreached')) return 'This order already has the maximum number of active offers.'
  if (msg.includes('notlender')) return 'Only the lender can do this.'
  if (msg.includes('oracleinvalidprice')) return 'The price oracle returned an invalid price. Try again later.'
  if (msg.includes('insufficientallowance') || msg.includes('insufficient allowance')) return 'Approval too low. Approve the amount first.'
  if (msg.includes('reverted')) return 'Transaction failed. Check your balances and approvals.'
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('unable to fetch'))
    return 'Network/RPC issue. Please check that your wallet is on Arc Mainnet.'
  return 'Something went wrong. Please try again.'
}
