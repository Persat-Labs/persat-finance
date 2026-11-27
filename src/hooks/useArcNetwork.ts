import { useAccount } from 'wagmi'
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  getAddresses,
} from '../contracts/addresses'
import { ARC_RPC_URL } from '../config'

export function useArcNetwork() {
  const { chainId, isConnected, address } = useAccount()

  const isMainnet = chainId === ARC_MAINNET_CHAIN_ID
  const isTestnet = chainId === ARC_TESTNET_CHAIN_ID
  const isSupported = Boolean(chainId && (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId))

  // Default to mainnet — the app is mainnet-first
  const activeChainId = isMainnet ? ARC_MAINNET_CHAIN_ID : ARC_MAINNET_CHAIN_ID
  const addresses = getAddresses(ARC_MAINNET_CHAIN_ID)

  const chain = {
    id: ARC_MAINNET_CHAIN_ID,
    name: 'Arc',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [ARC_RPC_URL] } },
    blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
  }

  // Wrong chain = connected but not on Arc Mainnet
  const isWrongChain = Boolean(isConnected && chainId && chainId !== ARC_MAINNET_CHAIN_ID)

  return {
    chainId: activeChainId,
    connectedChainId: chainId,
    isMainnet: true, // always mainnet
    isTestnet,
    isSupported,
    isWrongChain,
    chain,
    addresses,
    address,
    isConnected,
  }
}
