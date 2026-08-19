# Persat Solana programs

This directory will become the Anchor workspace for the eight programs defined in the authoritative Technical Architecture document:

1. Deal Registry
2. Asset Whitelist Registry
3. Escrow Vault
4. Price Oracle
5. Loan Lifecycle / Payment
6. Liquidation Engine
7. Fee & Treasury
8. Governance

## Current status

No program source or deployment artifact is present yet. The local build environment currently lacks Rust, Solana CLI, and Anchor; the automated Rust download is failing at the environment TLS/network layer. Do not treat this as a protocol implementation.

When the toolchain is available, program work begins with the Deal Registry and Asset Whitelist Registry plus unit tests before any deployer key or testnet deployment is used.
