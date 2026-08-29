# Persat Finance — go-live and scale runbook

## Security gate before any testnet deployment

Configure the following only in a secure secret manager or deployment environment. Never commit private keys, tokens, or passwords to this repository.

| Configuration | Required for | Owner action |
| --- | --- | --- |
| Solana deployer keypair | Program deployment | Create and fund a deployer wallet for the selected test cluster. |
| Three governance signer keypairs | 2-of-3 governance and 1-of-3 emergency pause | Create independent signer wallets; publish only their public keys in protocol configuration. |
| Keeper bot keypair | Default and liquidation transactions | Fund only for transaction fees; it must never custody user funds. |
| Oracle pusher keypair | BTC/USD price updates | Fund only for transaction fees. |
| RPC provider key | Reliable RPC, indexing, and monitoring | Provision Helius, QuickNode, or Triton access. |
| Zeus / Threshold credentials | Embedded bridge integration, only if required | Confirm current SDK, test cluster, mint/program IDs, and partner requirements. |
| SendGrid key | Optional notices | Omit to use console-log notification fallback. |
| Admin API key | Backend administrative API protection | Generate in a password manager or secret manager. |
| Domain and deployment tokens | Hosted frontend/backend | Configure in the hosting provider, not in source control. |

Populate the corresponding blank names in `.env.example` only through environment configuration. Do not add real values to that file.

## Pre-launch gates

1. All eight programs deployed in the mandated order and verified in Solana Explorer.
2. All four security audit passes completed with reports stored under `security-audits/pass-[n]/`.
3. Bridge partner integration, health checks, manual fallback, and fail-closed price behavior verified on the selected public test cluster.
4. Load testing, monitoring, alerting, incident response, and a launch-day rollback plan completed before any public promotion.

## Testnet → mainnet cutover checklist

Authoritative phased checklist (Definitions of **A** honest testnet, **B** audit-grade testnet, **C** three-step mainnet cutover):

→ **[`docs/MAINNET_CUTOVER_3_STEP.md`](docs/MAINNET_CUTOVER_3_STEP.md)**

Do not run mainnet program deploy or real-funds marketing until that document’s **B exit** and Pass-4 gate are satisfied. Devnet stand-in mints and deferred bridge keys are expected until then.
