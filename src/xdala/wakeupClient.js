import { Wallet } from 'ethers';
import { signControlPermitV2 } from './controlPermit.js';
import { rpcCall } from './rpcClient.js';

export function getAgentAddress(privateKey) {
  return new Wallet(privateKey).address.toLowerCase();
}

export async function wakeXdalaSession({ config, waiter, payload }) {
  const agentAddress = getAgentAddress(config.xdala.agentPrivateKey);
  const permit = await signControlPermitV2({
    privateKey: config.xdala.agentPrivateKey,
    chainId: waiter.chainId,
    verifyingContract: waiter.precompile,
    runner: waiter.owner,
    sessionId: waiter.sessionId,
    stepId: config.xdala.waitStepId,
    ttlSec: config.xdala.permitTtlSec,
  });

  const result = await rpcCall(config.xdala.rpcUrl, 'xgr_wakeUpProcess', {
    runner: waiter.owner,
    permit,
    stepId: config.xdala.waitStepId,
    payload,
  });

  return {
    agentAddress,
    sessionId: waiter.sessionId,
    runner: waiter.owner,
    stepId: config.xdala.waitStepId,
    result,
  };
}
