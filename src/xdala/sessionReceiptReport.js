import { decodeReceiptExtrasAll } from './decodeReceipt.js';
import { buildSessionReceiptsUrl, fetchSessionReceipts } from './explorerClient.js';

function parseReceiptValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function pickReceipt(row) {
  return parseReceiptValue(row?.receipt_raw || row?.receipt || row?.rawReceipt || null);
}

function pickTxHash(row, receipt) {
  return String(receipt?.transactionHash || receipt?.txHash || receipt?.hash || row?.txhash || row?.txHash || '').trim();
}

function pickBlockNumber(row, receipt) {
  return receipt?.blockNumber ?? row?.blocknumber ?? row?.blockNumber ?? null;
}

function normalizeStep(row, index) {
  const receipt = pickReceipt(row);
  const decoded = (() => {
    try {
      return decodeReceiptExtrasAll(receipt) || [];
    } catch {
      return [];
    }
  })();
  const meta = decoded.find((item) => item && typeof item === 'object') || {};
  const valid = typeof meta.valid === 'boolean'
    ? meta.valid
    : typeof meta.execResult === 'boolean'
      ? meta.execResult
      : null;
  const txHash = pickTxHash(row, receipt);
  return {
    index,
    iteration: row?.engine_iteration ?? meta.iteration ?? null,
    stepId: row?.engine_step_id || meta.stepId || '',
    valid,
    status: valid === true ? 'valid' : valid === false ? 'invalid' : 'unknown',
    txHash,
    blockNumber: pickBlockNumber(row, receipt),
    orchestrationAddress: meta.orchestrationAddress || '',
    ruleContract: meta.ruleContract || '',
    execContract: meta.execContract || '',
    ostcId: meta.ostcId || '',
    ostcHash: meta.ostcHash || '',
    ruleHash: meta.ruleHash || '',
    innerGasUsed: meta.innerGasUsed || '',
    payload: meta.payload || null,
    apiSaves: meta.apiSaves || null,
    contractSaves: meta.contractSaves || null,
    additionalInformation: meta.additionalInformation || null,
    receipt,
    row,
    explorerTxPath: txHash ? `/tx/${txHash}` : '',
  };
}

function buildSummary({ steps, sessionId, owner, explorerUrl }) {
  const validCount = steps.filter((step) => step.valid === true).length;
  const invalidCount = steps.filter((step) => step.valid === false).length;
  return {
    sessionId: String(sessionId),
    owner: String(owner).toLowerCase(),
    explorerUrl,
    rowCount: steps.length,
    validCount,
    invalidCount,
    unknownCount: Math.max(0, steps.length - validCount - invalidCount),
    txCount: new Set(steps.map((step) => step.txHash).filter(Boolean)).size,
    blockCount: new Set(steps.map((step) => String(step.blockNumber || '')).filter(Boolean)).size,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNumber(value, fallback, { min, max } = {}) {
  const n = Number(value);
  const next = Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.max(min ?? next, Math.min(max ?? next, next));
}

async function fetchReceiptsOnce({ explorerUrl, sessionId, owner, limit }) {
  const response = await fetchSessionReceipts({
    explorerUrl,
    sessionId,
    owner,
    limit,
    includeTx: true,
    includeBlock: true,
  });
  return {
    response,
    rows: Array.isArray(response?.rows) ? response.rows : [],
  };
}

export async function fetchSessionReceiptReport({
  config,
  waiter,
  limit = 10000,
  minRows = 0,
  timeoutMs = 0,
  pollMs = 3000,
} = {}) {
  const sessionId = String(waiter?.sessionId || '').trim();
  const owner = String(waiter?.owner || '').trim().toLowerCase();
  const explorerUrl = String(config?.chain?.explorerUrl || config?.xdala?.explorerUrl || '').trim();
  if (!sessionId) throw new Error('No live waiter session id available. Start the waiter first.');
  if (!owner) throw new Error('No live waiter owner available. Start the waiter first.');
  if (!explorerUrl) throw new Error('Explorer URL is missing in runtime config.');

  const normalizedLimit = normalizeNumber(limit, 10000, { min: 1, max: 50000 });
  const expectedRows = normalizeNumber(minRows, 0, { min: 0, max: normalizedLimit });
  const maxWaitMs = normalizeNumber(timeoutMs, 0, { min: 0, max: 120000 });
  const intervalMs = normalizeNumber(pollMs, 3000, { min: 250, max: 30000 });
  const startedAt = Date.now();
  const apiUrl = buildSessionReceiptsUrl({
    explorerUrl,
    sessionId,
    owner,
    limit: normalizedLimit,
    includeTx: true,
    includeBlock: true,
  });

  let attempts = 0;
  let response = null;
  let rows = [];

  while (true) {
    attempts += 1;
    const current = await fetchReceiptsOnce({
      explorerUrl,
      sessionId,
      owner,
      limit: normalizedLimit,
    });
    response = current.response;
    rows = current.rows;

    if (!expectedRows || rows.length >= expectedRows) break;

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = maxWaitMs - elapsedMs;
    if (maxWaitMs <= 0 || remainingMs <= 0) break;

    await sleep(Math.min(intervalMs, remainingMs));
  }

  const elapsedMs = Date.now() - startedAt;
  const steps = rows.map((row, index) => normalizeStep(row, index + 1));
  const summary = buildSummary({ steps, sessionId, owner, explorerUrl });
  const complete = !expectedRows || steps.length >= expectedRows;
  return {
    ok: true,
    source: 'xgr-explorer',
    apiUrl,
    customerApi: {
      method: 'GET',
      url: apiUrl,
      description: 'Customer-facing Explorer API call for all receipts of one XDaLa session.',
    },
    polling: {
      expectedRows,
      timeoutMs: maxWaitMs,
      pollMs: intervalMs,
      attempts,
      elapsedMs,
      complete,
      timedOut: !complete && maxWaitMs > 0 && elapsedMs >= maxWaitMs,
    },
    summary,
    steps,
    raw: response,
  };
}
