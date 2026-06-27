export const XGR_CHAINS = [
  {
    id: 'xgr-mainnet',
    label: 'XGR Mainnet',
    chainIdHex: '0x66B',
    chainIdDec: '1643',
    rpcUrl: 'https://rpc.xgr.network',
    explorerUrl: 'https://explorer.xgr.network',
    compileEndpoint: 'https://deploy.xgr.network/compile',
    walletConfig: {
      chainId: '0x66B',
      chainName: 'XGR Mainnet',
      rpcUrls: ['https://rpc.xgr.network'],
      nativeCurrency: { name: 'XGR', symbol: 'XGR', decimals: 18 },
      blockExplorerUrls: ['https://explorer.xgr.network'],
    },
  },
  {
    id: 'xgr-testnet',
    label: 'XGR Testnet',
    chainIdHex: '0x757',
    chainIdDec: '1879',
    rpcUrl: 'https://rpc1.testnet.xgr.network',
    explorerUrl: 'https://explorer.testnet.xgr.network',
    compileEndpoint: 'https://deploy.testnet.xgr.network/compile',
    walletConfig: {
      chainId: '0x757',
      chainName: 'XGR Testnet',
      rpcUrls: ['https://rpc1.testnet.xgr.network'],
      nativeCurrency: { name: 'XGR', symbol: 'XGR', decimals: 18 },
      blockExplorerUrls: ['https://explorer.testnet.xgr.network'],
    },
  },
];

export function findXgrChain(chainId) {
  const key = String(chainId || '').trim().toLowerCase();
  return XGR_CHAINS.find((chain) => (
    chain.id.toLowerCase() === key
    || chain.chainIdHex.toLowerCase() === key
    || chain.chainIdDec === key
    || chain.label.toLowerCase() === key
  )) || XGR_CHAINS[1];
}
