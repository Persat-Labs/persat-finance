// oxlint-disable
// Persat Finance runs on Arc Mainnet (Chain ID 5042) exclusively.
export async function addArcNetwork(_type?: "testnet" | "mainnet") {
  const provider =
    typeof window !== "undefined"
      ? ((window as any).okxwallet ||
         (window as any).ethereum ||
         (window as any).web3?.currentProvider)
      : null;

  if (!provider) {
    alert("No Web3 wallet detected. Please install MetaMask or OKX wallet.");
    return false;
  }

  const chainIdHex = "0x13B2"; // 5042 = Arc Mainnet
  const addParams = [{
    chainId: chainIdHex,
    chainName: "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.arc.io"],
    blockExplorerUrls: ["https://explorer.arc.io"],
  }];

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    window.location.reload();
    return true;
  } catch (switchError: any) {
    if (switchError.code === 4902 ||
        switchError.code === -32603 ||
        switchError?.message?.toLowerCase().includes("unrecognized") ||
        switchError?.message?.toLowerCase().includes("not found") ||
        switchError?.message?.toLowerCase().includes("not exist")) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: addParams,
        });
        window.location.reload();
        return true;
      } catch (addError) {
        console.error("Failed to add Arc Mainnet:", addError);
        alert("Could not add Arc automatically.\nAdd it manually:\nNetwork: Arc\nRPC: https://rpc.mainnet.arc.io\nChain ID: 5042\nSymbol: USDC\nExplorer: https://explorer.arc.io");
        return false;
      }
    }
    console.error("Failed to switch to Arc Mainnet:", switchError);
    return false;
  }
}
