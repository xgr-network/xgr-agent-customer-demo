import { Interface, getAddress, getBytes, id, toUtf8String } from 'ethers';

export const ENGINE_PRECOMPILE_ADDRESS = '0x00000000000000000000000000000000000000e1';

const ENGINE_META_SIGNATURE = 'EngineMeta(uint256,uint64,address,string,bytes32,string,address,bytes32,address,bool,bytes,bytes,bytes)';
const ENGINE_EXTRAS_SIGNATURE = 'EngineExtrasV2(uint256,bytes)';
const ENGINE_META_TOPIC = id(ENGINE_META_SIGNATURE).toLowerCase();
const ENGINE_EXTRAS_TOPIC = id(ENGINE_EXTRAS_SIGNATURE).toLowerCase();

const engineInterface = new Interface([
  'event EngineMeta(uint256 sessionId, uint64 iteration, address orchestration, string ostcId, bytes32 ostcHash, string stepId, address ruleContract, bytes32 ruleHash, address execContract, bool execResult, bytes payload, bytes apiSaves, bytes contractSaves)',
  'event EngineExtrasV2(uint256 gasUsed, bytes extras)',
]);

function parseJsonBytes(hexLike) {
  try {
    if (!hexLike) return null;
    const bytes = getBytes(hexLike);
    if (!bytes.length) return null;
    const text = toUtf8String(bytes).trim();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return Boolean(value);
}

function isEngineLog(log) {
  try {
    return getAddress(log?.address || '') === getAddress(ENGINE_PRECOMPILE_ADDRESS);
  } catch {
    return false;
  }
}

export function decodeReceiptExtrasAll(receipt) {
  if (!receipt || !Array.isArray(receipt.logs)) return [];

  const engineLogs = receipt.logs.filter(isEngineLog);
  let metaLog = null;
  let extrasLog = null;

  for (const log of engineLogs) {
    const topic0 = Array.isArray(log?.topics) ? String(log.topics[0] || '').toLowerCase() : '';
    if (!metaLog && topic0 === ENGINE_META_TOPIC) metaLog = log;
    if (!extrasLog && topic0 === ENGINE_EXTRAS_TOPIC) extrasLog = log;
    if (metaLog && extrasLog) break;
  }

  if (!metaLog) return [];

  const parsedMeta = engineInterface.parseLog({ topics: metaLog.topics, data: metaLog.data });
  const output = {
    sessionId: parsedMeta.args.sessionId?.toString?.() || String(parsedMeta.args.sessionId || ''),
    iteration: parsedMeta.args.iteration != null ? Number(parsedMeta.args.iteration) : null,
    orchestrationAddress: getAddress(parsedMeta.args.orchestration),
    ostcId: parsedMeta.args.ostcId,
    ostcHash: parsedMeta.args.ostcHash,
    stepId: parsedMeta.args.stepId,
    ruleContract: getAddress(parsedMeta.args.ruleContract),
    ruleHash: parsedMeta.args.ruleHash,
    execContract: getAddress(parsedMeta.args.execContract),
    execResult: Boolean(parsedMeta.args.execResult),
    payload: parseJsonBytes(parsedMeta.args.payload),
    apiSaves: parseJsonBytes(parsedMeta.args.apiSaves),
    contractSaves: parseJsonBytes(parsedMeta.args.contractSaves),
  };

  if (extrasLog) {
    const parsedExtras = engineInterface.parseLog({ topics: extrasLog.topics, data: extrasLog.data });
    output.innerGasUsed = parsedExtras.args.gasUsed?.toString?.() || String(parsedExtras.args.gasUsed || '');
    const extras = parseJsonBytes(parsedExtras.args.extras);
    if (extras && typeof extras === 'object') {
      if ('valid' in extras) output.valid = parseBoolean(extras.valid);
      if ('from' in extras) output.fromOverride = extras.from || null;
      const { valid, from, ...additionalInformation } = extras;
      if (Object.keys(additionalInformation).length > 0) {
        output.additionalInformation = additionalInformation;
      }
    }
  }

  return [output];
}
