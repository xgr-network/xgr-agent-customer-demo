import { Wallet } from 'ethers';

export async function signReadPermit({ privateKey, chainId, ttlSec = 300 }) {
  const wallet = new Wallet(privateKey);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    domain: {
      name: 'XDaLa Control',
      version: '1',
      chainId: Number(chainId),
    },
    primaryType: 'xdalaPermit',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      xdalaPermit: [
        { name: 'from', type: 'address' },
        { name: 'expiry', type: 'uint256' },
      ],
    },
    message: {
      from: wallet.address.toLowerCase(),
      expiry: now + Math.max(1, Number(ttlSec || 300)),
    },
  };

  const { EIP712Domain, ...signTypes } = payload.types;
  const signature = await wallet.signTypedData(payload.domain, signTypes, payload.message);
  return { ...payload, signature };
}
