# Pass-3 cycle evidence

Drop one markdown file per completed live cycle, e.g. `cycle-01-happy.md`.

Each file must include:

- Date (ISO)
- Cluster (`devnet` until cutover)
- Roles (borrower / lender / operator pubkeys — public only)
- Ordered steps with **transaction signature** + explorer URL (`?cluster=devnet`)
- Final on-chain account states (deal, vault, loan) or explorer account links
- Pass / fail and notes

Template:

```markdown
# Cycle NN — <happy|default|edge>

- Date:
- Cluster: devnet
- Borrower:
- Lender:
- Operator:

## Steps

| # | Instruction | Signature | Explorer |
| --- | --- | --- | --- |
| 1 | propose_deal | | https://explorer.solana.com/tx/<sig>?cluster=devnet |

## Result

- Final deal state:
- Notes:
```

Do not check boxes in `docs/MAINNET_CUTOVER_3_STEP.md` until a file here exists.
