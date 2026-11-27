/**
 * Persat Finance — deployed contract addresses.
 * Mainnet defaults come from addresses.mainnet.json, which scripts/deploy-mainnet.cjs rewrites
 * on every deployment. VITE_ env vars still override them per environment.
 */

import mainnetDeployment from './addresses.mainnet.json'

export const REGISTRY_ADDRESS = (
  import.meta.env.VITE_REGISTRY_ADDRESS ?? '0x2ed7e6d7f293299a4f9083b4c49d6d0b53171e70'
) as `0x${string}`

export const VAULT_ADDRESS = (
  import.meta.env.VITE_VAULT_ADDRESS ?? '0x59241023610c71c56154e5c6d56821a750ff2e76'
) as `0x${string}`

export const ESCROW_VAULT_ADDRESS = VAULT_ADDRESS

export const CIRBTC_ADDRESS = (
  import.meta.env.VITE_CIRBTC_ADDRESS ?? '0x52c0757272713869f2a34827386c301a5c3af744'
) as `0x${string}`

export const PRICE_FEED_ADDRESS = (
  import.meta.env.VITE_PRICE_FEED_ADDRESS ?? '0xa620864091aa03188e33db8ef938dc7e82e4a463'
) as `0x${string}`

export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_TESTNET_CHAIN_ID = 5042002

export const SUPPORTED_CHAIN_IDS = [ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID] as const

/** Chainlink BTC/USD Oracle on Arc Mainnet */
export const ARC_MAINNET_CHAINLINK_FEED = '0xa109B535C70C8Be9995be64Bb6751AcDB27e03De' as `0x${string}`

/** Native USDC ERC-20 on Arc */
export const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as `0x${string}`

/** Official cirBTC on Arc Mainnet (Circle). */
export const OFFICIAL_CIRBTC_ADDRESS = '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0' as `0x${string}`

/** Arc Mainnet deployment (Chain ID 5042) */
export const MAINNET_REGISTRY_ADDRESS = mainnetDeployment.registry as `0x${string}`
export const MAINNET_VAULT_ADDRESS = mainnetDeployment.vault as `0x${string}`
export const MAINNET_CIRBTC_ADDRESS = mainnetDeployment.cirBtc as `0x${string}`


/** True when the collateral in use is Circle's official cirBTC (false for the old mock deployment). */
export function usesOfficialCirBtc(): boolean {
  return getAddresses(ARC_MAINNET_CHAIN_ID).cirBtc.toLowerCase() === OFFICIAL_CIRBTC_ADDRESS.toLowerCase()
}

export function getAddresses(chainId?: number) {
  const isMainnet = chainId === ARC_MAINNET_CHAIN_ID

  return {
    registry: (
      (isMainnet ? import.meta.env.VITE_MAINNET_REGISTRY_ADDRESS : import.meta.env.VITE_REGISTRY_ADDRESS) ??
      (isMainnet ? MAINNET_REGISTRY_ADDRESS : '0x2ed7e6d7f293299a4f9083b4c49d6d0b53171e70')
    ) as `0x${string}`,
    vault: (
      (isMainnet ? import.meta.env.VITE_MAINNET_VAULT_ADDRESS : import.meta.env.VITE_VAULT_ADDRESS) ??
      (isMainnet ? MAINNET_VAULT_ADDRESS : '0x59241023610c71c56154e5c6d56821a750ff2e76')
    ) as `0x${string}`,
    cirBtc: (
      (isMainnet ? import.meta.env.VITE_MAINNET_CIRBTC_ADDRESS : import.meta.env.VITE_CIRBTC_ADDRESS) ??
      (isMainnet ? MAINNET_CIRBTC_ADDRESS : '0x52c0757272713869f2a34827386c301a5c3af744')
    ) as `0x${string}`,
    priceFeed: (
      isMainnet
        ? (import.meta.env.VITE_MAINNET_PRICE_FEED_ADDRESS ?? ARC_MAINNET_CHAINLINK_FEED)
        : (import.meta.env.VITE_PRICE_FEED_ADDRESS ?? '0xa620864091aa03188e33db8ef938dc7e82e4a463')
    ) as `0x${string}`,
    usdc: ARC_USDC_ADDRESS,
  }
}
