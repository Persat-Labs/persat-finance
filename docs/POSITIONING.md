# Persat Finance — Permanent Product Positioning

**Status:** non-negotiable framework for product, UX, architecture, naming, copy, and features.  
**Last locked:** 2026-08-31

Agents and contributors must treat this document as standing law for Persat work.

---

## Non-negotiable positioning

**Persat is NOT fundamentally a Bitcoin lending protocol.**

**Persat is building infrastructure for lending and borrowing between people who do not need to personally trust one another.**

**Bitcoin is our first collateral asset and first market.**

Whenever you make a product, UX, architecture, naming, copy, or feature decision, distinguish between:

### THE PERSAT VISION

- Trust-minimized peer-to-peer lending
- Anyone can lend to anyone
- Collateral-backed credit
- Programmable agreements
- Transparent enforcement
- Open lending infrastructure

### THE CURRENT PILOT

- Bitcoin as the initial collateral asset
- Bitcoin-backed credit
- Current testnet implementation
- Early users validating the model

**Never allow the current Bitcoin implementation to redefine the company's identity.**

When describing Persat publicly, use Bitcoin to make the current product concrete, while keeping the broader lending infrastructure vision visible.

### Mental model

> **Persat is building the highway. Bitcoin is the first vehicle we're putting on it.**

Do not build the product as though Bitcoin is the final destination.

Build the current system well enough to prove the model, while keeping the underlying architecture and product language extensible toward additional digital assets, collateral types, and lending use cases in the future.

### Decision rule

Whenever you are uncertain whether a decision serves the **current Bitcoin pilot** or the **broader Persat vision**, stop and **explicitly identify which layer the decision belongs to** before proceeding.

---

## The “why” (human problem)

Lending today depends heavily on **personal trust**. People lend to friends, family, colleagues — and too often the money never comes back.

The problem is not only that people don’t want to lend. It is that **there is no infrastructure that can give confidence without requiring you to personally trust the counterparty**.

Persat’s answer: credit secured by **digital assets**, terms enforced **transparently through smart contracts** — so you can lend to someone you don’t know, and the **system** makes the agreement enforceable.

Bitcoin is where we **start** (clear demand: liquidity without selling). It is not where the company **ends**.

---

## Public copy defaults

| Layer | Preferred language |
| --- | --- |
| Vision | “What if you could lend to anyone?” / trust-minimized / infrastructure / anyone can lend to anyone |
| Pilot | “starting with Bitcoin” / “Bitcoin pilot” / “first collateral asset” / “first market” |
| Avoid as identity | “Bitcoin lending protocol” as the sole definition of Persat |

**Headline (waitlist):** What If You Could Lend to Anyone?  
**Subhead:** Infrastructure for a world where anyone can lend to anyone, secured by digital assets and enforced by smart contracts, starting with Bitcoin.

---

## Sites in scope

| Surface | Path | Notes |
| --- | --- | --- |
| Waitlist | `waitlist/` → `persat.finance` | Primary public voice |
| dApp | `frontend/` → `dapp.persat.finance` | Onboarding + metadata aligned |
| Pitch / docs | `docs/pitch/`, README | Keep vision/pilot distinction |

---

## Checklist before shipping copy or features

- [ ] Does this sentence define Persat only as “Bitcoin lending”? If yes, rewrite.
- [ ] Is Bitcoin labeled as pilot / first market where relevant?
- [ ] Does architecture assume only BTC forever, or stay extensible?
- [ ] Did I name which layer (vision vs pilot) this change serves?
