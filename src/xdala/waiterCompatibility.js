import { Contract, JsonRpcProvider } from 'ethers';
import { calculateOstcHashFromJsonText, fetchOstcJsonFromChain } from './ostcHash.js';
import { buildExpectedWaitPayload, buildWaitValidationRules } from './waiterBundleBuilder.js';

const GET_RULE_ABI = [
  {
    inputs: [],
    name: 'getRule',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function parseContractJson(raw, label) {
  const text = String(raw || '').trim();
  if (!text) throw new Error(`${label} is empty.`);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const core = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  return JSON.parse(core);
}

function normalizeRuleAddress(ruleRef) {
  const value = String(ruleRef || '').trim();
  if (ADDRESS_RE.test(value)) return value.toLowerCase();
  const parts = value.split(':');
  const last = parts[parts.length - 1] || '';
  return ADDRESS_RE.test(last) ? last.toLowerCase() : '';
}

function normalizePayloadType(definition) {
  return String(definition?.type || '').trim().toLowerCase();
}

function getWaitStep(ostc, waitStepId) {
  const stepId = String(waitStepId || '').trim();
  if (!stepId) throw new Error('Wait step is required.');
  const step = ostc?.structure?.[stepId];
  if (!step) throw new Error(`Wait step "${stepId}" was not found in deployed XRC-729 OSTC JSON.`);
  return step;
}

async function fetchXrc137RuleJson({ rpcUrl, ruleAddress }) {
  const provider = new JsonRpcProvider(rpcUrl);
  const contract = new Contract(ruleAddress, GET_RULE_ABI, provider);
  const raw = await contract.getRule();
  return parseContractJson(raw, 'XRC-137 getRule() result');
}

function normalizeRuleExpression(rule) {
  return String(rule || '').replace(/\s+/g, ' ').trim();
}

function compareRules(expectedRules, actualRules) {
  const expected = Array.from(new Set((Array.isArray(expectedRules) ? expectedRules : []).map(normalizeRuleExpression).filter(Boolean)));
  const actual = Array.from(new Set((Array.isArray(actualRules) ? actualRules : []).map(normalizeRuleExpression).filter(Boolean)));
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((rule) => !actualSet.has(rule));
  const extra = actual.filter((rule) => !expectedSet.has(rule));
  return { expected, actual, missing, extra };
}

function comparePayloads(expectedPayload, actualPayload) {
  const expected = expectedPayload && typeof expectedPayload === 'object' ? expectedPayload : {};
  const actual = actualPayload && typeof actualPayload === 'object' ? actualPayload : {};
  const missing = [];
  const mismatched = [];

  for (const [key, expectedDef] of Object.entries(expected)) {
    const actualDef = actual[key];
    if (!actualDef) {
      missing.push({ key, expectedType: normalizePayloadType(expectedDef) });
      continue;
    }
    const expectedType = normalizePayloadType(expectedDef);
    const actualType = normalizePayloadType(actualDef);
    if (expectedType && actualType && expectedType !== actualType) {
      mismatched.push({ key, expectedType, actualType });
    }
  }

  const extra = Object.keys(actual)
    .filter((key) => !Object.prototype.hasOwnProperty.call(expected, key))
    .map((key) => ({ key, actualType: normalizePayloadType(actual[key]) }));

  return { missing, mismatched, extra };
}

export async function checkWaiterSchemaCompatibility({
  rpcUrl,
  orchestrationAddress,
  ostcId,
  waitStepId,
  schemaText,
  ostcHash,
}) {
  const rpc = String(rpcUrl || '').trim();
  const address = String(orchestrationAddress || '').trim().toLowerCase();
  const id = String(ostcId || '').trim();
  if (!rpc) throw new Error('RPC URL is required.');
  if (!ADDRESS_RE.test(address)) throw new Error('XRC-729 address is invalid.');
  if (!id) throw new Error('OSTC ID is required.');

  const ostcRaw = await fetchOstcJsonFromChain({ rpcUrl: rpc, orchestrationAddress: address, ostcId: id });
  const calculatedOstcHash = calculateOstcHashFromJsonText(ostcRaw);
  const providedOstcHash = String(ostcHash || '').trim().toLowerCase();
  const ostcHashMatches = /^0x[0-9a-f]{64}$/i.test(providedOstcHash) && providedOstcHash === calculatedOstcHash.toLowerCase();
  const ostc = parseContractJson(ostcRaw, 'XRC-729 getOSTC() result');
  const waitStep = getWaitStep(ostc, waitStepId);
  const ruleAddress = normalizeRuleAddress(waitStep?.rule);
  if (!ruleAddress) {
    throw new Error(`Wait step "${waitStepId}" does not contain a deployed XRC-137 rule address. Deploy the configured bundle first.`);
  }

  const rule = await fetchXrc137RuleJson({ rpcUrl: rpc, ruleAddress });
  const expectedPayload = buildExpectedWaitPayload(schemaText);
  const expectedRules = [
    '[DocumentHash] != ""',
    '[HashAlgorithm] == "sha256"',
    ...buildWaitValidationRules(schemaText),
  ];
  const actualPayload = rule?.payload && typeof rule.payload === 'object' ? rule.payload : {};
  const actualRules = Array.isArray(rule?.rules) ? rule.rules : [];
  const comparison = comparePayloads(expectedPayload, actualPayload);
  const ruleComparison = compareRules(expectedRules, actualRules);
  const ok = ostcHashMatches
    && comparison.missing.length === 0
    && comparison.mismatched.length === 0
    && comparison.extra.length === 0
    && ruleComparison.missing.length === 0
    && ruleComparison.extra.length === 0;

  return {
    ok,
    status: ok ? 'compatible' : 'schema_mismatch',
    waitStepId,
    ruleAddress,
    expectedOstcHash: calculatedOstcHash,
    providedOstcHash: providedOstcHash || '',
    ostcHashMatches,
    expectedPayload,
    actualPayload,
    expectedRules: ruleComparison.expected,
    actualRules: ruleComparison.actual,
    missingRules: ruleComparison.missing,
    extraRules: ruleComparison.extra,
    missing: comparison.missing,
    mismatched: comparison.mismatched,
    extra: comparison.extra,
    ostcId: id,
    orchestrationAddress: address,
  };
}
