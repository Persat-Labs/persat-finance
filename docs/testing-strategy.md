# Testing and security evidence strategy

This plan implements the mandatory four-pass methodology. A roadmap checkbox is never sufficient evidence by itself.

## Pass 1 — unit and access-control coverage

**Target:** 95%+ line/branch coverage for each Anchor program, including every success path and rejection path.

- Instruction tests: valid state transition, invalid state transition, invalid signer, invalid owner, invalid PDA seeds, duplicate action, paused protocol, stale oracle, unsupported asset, and checked-arithmetic boundary.
- Backend tests: wallet signature replay, expired challenge, invalid base58, one-time deal link, structured proposal validation, unauthorized proposal action.
- Frontend policy test: `npm run frontend:marketplace-policy` blocks free-text marketplace fields at source level; manual rendered-screen validation remains required.

## Pass 2 — fuzzing

**Target:** at least 10,000 iterations for each financial calculation family.

- Interest/installment totals and final-payment rounding
- LTV, collateral valuation, partial liquidation cap, full-liquidation surplus
- Token decimal conversion and maximum-value arithmetic
- PDA seed inputs and deal-state transitions

Fuzz corpus seeds, iteration counts, failures, fixes, and rerun results belong in `security-audits/pass-2/`.

## Pass 3 — live testnet integration

Required scenarios: ten private lifecycle cycles, ten marketplace lifecycle cycles, private-link reuse attempt, terms-mismatch proposal resolution, missed payment/default, partial liquidation, full liquidation, stale oracle rejection, emergency pause, manual bridge fallback.

Each test report must include the exact transaction signatures and cluster.

## Pass 4 — adversarial audit

Required attacks: unauthorized PDA signing, CPI/reentrancy attempt, malformed oracle state, stale oracle action, fake listing/proposal spam, off-platform-contact field injection, deal-link theft/reuse, keeper privilege abuse, and governance timelock bypass.

A successful exploit pauses progression. Program changes require Pass 3 and Pass 4 to run again.
