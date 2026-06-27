import { Wallet } from 'ethers';

export function buildSessionTypedData({ chainId, from, sessionId, ostcHash, ostcId, maxTotalGas = 0, expiry }) {
  return {
    domain: {
      name: 'XDaLa SessionPermit',
      version: '1',
      chainId: Number(chainId),
    },
    primaryType: 'SessionPermit',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      SessionPermit: [
        { name: 'from', type: 'address' },
        { name: 'ostcId', type: 'string' },
        { name: 'ostcHash', type: 'string' },
        { name: 'sessionId', type: 'uint256' },
        { name: 'maxTotalGas', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
      ],
    },
    message: {
      from: String(from || '').toLowerCase(),
      ostcId: String(ostcId || ''),
      ostcHash: String(ostcHash || ''),
      sessionId: String(sessionId),
      maxTotalGas: Number.isFinite(Number(maxTotalGas)) ? Number(maxTotalGas) : 0,
      expiry: Number(expiry),
    },
  };
}

export async function signSessionPermit({ privateKey, typedData }) {
  const wallet = new Wallet(privateKey);
  const { EIP712Domain, ...signTypes } = typedData.types;
  const signature = await wallet.signTypedData(typedData.domain, signTypes, typedData.message);
  return {
    OstcHash: typedData.message.ostcHash,
    Expiry: typedData.message.expiry,
    Signature: signature,
    Owner: wallet.address.toLowerCase(),
    PrimaryType: 'SessionPermit',
    Domain: typedData.domain,
    Types: typedData.types,
    Message: typedData.message,
  };
}
