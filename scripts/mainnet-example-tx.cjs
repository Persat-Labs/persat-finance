const fs = require('fs');
const path = require('path');
const { createWalletClient, createPublicClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { arc } = require('viem/chains');

function loadEnv() {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const addresses = JSON.parse(fs.readFileSync('src/contracts/addresses.mainnet.json', 'utf8'));
const registryJson = JSON.parse(fs.readFileSync('contracts/out/PersatDealRegistry.sol/PersatDealRegistry.json', 'utf8'));

async function main() {
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  const formattedKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
  const account = privateKeyToAccount(formattedKey);

  const publicClient = createPublicClient({ chain: arc, transport: http() });
  const walletClient = createWalletClient({ account, chain: arc, transport: http() });

  const crypto = require('crypto');
  const dealId = `0x${crypto.randomBytes(16).toString('hex')}`;

  console.log('Executing Arc Mainnet Deal Proposal...');
  console.log('Deal ID:', dealId);
  console.log('Proposer (Deployer):', account.address);
  console.log('Registry Contract:', addresses.registry);

  const txHash = await walletClient.writeContract({
    address: addresses.registry,
    abi: registryJson.abi,
    functionName: 'proposeDeal',
    args: [
      dealId,
      true,
      '0x0000000000000000000000000000000000000000',
      5_000_000n,
      100_000n,
      800n,
      6,
      1,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    ],
  });

  console.log('\nTransaction sent! Hash:', txHash);
  console.log('Waiting for confirmation on Arc Mainnet...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log('Transaction confirmed in block:', receipt.blockNumber);
  console.log(`Explorer Link: https://explorer.arc.io/tx/${txHash}`);

  const proof = {
    ...addresses,
    exampleTx: {
      type: 'proposeDeal',
      dealId,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      explorerUrl: `https://explorer.arc.io/tx/${txHash}`,
      timestamp: new Date().toISOString(),
    },
  };

  fs.writeFileSync('src/contracts/mainnet-proof.json', JSON.stringify(proof, null, 2), 'utf8');
  console.log('\nProof saved to src/contracts/mainnet-proof.json');
}

main().catch(err => {
  console.error('Execution failed:', err);
  process.exit(1);
});
