# Persat Finance — Smart Contract Design Document

**Status:** Draft  
**Authors:** Persat Labs Limited  
**Target Chain:** Arc Testnet (Chain ID 5042002) → Arc Mainnet (Chain ID 5042)  
**Language / Toolchain:** Solidity ^0.8.24, Foundry (forge)  
**Version:** 2.0 — Global, Single Oracle, Dual-Path Model  
**Milestone:** MVP  

**Review Tracker:**
- [ ] Design Review (TBD)
- [ ] Security Review (TBD)
- [ ] Ops Review (TBD)
- [ ] Data Review (TBD)
- [ ] Compliance Review (TBD)

---

## Action Items (living)

### Security review — November 2026 (implemented on branch `fix/security-review`)

| ID | Finding | Change |
|----|---------|--------|
| F-01 | Mainnet collateral was a publicly mintable mock | `scripts/deploy-mainnet.cjs` no longer deploys a token; it requires `CIRBTC_ADDRESS` and aborts if `mint()` is callable by anyone, decimals ≠ 8, or the oracle is stale |
| F-02 | Default gave the lender no remedy | `liquidate` is allowed when LTV ≥ 80% **or** when the loan is unpaid `GRACE_PERIOD` (7 days) after maturity; repayment after maturity adds `LATE_FEE_BPS` (2% of principal) |
| F-03 / F-04 | Owner could drain unclaimed principal; principal could get stuck | Principal (minus fee) is transferred lender → borrower in `activateLoan`; `claimPrincipal` / `claimableUsdc` removed; the vault never holds user USDC |
| F-05 | No LTV check at activation | `activateLoan` reads the oracle and requires `(principal + interest) / collateralValue ≤ maxInitialLtvBps` (constructor arg, 65% recommended, must be < liquidation threshold) |
| F-06 | Liquidation ignored interest, no keeper incentive | Debt = principal + interest (+ late fee); caller receives `LIQUIDATION_BONUS_BPS` (3% of the lender's share) out of the borrower surplus only |
| F-07 | Open private-link secret readable from calldata / front-runnable | Open links (no `reservedFor`) store an ephemeral signer address; claim via `claimDealWithSignature` with a signature bound to `msg.sender`. Reserved links keep `claimDeal(salt)` |
| F-08 | Deal ID squatting | First 8 bytes of `dealId` must equal `dealIdPrefix(msg.sender)` |
| F-09 | Self-matching; counter-offers not withdrawable | `SelfMatch` checks on propose/claim/counter-offer/accept; new `cancelCounterOffer` |
| F-10 | Testnet oracle writable by anyone | New `contracts/PythPriceFeedAdapter.sol` (Chainlink-compatible wrapper over Pyth `getPriceUnsafe`) |

Regression tests: `contracts/test/SecurityFixes.t.sol`. **Contracts must be redeployed for these fixes to take effect; the frontend on this branch targets the new ABI.**

### Audit round 2 and bridge analysis — November 2026 (branch `fix/audit-round2-bridge`)

| ID | Finding | Change |
|----|---------|--------|
| N-01 | Deals discovered by scanning a fixed block window (Arc RPC caps `eth_getLogs` at 10,000 blocks) | Registry keeps an on-chain index: `getUserDeals(user, offset, limit)` (deals a user proposed, claimed, won or was reserved for) and `getPublicDeals(offset, limit)`; the frontend reads it instead of scanning logs |
| N-03 | 50 counter-offer slots could be exhausted by submit/withdraw | Only active offers count (`activeCounterOffers`), one active offer per address (`ActiveOfferExists`); `acceptCounterOffer` no longer loops over all offers |
| N-04 | Dead oracle froze overdue loans | If the oracle is unusable and the loan has been liquidatable-by-date for `ORACLE_FAILURE_DELAY` (30 days), the lender can claim the whole collateral (`OracleFailureClaim`) |
| N-05 | Nothing expired | Proposals and their counter-offers expire after `PROPOSAL_TTL` (30 days, `isExpired`); a confirmed deal must be activated within `ACTIVATION_WINDOW` (24 h since round 4, `activationDeadline`) |
| N-06 / B-1 | Push payments: a frozen party blocked repayment or liquidation | Every payout tries a direct transfer and, if it fails, credits `claimable[token][account]` for a later `withdraw(token)` to the same address; `rescueERC20` cannot touch credited balances |
| B-2 | A token pause could cause an unfair liquidation | No liquidation while USDC or cirBTC is paused; `notePause()` records a pause, which delays overdue liquidation until `PAUSE_CURE_PERIOD` (3 days) after the last observation and waives the late fee when the pause started during the grace period |
| B-3 / N-12 | Collateral valued as BTC, not cirBTC | Optional `pegGuard` (`CirBtcPoolTwap`, 30-min TWAP of the cirBTC/USDC pool): activation reverts with `CirBtcDepegged` if cirBTC trades more than `MAX_PEG_DEVIATION_BPS` (2%) from the BTC/USD feed |
| B-4 / N-12 | Lender paid in cirBTC after liquidation | A liquidator repays the lender in USDC (up to the collateral value / 1.03) and receives the matching cirBTC plus 3%; surplus goes to the borrower. The lender can still liquidate alone and take the cirBTC |
| N-10 | Single key; fee could change between confirmation and activation | Fee changes are queued for `FEE_CHANGE_DELAY` (4 days, longer than the activation window); the deploy script requires `OWNER_ADDRESS` to be a contract (multisig) and hands ownership over with Ownable2Step |
| N-11 | Full-term interest on early repayment | Interest accrues pro rata with a one-month minimum; activation LTV still uses full-term interest |
| N-13 | Staleness limit equal to the 24 h heartbeat | Deploy script uses 3 h (10,800 s): the Arc feed moves on 0.1% deviation, ~3 minutes on average, longest gap 52.5 minutes over 6 days (measured Nov 2026) |
| Info | Unused fee settings in the registry | Removed; the registry constructor is now `(usdc, cirBtc, owner)` |

### Review round 3 — November 2026

| ID | Finding | Change |
|----|---------|--------|
| R3-01 | A Circle freeze on the fee recipient made every `activateLoan` revert | The fee goes through the vault and is pushed or credited like other payouts |
| R3-02 | Admin share links could prefill a malicious destination | Decoded call arguments and a warning on ownership transfer, rescue and fee recipient |
| R3-03 | EIP-7702 delegated wallets passed the deploy script's multisig check | The script rejects them; the admin page treats them as single wallets |
| R3-04 | A queued fee change was not visible to users | Shown on the loan page before activation |
| R3-05 | Landing widget implied the collateral earns yield | Marked as an example, wording fixed, governance tab removed |

`contracts/test/InvariantAccounting.t.sol` fuzzes activations, repayments, liquidations, Circle freezes and pauses, price moves, time jumps and withdrawals (80,000 calls) and checks that the vault's cirBTC equals locked collateral plus credits, that it holds no USDC beyond credits, and that closed loans hold nothing.

Regression tests: `contracts/test/AuditRound2.t.sol` (tokens mimic Circle's blacklist and pause). `CirBtcPoolTwapForkTest` checks the TWAP against Chainlink on a local fork of Arc Mainnet when `ARC_FORK_RPC` is set.
### Audit round 4 — November 2026 (branch `fix/audit-round4`)

| ID | Finding | Change |
|----|---------|--------|
| R4-01 | 50 throwaway addresses could fill an order's offer slots | Minimum offer of 100 USDC, offers expire after 7 days, the creator can decline an offer and that address cannot offer again on the order |
| R4-02 | Offer/cancel loops grew the offer array without bound, eventually breaking reads | `getActiveCounterOffers` returns only live offers (at most 50); history is read with `getCounterOffersPage` |
| R4-03 | Cheap public orders and reserved invitations pushed real deals out of the windows the UI reads | Minimum deal of 100 USDC; open orders have their own index (`getOpenPublicDeals`), invitations their own (`getInvitations`) |
| R4-04 | Borrowers could not defend a position | `addCollateral` on active loans |
| R4-05 | No way to stop liquidations during an oracle incident | `pauseLiquidations`: at most 24 h, plus a 6 h grace, then a 3-day cooldown |
| R4-06 | Renouncing ownership while paused froze the protocol | `renounceOwnership` reverts on both contracts |
| R4-07 | The vault accepted a 26 h old price while the Arc feed updates every ~3 minutes | Deploy script sets 3 h (longest measured gap: 52.5 minutes) |
| R4-08 | The deploy script used whatever was in `contracts/out` and did not run the TWAP check it described | It rebuilds, checks the artifacts, and compares the pool TWAP with the oracle before sending anything (also in dry run) |
| R4-09 | cirBTC is valued with BTC/USD during a loan; a depeg is not detected | Accepted and disclosed to lenders (deal form, offers, Security page). Checked Nov 2026: none of the 36 Chainlink feeds on Arc prices cirBTC; `cirBTC Reserves` (proof of reserve) covers all chains and cannot be compared with the Arc supply. Revisit if a cirBTC price feed appears |
| R4-10 | Only the borrower could start an accepted loan, so the lender waited with no way to finish, and the borrower held a free 72 h option. The window is now 24 h (other platforms: none at NFTfi, 12 h + 8 h at Hodl Hodl Lend) | `activateLoan` is callable by the borrower or the lender (`NotDealParty` otherwise); the funds still move in one transaction. Approving cirBTC lets the lender start the loan without another borrower signature, which the offer form states |

Frontend: approvals add to the existing allowance instead of replacing it; the claim key leaves the address bar once read (kept for the tab only); Vercel installs with `npm ci`; unused packages removed; public Security page. Regression tests: `contracts/test/AuditRound4.t.sol`.

---

## 1. Goals / Non-Goals

### Goals

- Provide a fully non-custodial peer-to-peer Bitcoin-collateralised lending protocol on Arc Testnet (with path to mainnet).
- Two discovery paths converging on the same on-chain deal object: **Private Deal Links** (single-use claim token) and **Open Marketplace** (public order book with structured counter-offers only).
- Atomic loan activation: collateral lock + principal disbursal in a single transaction.
- Automated, permissionless liquidation when LTV exceeds 80%, driven by an on-chain BTC/USD price oracle (Pyth on testnet; Chainlink BTC/USD proxy `0xa109B535C70C8Be9995be64Bb6751AcDB27e03De` on mainnet).
- Repayment returns principal + interest to the lender and releases cirBTC to the borrower atomically.
- Zero "god-mode" operator keys — all state transitions governed by on-chain math and explicit party consent.
- Protocol fee collected at activation (configurable, never exceeding a hard cap).

### Non-Goals

- Pooled liquidity or yield aggregation (pure P2P, no AMM).
- Multi-hop or cross-chain collateral (single-chain Arc only).
- Free-text messaging or any off-chain orderbook — counter-offers are strictly structured (amount, rate, duration, LTV). No social or reputation scoring at MVP.
- Upgradeable proxy architecture at MVP — immutable contracts, migration path via new deployment + dual-run.
- Local-currency stablecoins or fiat on-ramps.
- De-peg detection for USDC/USDT at MVP (USDC treated as exactly $1; deferred to post-MVP hardening).
- Governance token or protocol-owned liquidity.

---

## 2. Requirements

### Functional

1. **Deal Registry** stores a unique `bytes16 dealId`, borrower, lender, principal (USDC 6-decimal ERC-20), collateral amount (cirBTC), `rateBps`, `durationMonths`, `visibility` (Private | Public), and a `DealState` enum.
2. **Private path:** Initiator creates deal with a visibility=Private flag. A 32-byte claim token (off-chain derived, but verified on-chain as keccak256 of `dealId ++ salt`) is embedded in the claim URL. Counterparty calls `claimDeal(dealId, token)` which binds their wallet and transitions to Confirmed, invalidating the token (single-use).
3. **Public path:** Initiator creates deal with visibility=Public. Any wallet may submit a structured counter-offer `(amount, rateBps, durationMonths)`. Initiator accepts exactly one counter-offer, which transitions to Confirmed and cancels all others.
4. **Terms hash** computed as `keccak256(abi.encode(dealId, borrower, lender, principal, collateral, rateBps, durationMonths))` at Confirmed transition; stored immutably; must match at every subsequent state change.
5. **Atomic activation:** single call deposits cirBTC from borrower into vault, transfers USDC principal from lender to borrower, deducts protocol fee.
6. **Repayment:** borrower repays `principal + interest`; interest = `principal * rateBps * durationMonths / (10000 * 12)`; contract releases cirBTC to borrower and USDC to lender atomically.
7. **Liquidation:** permissionless call when `(principal + interest) / collateral_usd_value ≥ liquidationThreshold (80%)`, or when the loan is unpaid 7 days after maturity. Lender receives cirBTC worth the debt (principal + interest, + 2% late fee after maturity); the caller receives a 3% bonus from the surplus; the remaining collateral is returned to borrower.
8. **Protocol fee:** collected at activation, configurable by `feeAdmin` up to `MAX_FEE_BPS` (e.g. 50 bps = 0.5%).

### Security

- No path lets an unpermissioned caller cancel a Private deal before Funding.
- The terms hash must be verified before every fund movement; tampered terms revert.
- Oracle staleness must be checked before any liquidation; stale oracle reverts the liquidation.
- Re-entrancy protected on every external-call site (CEI + `nonReentrant`).
- Protocol fee must never exceed `MAX_FEE_BPS`.
- Zero-address checks on all critical constructor and function args.
- `SafeERC20` for all token transfers.

---

## 3. Terminology & Actors

| Term | Definition |
|------|------------|
| **Deal** | A bilateral agreement recorded on-chain: one borrower, one lender, fixed terms |
| **cirBTC** | Circle's native Bitcoin representation on Arc (ERC-20 collateral token) |
| **Principal** | USDC amount the lender disburses to the borrower |
| **Collateral** | cirBTC amount the borrower locks in the vault |
| **LTV** | Loan-to-Value = `principal_usd / collateral_usd`; must stay below liquidation threshold |
| **rateBps** | Annual interest rate in basis points (1 bps = 0.01%) |
| **durationMonths** | Fixed loan term in whole months |
| **claimToken** | Single-use 32-byte token embedded in a private deal-link URL |
| **termsHash** | `keccak256` of all deal parameters; computed at Confirmed; guards integrity forever |
| **liquidationThreshold** | LTV floor (80% at launch) above which permissionless liquidation is allowed |
| **feeAdmin** | Role-holder who may adjust `feeBps` within the hard cap |

| Actor | On/Off-chain | Trust Level | Capabilities |
|-------|-------------|-------------|--------------|
| **Borrower** | On-chain | Untrusted | Propose private/public deal, claim private deal as borrower, deposit collateral, repay loan |
| **Lender** | On-chain | Untrusted | Propose private/public deal, claim private deal as lender, confirm public counter-offer match, disburse USDC |
| **Liquidator** | On-chain | Untrusted | Call liquidate when LTV exceeds threshold; no special key required |
| **feeAdmin** | On-chain | Semi-trusted | Set `feeBps` within `MAX_FEE_BPS`; cannot move funds |
| **feeRecipient** | On-chain | Semi-trusted | Receives protocol fee; set at deploy; changeable by `feeAdmin` |
| **Price Oracle** | On-chain | Semi-trusted | Chainlink proxy (mainnet) / Pyth (testnet) — staleness-guarded |
| **Keeper bot** | Off-chain | Untrusted (relayer only) | Monitors for liquidatable positions and calls permissionless liquidate |

---

## 4. Language / Runtime

- **Solidity ^0.8.24** — built-in overflow/underflow checks, custom errors, `block.timestamp` available.
- **EVM target:** Paris (`foundry.toml` pins `evm_version = "paris"` on Arc Studio).
- **Foundry (forge)** — testing, deployment, and gas reports.
- **OpenZeppelin 5.1.0** (pinned in sandbox) — `ReentrancyGuard`, `SafeERC20`, `Ownable2Step`, `Pausable`, `IERC20`.
  - Note: OZ ≥5.2.0 uses `mcopy` (Cancun-only) in `Bytes.sol`; stay on 5.1.0 for Paris EVM compatibility.
- **No upgradeable proxies at MVP** — immutable contracts chosen for simplicity and auditability.

---

## 5. Transaction & Execution Model

All state changes are atomic EVM transactions: either all state is committed or all is reverted. There is no intermediate state where one party's funds are at risk without the other's commitment being on-chain.

**Re-entrancy surface:**
- `activateLoan` — calls two ERC-20 `transferFrom` + one `transfer`. CEI: state set to Active before transfers. `nonReentrant` applied.
- `repayLoan` — calls ERC-20 `transferFrom` (borrower) + `transfer` (lender) + `transfer` (borrower collateral release). CEI + `nonReentrant`.
- `liquidate` — calls oracle, then transfers. CEI + `nonReentrant`.

No raw ETH/native value is transferred to `address(0)` (Arc reverts on this).

---

## 6. Arc Network Specifics

| Item | Value |
|------|-------|
| Chain ID (testnet) | 5042002 |
| RPC | https://rpc.testnet.arc.io |
| Explorer | https://explorer.testnet.arc.io |
| Native gas token | USDC (18-decimal native view; ERC-20 view: 6 decimals at `0x3600000000000000000000000000000000000000`) |
| ERC-20 USDC decimals | 6 |
| cirBTC | ERC-20 collateral token (address TBD, user-supplied at deploy) |
| Min gas price | 20 Gwei (`maxFeePerGas` floor) |

**Oracle strategy:**
- **Arc Testnet:** Pyth BTC/USD (only BTC/USD feed is kept fresh on Arc testnet as of 2026-09-14; staleness threshold set conservatively at 3600s).
- **Arc Mainnet:** Chainlink BTC/USD proxy `0xa109B535C70C8Be9995be64Bb6751AcDB27e03De`, 8 decimals, 0.1% deviation and 24 h heartbeat (Chainlink directory); ~3 minutes on average, longest gap 52.5 minutes over 6 days (measured Nov 2026).
- **Design decision:** The oracle address and staleness threshold are constructor-injectable (immutable post-deploy). The contract calls `decimals()` and normalises the price to 8 decimals internally. Mainnet deployment will pass the Chainlink proxy; testnet will pass the Pyth adapter address.
- Contracts import a minimal `IPriceFeed` interface (`latestRoundData` compatible with Chainlink AggregatorV3Interface). A Pyth adapter contract wraps Pyth's `getPriceUnsafe` to expose the same interface. **Always call `decimals()`; never hardcode 8.**

---

## 7. Architecture Overview

```mermaid
sequenceDiagram
    participant B as Borrower
    participant L as Lender
    participant R as PersatDealRegistry
    participant V as PersatEscrowVault
    participant Oracle as PriceFeed (Chainlink/Pyth)
    participant USDC as USDC ERC-20
    participant cirBTC as cirBTC ERC-20

    Note over B,L: Path A — Private Deal Link
    B->>R: proposeDeal(terms, visibility=Private, claimToken)
    L->>R: claimDeal(dealId, claimToken)  // binds lender, state→Confirmed
    B->>V: activateLoan(dealId)
    V->>cirBTC: transferFrom(borrower, vault, collateral)
    V->>USDC: transferFrom(lender, borrower, principal - fee)
    V->>USDC: transferFrom(lender, feeRecipient, fee)
    Note over V: state → Active, termsHash locked

    Note over B,L: Repayment
    B->>V: repayLoan(dealId)
    V->>USDC: transferFrom(borrower, lender, principal + interest)
    V->>cirBTC: transfer(borrower, collateral)
    Note over V: state → Completed

    Note over B,L: Liquidation (permissionless)
    Oracle-->>V: BTC/USD price (checked for staleness)
    V->>V: compute LTV; require LTV > liquidationThreshold
    V->>USDC: transfer(lender, debtUsd)
    V->>cirBTC: transfer(borrower, excessCollateral)
    Note over V: state → Liquidated
```

**Flow of Funds:**

| Step | Who moves what | Invariant |
|------|---------------|-----------|
| Activation — collateral deposit | cirBTC: borrower → vault | vault.cirBTC += collateral |
| Activation — principal disbursal | USDC: lender → borrower | borrower.USDC += principal − fee |
| Activation — fee | USDC: lender → feeRecipient | feeRecipient.USDC += fee |
| Repayment — interest+principal | USDC: borrower → lender | lender.USDC += principal+interest |
| Repayment — collateral release | cirBTC: vault → borrower | vault.cirBTC -= collateral |
| Liquidation — debt repay | cirBTC: vault → lender (worth principal + interest) | lender made whole in cirBTC at oracle price |
| Liquidation — excess collateral | cirBTC: vault → borrower | no cirBTC stranded in vault |

**Resting-state invariant:** The vault holds cirBTC only for Active deals. For Completed, Liquidated, or Cancelled deals the vault holds zero cirBTC for that deal.

**Dependencies:**
- USDC ERC-20 at `0x3600000000000000000000000000000000000000` (Arc, both networks).
- cirBTC ERC-20 (address passed at deploy).
- IPriceFeed oracle (address passed at deploy; Pyth adapter or Chainlink proxy).

---

## 8. Contract Design

### 8.1 PersatDealRegistry

#### Roles

| Role | Count/Holder | Permissions | Why |
|------|-------------|-------------|-----|
| `owner` (Ownable2Step) | 1 — deployer (feeAdmin EOA) | Set `feeBps`, `feeRecipient`; pause/unpause; set oracle; emergency rescue of stuck tokens | Admin functions only; cannot move deal funds |
| `borrower` | Per deal | Propose, cancel (pre-Funding), repay | Party to the deal |
| `lender` | Per deal | Claim (private) or accept counter-offer (public), cancel (pre-Funding) | Party to the deal |
| `liquidator` | Any EOA | Call `liquidate` when LTV condition met | Permissionless enforcement |

#### State Variables

```
mapping(bytes16 => Deal) public deals;
mapping(bytes32 => bool) public usedClaimTokens;   // prevent replay of claim tokens
uint256 public feeBps;         // current fee in bps
uint256 public constant MAX_FEE_BPS = 50;
address public feeRecipient;
bool public paused;
```

#### Deal Struct

```solidity
struct Deal {
    bytes16   dealId;
    address   borrower;
    address   lender;
    uint256   principal;        // USDC, 6-decimal ERC-20 units
    uint256   collateral;       // cirBTC, 18-decimal ERC-20 units
    uint256   rateBps;          // annual interest in bps
    uint8     durationMonths;
    Visibility visibility;      // Private | Public
    DealState state;
    bytes32   termsHash;        // locked at Confirmed; verified at every fund movement
    bytes32   claimToken;       // for Private deals; zeroed after use
    uint256   activatedAt;      // block.timestamp at activation
}
```

#### DealState Enum

`Proposed → Confirmed → Active → Completed | Defaulted | Liquidated | Cancelled`

#### Key Write Functions

| Function | Caller | State Change | Events | Reverts When |
|----------|--------|-------------|--------|--------------|
| `proposeDeal(...)` | borrower or lender | Creates Deal in Proposed | `DealProposed` | zero address, zero amount, zero rate, zero duration |
| `claimDeal(dealId, token)` | counterparty (private) | Sets lender/borrower, state→Confirmed, termsHash locked | `DealConfirmed` | token mismatch, token already used, deal not Proposed, wrong visibility |
| `submitCounterOffer(dealId, amount, rateBps, durationMonths)` | any address (public) | Adds CounterOffer record | `CounterOfferSubmitted` | deal not Public/Proposed, expired, caller already has an active offer, 50 active offers |
| `acceptCounterOffer(dealId, offerId)` | original proposer | Sets counterparty, updates terms, state→Confirmed, termsHash locked; other offers can no longer be accepted | `DealConfirmed` | not proposer, offer not found, deal not Public/Proposed, expired |
| `cancelDeal(dealId)` | borrower or lender | state→Cancelled | `DealCancelled` | state not Proposed or Confirmed (pre-Funding) |

### 8.2 PersatEscrowVault

#### Key Write Functions

| Function | Caller | State Change | Events | Reverts When |
|----------|--------|-------------|--------|--------------|
| `activateLoan(dealId)` | borrower | state→Active; cirBTC in; USDC out; fee out | `LoanActivated` | state not Confirmed, termsHash mismatch, zero address, insufficient allowances |
| `repayLoan(dealId)` | borrower | state→Completed; USDC in; USDC to lender and cirBTC to borrower (or credited if the transfer fails) | `LoanRepaid` | state not Active/Defaulted, termsHash mismatch, insufficient USDC allowance |
| `liquidate(dealId)` | anyone | state→Liquidated; liquidator pays the lender in USDC and receives cirBTC + 3%; surplus to borrower | `LoanLiquidated`, `LiquidationSettled` | state not Active/Defaulted, LTV healthy and not overdue, oracle stale, token paused |
| `withdraw(token)` | anyone with a credit | Sends `claimable[token][caller]` to the caller | `Withdrawn` | nothing owed |
| `notePause()` | anyone | Records that USDC or cirBTC is paused | `TokenPauseNoted` | neither token paused |
| `markDefault(dealId)` | anyone (after term expiry) | state→Defaulted | `LoanDefaulted` | state not Active, not past maturity |

---

## 9. Security Considerations

| Vulnerability | Applicable? | Mitigation |
|--------------|-------------|------------|
| Reentrancy | Yes — activateLoan, repayLoan, liquidate all make external calls | CEI ordering (state set before transfers) + `nonReentrant` on all three |
| Access control | Yes — deal-state transitions must be party-gated | `msg.sender` checks at each state gate; permissionless only for liquidate/markDefault |
| Integer overflow/underflow | Solidity ≥0.8 checked | No `unchecked` blocks; interest math uses standard checked arithmetic |
| Unchecked ERC-20 return | Yes | `SafeERC20.safeTransferFrom` / `safeTransfer` on all token moves |
| Fee-on-transfer / rebasing | cirBTC could theoretically be rebasing | Balance-delta assertion: measure vault.cirBTC before and after deposit; use delta, not stated amount |
| Claim token replay | Yes — single-use tokens must be invalidated | `usedClaimTokens[token] = true` before state change |
| Terms hash tampering | Yes — terms must be immutable after Confirmed | `termsHash` computed and stored at Confirmed; checked before every fund movement |
| Flash-loan / price manipulation | Yes — oracle used for liquidation | Only Chainlink/Pyth aggregator price; staleness guard; no spot DEX price |
| Oracle staleness | Yes | `require(block.timestamp - updatedAt <= stalenessThreshold, OracleStale)` |
| Denial of service | Bounded loops in counter-offer cancellation | Cap `MAX_COUNTER_OFFERS` per deal (e.g. 50); emit events instead of storing all cancelled |
| Timestamp dependence | Used for maturity / default check | Tolerance is months-scale; not used for randomness; safe |
| Approval persistence | Lender must pre-approve vault for principal; borrower for collateral | Pull-only pattern; approvals are per-activation only; no standing max approvals stored by this contract |
| Centralization risk | `feeAdmin` / `owner` can change fee | Cap enforced (`MAX_FEE_BPS`); cannot move deal funds; Ownable2Step prevents accidental transfer |
| address(0) native transfer | Arc reverts on native send to 0x0 | Zero-address checks on `feeRecipient`, `borrower`, `lender` at all entry points |
| 20 Gwei gas floor | Keeper/liquidation tx must clear floor | Documented; liquidation is permissionless — any caller who sets ≥20 Gwei `maxFeePerGas` succeeds |
| USDC 6-decimal vs native 18-decimal confusion | Yes — Arc duality | All principal/interest math uses 6-decimal ERC-20 USDC only; `msg.value` is never used in these contracts |
| cirBTC decimals unknown at compile time | Yes | `cirBTC.decimals()` read at construction and stored; collateral math normalised accordingly |

---

## 10. Trust Model & Threat Analysis

| Actor | Max damage if compromised | Mitigation | Detection |
|-------|--------------------------|------------|-----------|
| `owner` / `feeAdmin` | Change fee up to 50 bps, change feeRecipient, pause protocol | Fee capped at `MAX_FEE_BPS`; cannot touch deal funds; Ownable2Step — 2 txs to transfer | Monitor `OwnershipTransferStarted`, `FeeUpdated` events |
| Price oracle | Manipulated BTC price could trigger false liquidation or block legitimate ones | Only accept prices within deviation bounds (secondary staleness heuristic); liquidation delay TBD post-MVP | Monitor `LoanLiquidated` with anomalous prices |
| Lender | Front-run repayment to extract collateral | Only vault executes repayment logic; lender cannot call repay | N/A — math-governed |
| Borrower | Walk away post-activation (default risk) | Collateral locked in vault; liquidation permissionless after LTV breach or term expiry | Monitor `LoanDefaulted` |
| Liquidator | Grief (call too early / too late) | LTV check is on-chain math — call only succeeds if condition met | N/A — call reverts if premature |

---

## 11. Emergency Response

- **Pause:** `owner` can pause `activateLoan`, `repayLoan`, and `liquidate` (new activations / repayments / liquidations blocked; existing Active loans unaffected in storage).
- **Token rescue:** `owner` can call `rescueERC20(token, recipient, amount)` for any token that is NOT a currently-locked cirBTC amount (deal-locked collateral is non-rescuable).
- **Fee drain prevention:** `MAX_FEE_BPS` is a compile-time constant; no override path exists.

---

## 12. Deployment & Initialization

**PersatDealRegistry constructor args:**
- `address usdc` — USDC ERC-20 (`0x3600000000000000000000000000000000000000`)
- `address cirBtc` — cirBTC ERC-20 (user-supplied)
- `address vault` — PersatEscrowVault address (set after vault deployed)
- `address feeRecipient_`
- `uint256 feeBps_` (≤ 50)
- `address initialOwner`

**PersatEscrowVault constructor args:**
- `address registry` — PersatDealRegistry address
- `address usdc`
- `address cirBtc`
- `address priceFeed` — oracle address
- `uint256 stalenessThreshold` — e.g. 3600 (testnet Pyth), 86400 (mainnet Chainlink)
- `uint256 liquidationThresholdBps` — 8000 (= 80%)
- `address feeRecipient_`
- `uint256 feeBps_`
- `address initialOwner`

**Deploy order:** Registry first (vault address not yet known), then Vault (pass Registry address), then call `registry.setVault(vault)` to wire the two contracts.

**Key at genesis:** `initialOwner` = deployer wallet (testnet); recommend multisig (mainnet).

---

## 13. Upgradeability

**Not upgradeable at MVP.** Immutable contracts chosen for auditability and simplicity.

**Migration story:** If a bug fix is required post-deploy, deploy new contract versions, run both contracts in parallel for any active loans, and signal all new originations to the new contracts via a UI-level registry switch. Completed/Liquidated loans on old contracts remain readable forever.

---

## 14. Key Management & Signing

- No off-chain signatures required for the MVP on-chain flow — every action is a direct transaction.
- Claim tokens are derived off-chain as `keccak256(abi.encode(dealId, salt))` where `salt` is a random 32-byte value the frontend generates at deal creation. The salt is never stored on-chain; only the token hash is committed.
- **Replay protection for claim tokens:** `usedClaimTokens[token] = true` at the moment of claim.

---

## 15. Failure Scenarios

| Scenario | What happens | Invariant preserved? |
|----------|-------------|---------------------|
| Oracle goes stale | `liquidate` reverts with `OracleStale` | Yes — no liquidation on bad data |
| Lender never disburses USDC (insufficient allowance) | `activateLoan` reverts; state stays Confirmed; cirBTC never leaves borrower | Yes |
| Borrower never repays (past maturity) | Any caller invokes `markDefault`; state→Defaulted; lender can initiate liquidation via `liquidate` | Yes |
| LTV breaches 80% before maturity | Permissionless liquidation; lender reimbursed first, excess collateral returned to borrower | Yes |
| Fee recipient is a contract that rejects transfers | `safeTransfer` reverts; activation fails; state unchanged | Yes — no partial activation |
| Counter-offer cap exceeded | New offer submission reverts; existing offers unaffected | Yes |

---

## 16. Testing Strategy

- **Unit tests (Foundry `.t.sol`):** 100% branch coverage target on state-machine transitions; fuzz `rateBps`, `durationMonths`, `principal`, and `collateral` amounts; invariant: vault cirBTC balance equals sum of Active deal collaterals.
- **Integration tests:** Fork Arc Testnet (or local anvil with mocked tokens); end-to-end happy path for both Private and Public paths; liquidation scenario with mocked oracle price.
- **Static analysis:** Slither on production contracts.
- **Run full suite:** `cd contracts && forge test --gas-report`

---

## 17. Third-Party Libraries

| Library | Version | Dependency? | Why | Security reviewed? |
|---------|---------|-------------|-----|--------------------|
| `@openzeppelin/contracts` | 5.1.0 | Yes (pinned) | `ReentrancyGuard`, `SafeERC20`, `Ownable2Step`, `Pausable` | Yes (OZ audit history) |
| Chainlink AggregatorV3Interface | Interface only (inline) | No npm dep | BTC/USD price feed consumer | Interface only — no logic |
| Pyth SDK | Interface only (inline) | No npm dep | Testnet oracle adapter | Interface only |

---

## 18. Priorities & Tradeoffs

| Decision | Tradeoff | Rationale |
|----------|----------|-----------|
| Immutable contracts (no proxy) | Harder to fix post-deploy; requires migration | Simpler mental model, no proxy storage collision risk, audit surface is smaller |
| Single oracle (no dual-oracle) | De-peg of USDC not detected at MVP | USDC treated as $1 for MVP; deferred hardening acceptable |
| Pull-only repayment (borrower initiates) | Lender cannot force repayment | Matches "no god-mode" principle; `markDefault` gives lender recourse |
| Cap `MAX_COUNTER_OFFERS = 50` | Large order books not supported | Bounded gas; acceptable for MVP P2P model |
| Pyth on testnet / Chainlink on mainnet | Two different oracle interfaces | Wrapped behind `IPriceFeed` adapter; swap at deploy time with no contract changes |
| Fixed interest (not floating) | Cannot adjust to market conditions mid-loan | Agreed up-front; simpler math; correct for P2P bilateral loans |

---

## 19. Monitoring & Alerting

| Event | Threshold | Severity | Playbook |
|-------|-----------|----------|----------|
| `LoanLiquidated` with price anomaly | BTC/USD > 20% single-block move | High | Review oracle feed; pause if manipulation suspected |
| `OwnershipTransferStarted` | Any | High | Verify intended transfer; cancel if unexpected |
| `FeeUpdated` | fee > 30 bps | Medium | Review governance decision |
| `LoanDefaulted` | Any | Medium | Alert lender to initiate liquidation |
| `OracleStale` reverts cluster | >5 in 10 min | High | Oracle liveness incident; check Pyth/Chainlink |

---

## 20. Cross-Functional Stakeholders

| Stakeholder | Owns |
|-------------|------|
| Persat Labs engineering | Contract correctness, deploy ops |
| Security reviewer | STEP 3 + Slither findings |
| Frontend team | Claim-link URL generation, structured counter-offer UI, LTV calculator |
| Ops / keeper team | Liquidation bot, oracle liveness monitoring |
| Compliance | KYC/AML deferred; no sanctions screening at MVP |
