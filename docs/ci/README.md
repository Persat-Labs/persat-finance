# CI workflow changes requiring founder action

The Arena agent's GitHub App token does not carry the `workflows` permission.
GitHub blocks any push — including via the REST API — that creates or modifies a
file under `.github/workflows/`, with:

```
refusing to allow a GitHub App to create or update workflow
`.github/workflows/protocol.yml` without `workflows` permission
```

This directory holds proposed workflow content that a human with write access
can apply. Nothing here runs on its own; these are inert `.proposed` files.

> **Status: pending founder application.** The build-before-test fix and
> `PERSAT_REQUIRE_PROGRAMS=1` are applied and working (verified green,
> run 32602659432 and all subsequent runs). A third revision — coverage
> measurement — is new and not yet applied. See *Pending* below.

## Pending: measured Pass 1 coverage

The 95% unit-test coverage target in `docs/testing-strategy.md` is currently
*stated but not measured*. [`protocol.yml.coverage.proposed`](protocol.yml.coverage.proposed)
adds a `coverage` job that runs `cargo llvm-cov` over the whole workspace,
uploads the full report as an artifact, and fails the build below the
enforcement floor (transitionally 90 for the two programs whose instruction
bodies had no executable tests before the LiteSVM harness; tighten to 95 once
the true measured numbers are recorded in `security-audits/pass-1/README.md`).

To apply: copy the file's contents from the `name: Verify Solana protocol` line
onward over `.github/workflows/protocol.yml` — or use Option A below to grant
the permission permanently.

## Previously applied: build before test

`cargo test` currently runs *before* `anchor build`. The LiteSVM integration
tests load `target/deploy/governance.so` and skip when it is absent, so they
report `7 passed` in `0.00s` having executed nothing. That is worse than no
test, because it looks green.

[`protocol.yml.ready`](protocol.yml.ready) now swaps the two steps and sets
`PERSAT_REQUIRE_PROGRAMS=1`, which turns a missing program into a hard failure
rather than a silent skip. Re-apply it with the same paste procedure below.

## Changes already applied

[`protocol.yml.proposed`](protocol.yml.proposed) — replaces
`.github/workflows/protocol.yml`.

| Change | Why it matters |
| --- | --- |
| Anchor CLI `1.0.0` → `1.0.2` | Lets the oracle use the official `pyth-solana-receiver-sdk` instead of the hand-rolled `PriceUpdateV2` decoder in `contracts/programs/price_oracle/src/pyth.rs`. |
| Push trigger → `main` and `arena/**` | Currently pinned to an already-merged branch, so the protocol job only runs on pull requests and would stop entirely after the next merge. |
| Explicit `cargo test --workspace` step | Unit and fuzz failures show as their own red step instead of being buried inside `anchor test`. |

## How to apply

Either option is fine; the second requires no local checkout.

### Option A — grant the permission, then let the agent apply it

Best if you expect more CI work, since it removes the blocker permanently.

1. Go to **Settings → GitHub Apps** in the `Persat-Labs` organisation
   (or <https://github.com/settings/installations> for a personal account).
2. Find the **Arena** app and open **Configure**.
3. Under **Permissions**, set **Workflows** to **Read and write**.
4. Approve the permission-change request GitHub raises.
5. Tell the agent, and it will apply the file and confirm CI is green.

This grants the ability to edit files in `.github/workflows/` only. It does not
grant access to secrets, deployment environments, or any signing key.

### Option B — apply it yourself, no permission change

```bash
git checkout arena/01a01a09-persat-finance
git pull
cp docs/ci/protocol.yml.proposed .github/workflows/protocol.yml

# Strip the explanatory header (everything above the `name:` line).
sed -i '' '1,/^name: Verify Solana protocol$/{/^name: Verify Solana protocol$/!d;}' .github/workflows/protocol.yml   # macOS
# sed -i '1,/^name: Verify Solana protocol$/{/^name: Verify Solana protocol$/!d;}' .github/workflows/protocol.yml   # Linux

git add .github/workflows/protocol.yml
git commit -m "ci: bump Anchor to 1.0.2 and fix protocol push trigger"
git push
```

Or edit `.github/workflows/protocol.yml` directly in the GitHub web UI and paste
the contents below the header comment.

## After applying

Once the Anchor bump lands, `contracts/programs/price_oracle/src/pyth.rs` should
be replaced with the upstream SDK:

```toml
# contracts/Cargo.toml
anchor-lang = "=1.0.2"
anchor-spl = "=1.0.2"
pyth-solana-receiver-sdk = "=2.0.0"
```

The module documents this at the top of the file. Ask the agent to do the
swap — it is a contained change, and the oracle's own tests cover the behaviour
either way.

## Paste-ready file

[`protocol.yml.ready`](protocol.yml.ready) is the same content with the
explanatory header already removed. Copy it verbatim into
`.github/workflows/protocol.yml` — no editing or stripping required.
