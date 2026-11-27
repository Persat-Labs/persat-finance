// oxlint-disable
/**
 * Calls PersatDealRegistry.setVault() using the Circle SCP deployer wallet.
 * Run once after both contracts are deployed.
 */
import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets'
// poll helper inline — wire script is excluded from tsconfig
async function waitForTx(client: { getTransaction: (a: { id: string }) => Promise<{ data?: { transaction?: { state?: string } } }> }, txId: string) {
  const terminal = new Set(['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED'])
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const r = await client.getTransaction({ id: txId })
    const state = r.data?.transaction?.state
    console.log('    state:', state)
    if (!state) continue
    if (state === 'COMPLETE') return
    if (terminal.has(state)) throw new Error(`Transaction ${state}: ${txId}`)
  }
  throw new Error('Timeout waiting for tx: ' + txId)
}

const apiKey = process.env.CIRCLE_API_KEY!
const entitySecret = process.env.CIRCLE_ENTITY_SECRET!

if (!apiKey || !entitySecret) {
  console.error('Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env')
  process.exit(1)
}

const REGISTRY = '0x2ed7e6d7f293299a4f9083b4c49d6d0b53171e70'
const VAULT    = '0x59241023610c71c56154e5c6d56821a750ff2e76'
const WALLET_ID = '3c2464b2-8369-52e2-a782-800bbeca5396'

const walletsClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })

async function send(contractAddress: string, sig: string, params: string[]) {
  const res = await walletsClient.createContractExecutionTransaction({
    walletId: WALLET_ID,
    contractAddress,
    abiFunctionSignature: sig,
    abiParameters: params,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  })
  const txId = res.data?.id
  if (!txId) throw new Error(`No txId returned for ${sig}`)
  console.log(`  txId: ${txId}`)
  await waitForTx(walletsClient, txId)
  console.log(`  ✓ ${sig} confirmed`)
}

console.log('→ PersatDealRegistry.setVault')
await send(REGISTRY, 'setVault(address)', [VAULT])

// Verify
const { initiateSmartContractPlatformClient } = await import('@circle-fin/smart-contract-platform')
const scpClient = initiateSmartContractPlatformClient({ apiKey, entitySecret })
const q = await scpClient.queryContract({
  address: REGISTRY,
  blockchain: 'ARC-TESTNET',
  abiFunctionSignature: 'vault()',
  abiJson: JSON.stringify([{
    name: 'vault', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }],
  }]),
})
console.log('vault() =', q.data?.outputValues)
console.log('Done! Registry is wired to Vault.')
