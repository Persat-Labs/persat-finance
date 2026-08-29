# B2 — Ten lifecycle cycles (Pass-3 pack)

Template generator: `frontend/scripts/day3-lifecycle-cycles.mjs`  
Evidence directory: `security-audits/pass-3/cycles/`  
Recorder: `frontend/scripts/record-cycle.mjs`

## Cycle map

| # | File (target) | Path | Outcome |
| --- | --- | --- | --- |
| 1 | `cycle-01-happy.md` | private | completed (A1) |
| 2 | `cycle-02-default.md` | private | fully_liquidated (A2) |
| 3 | `cycle-03-early-repay.md` | private | completed early repay |
| 4 | `cycle-04-mkt-borrow.md` | marketplace | completed |
| 5 | `cycle-05-mkt-counter.md` | marketplace | superseded / completed |
| 6 | `cycle-06-partial-then-cure.md` | private | completed after partial |
| 7 | `cycle-07-link-reuse.md` | private + API | reuse blocked |
| 8 | `cycle-08-terms-mismatch.md` | marketplace | counter-offer path |
| 9 | `cycle-09-stale-oracle.md` | private | fail-closed |
| 10 | `cycle-10-pause-bridge.md` | private | pause + fallback |

## Exit

- [ ] All 10 files exist with **Status: PASS** and real explorer sigs  
- [ ] CPI / authority notes attached (loan authority, vault lock binding)  
- [ ] `security-audits/pass-3/README.md` index updated  

A1 + A2 are cycles 1–2. Remaining 3–10 are **B2**, not required to claim honest testnet A.
