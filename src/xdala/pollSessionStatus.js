import { rpcCall } from './rpcClient.js';
import { signReadPermit } from './readPermit.js';

export async function listSessionRows({ config, waiter }) {
  const permit = await signReadPermit({
    privateKey: config.xdala.ownerPrivateKey,
    chainId: waiter.chainId,
    ttlSec: config.xdala.permitTtlSec,
  });
  const result = await rpcCall(config.xdala.rpcUrl, 'xgr_listSessions', {
    rootId: String(waiter.sessionId),
    last: 99999,
    permit,
  });
  return Array.isArray(result?.sessions) ? result.sessions : [];
}

export async function waitForStepStatus({ config, waiter, stepId, status = 'waiting', timeoutMs = 60000, pollMs = 2000 }) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const rows = await listSessionRows({ config, waiter });
    const hit = rows.find((row) => {
      const rowStep = String(row.step || row.stepId || row.Step || '');
      const rowStatus = String(row.status || row.Status || '').toLowerCase();
      return rowStep === stepId && rowStatus === status.toLowerCase();
    });
    if (hit) return { ok: true, rows, hit };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Session ${waiter.sessionId} did not reach ${status} at step ${stepId}`);
}
