// oxlint-disable
// Standalone read-only viem clients for Arc Testnet and Mainnet.
// These never depend on a connected wallet or wagmi state —
// they always point at the correct RPC regardless of what chain the user's wallet is on.
// Use these for ALL contract reads and event scans.

import { createPublicClient, http, defineChain } from 'viem'
import { ARC_RPC_URL } from '../config'

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
})

const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

export const arcTestnetClient = createPublicClient({
  chain: arcTestnet,
  transport: http('https://rpc.testnet.arc.io', {
    timeout: 30_000,
    retryCount: 3,
    retryDelay: 1_000,
    batch: { batchSize: 1, wait: 0 },
  }),
  batch: { multicall: false },
})

export const arcMainnetClient = createPublicClient({
  chain: arcMainnet,
  transport: http(ARC_RPC_URL, {
    timeout: 30_000,
    retryCount: 3,
    retryDelay: 1_000,
    batch: { batchSize: 1, wait: 0 },
  }),
  batch: { multicall: false },
})

// Always returns mainnet client — app is mainnet-only
export function getArcClient(_isMainnet?: boolean) {
  return arcMainnetClient
}
