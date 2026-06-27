import { Wallet } from 'ethers';
import { getCoreAddrs, getNextProcessId, rpcCall } from './rpcClient.js';
import { buildSessionTypedData, signSessionPermit } from './sessionPermit.js';

function getChainId(core) {
  const raw = String(core?.chainId || core?.ChainID || '0x0');
  return raw.startsWith('0x') ? parseInt(raw, 16) : Number(raw);
}

export async function startWaiterSession({ config, agentAddress }) {
  const ownerWallet = new Wallet(config.xdala.ownerPrivateKey);
  const owner = ownerWallet.address.toLowerCase();
  const core = await getCoreAddrs(config.xdala.rpcUrl);
  const chainId = getChainId(core);
  const precompile = String(core?.precompile || core?.Precompile || '').toLowerCase();
  if (!Number.isFinite(chainId) || chainId <= 0) throw new Error('Invalid XDaLa chainId from xgr_getCoreAddrs');
  if (!precompile) throw new Error('Missing precompile from xgr_getCoreAddrs');

  const sessionId = await getNextProcessId(config.xdala.rpcUrl, owner);
  const expiry = Math.floor(Date.now() / 1000) + Math.max(1, Number(config.xdala.permitTtlSec || 1200));
  const typedData = buildSessionTypedData({
    chainId,
    from: owner,
    sessionId,
    ostcHash: config.xdala.ostcHash,
    ostcId: config.xdala.ostcId,
    maxTotalGas: config.xdala.maxTotalGas,
    expiry,
  });
  const permit = await signSessionPermit({ privateKey: config.xdala.ownerPrivateKey, typedData });

  const waiterPayload = {
    RequestId: 'demo-request-001',
    WakeMarker: 'initial',
    __wakeUp: {
      steps: {
        [config.xdala.waitStepId]: {
          rpc: [agentAddress.toLowerCase()],
        },
      },
    },
  };

  const result = await rpcCall(config.xdala.rpcUrl, 'xgr_validateDataTransfer', {
    stepId: config.xdala.startStepId,
    payload: waiterPayload,
    orchestration: config.xdala.orchestrationAddress,
    permit,
  });

  return {
    sessionId,
    owner,
    chainId,
    precompile,
    waiterPayload,
    result,
  };
}
