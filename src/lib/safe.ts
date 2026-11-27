// Minimal Safe (v1.3 / v1.4.1) support for the admin page, using only the Safe contracts on Arc.
// Owners approve a transaction on-chain with approveHash; once the threshold is reached, any owner
// executes it with "pre-validated" signatures. No Safe web app or transaction service is needed.

import { concat, pad, type PublicClient } from 'viem'

const ZERO = '0x0000000000000000000000000000000000000000' as const

export const SAFE_ABI = [
  { name: 'getOwners', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address[]' }] },
  { name: 'getThreshold', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'nonce', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    name: 'approvedHashes', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'hash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getTransactionHash', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' }, { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' }, { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' },
      { name: '_nonce', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  { name: 'approveHash', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'hashToApprove', type: 'bytes32' }], outputs: [] },
  {
    name: 'execTransaction', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' }, { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' }, { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const

export type OwnerInfo =
  | { kind: 'eoa'; address: `0x${string}` }
  | { kind: 'safe'; address: `0x${string}`; owners: `0x${string}`[]; threshold: number; nonce: bigint }
  | { kind: 'contract'; address: `0x${string}` }

export async function describeOwner(client: PublicClient, address: `0x${string}`): Promise<OwnerInfo> {
  const code = await client.getCode({ address })
  // EIP-7702 delegated accounts (0xef0100 + 20-byte address) are still wallets controlled by one key.
  if (!code || code === '0x' || (code.toLowerCase().startsWith('0xef0100') && code.length === 48)) return { kind: 'eoa', address }
  try {
    const [owners, threshold, nonce] = await Promise.all([
      client.readContract({ address, abi: SAFE_ABI, functionName: 'getOwners' }),
      client.readContract({ address, abi: SAFE_ABI, functionName: 'getThreshold' }),
      client.readContract({ address, abi: SAFE_ABI, functionName: 'nonce' }),
    ])
    return { kind: 'safe', address, owners: [...owners], threshold: Number(threshold), nonce }
  } catch {
    return { kind: 'contract', address }
  }
}

export function safeTxArgs(to: `0x${string}`, data: `0x${string}`) {
  return [to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO] as const
}

export async function safeTxHash(client: PublicClient, safe: `0x${string}`, to: `0x${string}`, data: `0x${string}`, nonce: bigint) {
  return client.readContract({
    address: safe,
    abi: SAFE_ABI,
    functionName: 'getTransactionHash',
    args: [...safeTxArgs(to, data), nonce],
  })
}

export async function approvalsFor(client: PublicClient, safe: `0x${string}`, owners: `0x${string}`[], hash: `0x${string}`) {
  const flags = await Promise.all(
    owners.map((o) => client.readContract({ address: safe, abi: SAFE_ABI, functionName: 'approvedHashes', args: [o, hash] })),
  )
  return owners.filter((_, i) => flags[i] !== 0n)
}

/** Pre-validated signatures (v = 1) for every approving owner, sorted by address as the Safe requires. */
export function prevalidatedSignatures(approvers: `0x${string}`[]): `0x${string}` {
  const unique = [...new Set(approvers.map((a) => a.toLowerCase()))] as `0x${string}`[]
  unique.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
  return concat(unique.map((o) => concat([pad(o, { size: 32 }), pad('0x', { size: 32 }), '0x01'])))
}
