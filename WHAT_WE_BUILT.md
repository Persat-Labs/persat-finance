# What we built

This document records verified implementation, not planned capability.

## Product frontend

The `frontend/` workspace is a Next.js 14 + TypeScript + Tailwind application using a reusable visual system extracted from the existing waitlist:

- Dark/black background and navy `#0F1A24` surfaces
- Amber `#FFAB00`, gold `#FFD54F`, and orange `#FF6D00` accents
- Plus Jakarta Sans-style display hierarchy, Geist-style body copy, and JetBrains Mono-style data labels through matching fallback stacks
- Amber-edge buttons, panel cards, form inputs, modal component, compact technical labels, and reveal motion

Implemented route foundations:

- `/`
- `/deal/new`
- `/deal/[id]/confirm`
- `/deal/claim/[token]`
- `/deal/[id]/fund`
- `/deal/[id]/manage`
- `/deal/[id]/repay`
- `/marketplace`
- `/marketplace/new`
- `/marketplace/my-listings`
- `/admin`

The interface currently presents safe disabled states for actions that require deployed programs, fresh oracle data, or secure service configuration.

## Backend foundation

The `backend/` workspace provides Fastify health diagnostics, a fail-closed bridge-health response, structured marketplace-term validation, a PostgreSQL migration, and a Solana wallet-signature challenge/verification foundation.

The database migration deliberately has no free-text marketplace column. Raw deal-link/session tokens are not persisted; only hashes are designed for storage.

## Not yet built or deployed

No Anchor program has been compiled or deployed. No bridge widget, keeper, price pusher, marketplace indexer, notification service, persistent API deployment, or testnet transaction is claimed as complete. Those items remain blocked by toolchain availability, secure configuration, and/or mandatory audit work.
