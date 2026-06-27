import { Wallet } from 'ethers';

export function buildControlPermitV2TypedData({ chainId, verifyingContract, from, runner, sessionId, action = 'wake', stepId = '', expiry }) {
  return {
    domain: {
      name: 'XDaLa Control',
      version: '1',
      chainId: Number(chainId),
      verifyingContract: String(verifyingContract || '').toLowerCase(),
    },
    primaryType: 'ControlPermitV2',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ControlPermitV2: [
        { name: 'from', type: 'address' },
        { name: 'runner', type: 'address' },
        { name: 'sessionId', type: 'uint256' },
        { name: 'action', type: 'string' },
        { name: 'stepId', type: 'string' },
        { name: 'expiry', type: 'uint256' },
      ],
    },
    message: {
      from: String(from || '').toLowerCase(),
      runner: String(runner || '').toLowerCase(),
      sessionId: String(sessionId),
      action: String(action || 'wake').toLowerCase(),
      stepId: String(stepId || ''),
      expiry: Number(expiry),
    },
  };
}

export async function signControlPermitV2({ privateKey, chainId, verifyingContract, runner, sessionId, stepId, ttlSec = 300 }) {
  const wallet = new Wallet(privateKey);
  const now = Math.floor(Date.now() / 1000);
  const typedData = buildControlPermitV2TypedData({
    chainId,
    verifyingContract,
    from: wallet.address,
    runner,
    sessionId,
    action: 'wake',
    stepId,
    expiry: now + Math.max(1, Number(ttlSec || 300)),
  });
  const { EIP712Domain, ...signTypes } = typedData.types;
  const signature = await wallet.signTypedData(typedData.domain, signTypes, typedData.message);
  return {
    domain: typedData.domain,
    primaryType: typedData.primaryType,
    types: typedData.types,
    message: typedData.message,
    signature,
  };
}
