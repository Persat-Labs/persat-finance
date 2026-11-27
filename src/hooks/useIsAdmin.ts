import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { getArcClient } from '../lib/arcClient'
import { REGISTRY_ABI, VAULT_ABI } from '../contracts/abis'
import { getAddresses, ARC_MAINNET_CHAIN_ID } from '../contracts/addresses'
import { describeOwner } from '../lib/safe'

const ZERO = '0x0000000000000000000000000000000000000000'
const PENDING_OWNER_ABI = [
  { name: 'pendingOwner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const

async function fetchAdminWallets(): Promise<string[]> {
  const client = getArcClient()
  const { registry, vault } = getAddresses(ARC_MAINNET_CHAIN_ID)
  const read = (address: `0x${string}`, abi: any, functionName: string) =>
    client.readContract({ address, abi, functionName } as any) as Promise<`0x${string}`>
  const holders = await Promise.all([
    read(registry, REGISTRY_ABI, 'owner'),
    read(registry, PENDING_OWNER_ABI, 'pendingOwner'),
    read(vault, VAULT_ABI, 'owner'),
    read(vault, PENDING_OWNER_ABI, 'pendingOwner'),
  ])
  const unique = [...new Set(holders.filter((a) => a && a !== ZERO).map((a) => a.toLowerCase()))]
  const infos = await Promise.all(unique.map((a) => describeOwner(client, a as `0x${string}`)))
  const wallets = new Set<string>()
  for (const info of infos) {
    if (info.kind === 'eoa') wallets.add(info.address.toLowerCase())
    if (info.kind === 'safe') info.owners.forEach((o) => wallets.add(o.toLowerCase()))
  }
  return [...wallets]
}

// UX gate only: the contracts enforce onlyOwner on every admin action.
export function useIsAdmin() {
  const { address, isConnected } = useAccount()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-wallets'],
    queryFn: fetchAdminWallets,
    enabled: isConnected,
    staleTime: 60_000,
  })
  const isAdmin = !!address && !!data && data.includes(address.toLowerCase())
  return { isAdmin, isChecking: isConnected && isLoading }
}
