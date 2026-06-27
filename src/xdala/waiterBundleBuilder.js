export const XRC137_PAYLOAD_TYPE_VALUES = Object.freeze([
  'string',
  'bool',
  'int64',
  'uint64',
  'double',
  'decimal',
  'timestamp_ms',
  'duration_ms',
  'uuid',
  'address',
  'bytes',
  'bytes32',
  'uint256',
  'int256',
]);

const XRC137_TYPE_SET = new Set(XRC137_PAYLOAD_TYPE_VALUES);

export const XRC137_VALIDATION_MODE_VALUES = Object.freeze([
  'none',
  'isNotEmpty',
  'isEmpty',
  'greaterThan',
  'lessThan',
  'equals',
  'notEquals',
  'oneOf',
  'notOneOf',
]);

const XRC137_VALIDATION_MODE_SET = new Set(XRC137_VALIDATION_MODE_VALUES);
const NUMERIC_XRC137_TYPE_SET = new Set([
  'double',
  'decimal',
  'int64',
  'int256',
  'uint64',
  'uint256',
  'timestamp_ms',
  'duration_ms',
]);

export const DEFAULT_SCHEMA = {
  type: 'object',
  properties: {
    insuranceNumber: {
      type: 'string',
      description: 'The insurance number found in the document.',
      'x-xrc137-type': 'string',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
    documentDate: {
      type: 'string',
      description: 'The document date in ISO format YYYY-MM-DD when possible.',
      'x-xrc137-type': 'string',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
    documentType: {
      type: 'string',
      description: 'A short business document type classification.',
      'x-xrc137-type': 'string',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
    confidence: {
      type: 'number',
      description: 'Confidence from 0 to 1.',
      'x-xrc137-type': 'double',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
    evidence: {
      type: 'string',
      description: 'Short evidence text. Do not copy the full document.',
      'x-xrc137-type': 'string',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
  },
  required: ['insuranceNumber', 'documentDate', 'documentType', 'confidence', 'evidence'],
};

export function toPascalCase(key) {
  return String(key || '')
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => String(c || '').toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

export function parseResultSchema(schemaText) {
  if (!schemaText) return DEFAULT_SCHEMA;
  const parsed = typeof schemaText === 'string' ? JSON.parse(schemaText) : schemaText;
  if (!parsed || typeof parsed !== 'object' || parsed.type !== 'object' || !parsed.properties || typeof parsed.properties !== 'object') {
    throw new Error('Result schema must be a JSON schema object with type="object" and properties.');
  }
  return parsed;
}

export function xrcTypeForSchemaType(value) {
  const explicit = String(value?.['x-xrc137-type'] || value?.xrc137Type || '').trim().toLowerCase();
  if (XRC137_TYPE_SET.has(explicit)) return explicit;
  const type = String(value?.type || 'string').toLowerCase();
  if (type === 'number') return 'double';
  if (type === 'integer') return 'int64';
  if (type === 'boolean') return 'bool';
  return 'string';
}

function normalizeValidationSpec(value, required = false) {
  const source = value?.['x-xrc137-validation'] || value?.xrc137Validation || {};
  const rawMode = String(source?.mode || '').trim();
  const mode = XRC137_VALIDATION_MODE_SET.has(rawMode)
    ? rawMode
    : required ? 'isNotEmpty' : 'none';
  return {
    mode,
    value: source?.value == null ? '' : String(source.value),
  };
}

function defaultForSchemaType(value) {
  const xrcType = xrcTypeForSchemaType(value);
  const type = String(value?.type || 'string').toLowerCase();
  if (xrcType === 'bool' || type === 'boolean') return false;
  if ([
    'double',
    'decimal',
    'int64',
    'int256',
    'uint64',
    'uint256',
    'timestamp_ms',
    'duration_ms',
  ].includes(xrcType) || type === 'number' || type === 'integer') return 0;
  return '';
}

export function normalizeFieldDefinitions(schemaText) {
  const schema = parseResultSchema(schemaText);
  return Object.entries(schema.properties || {}).map(([sourceKey, spec]) => {
    const required = Array.isArray(schema.required) ? schema.required.includes(sourceKey) : false;
    return {
      sourceKey,
      payloadKey: toPascalCase(sourceKey),
      type: xrcTypeForSchemaType(spec),
      jsonType: String(spec?.type || 'string').toLowerCase(),
      description: String(spec?.description || '').trim(),
      required,
      validation: normalizeValidationSpec(spec, required),
      defaultValue: defaultForSchemaType(spec),
    };
  }).filter((field) => field.payloadKey);
}

function quoteRuleString(value) {
  return JSON.stringify(String(value ?? ''));
}

function isNumericXrcType(type) {
  return NUMERIC_XRC137_TYPE_SET.has(String(type || '').toLowerCase());
}

function parseRuleValues(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function ruleLiteral(value, type) {
  const xrcType = String(type || 'string').toLowerCase();
  if (xrcType === 'bool') return String(value).trim().toLowerCase() === 'true' ? 'true' : 'false';
  if (isNumericXrcType(xrcType)) {
    const n = Number(String(value).trim());
    if (!Number.isFinite(n)) return null;
    return String(n);
  }
  return quoteRuleString(value);
}

export function buildWaitValidationRules(schemaText = '') {
  const fields = normalizeFieldDefinitions(schemaText);
  const rules = [];

  for (const field of fields) {
    const ref = `[${field.payloadKey}]`;
    const type = String(field.type || 'string').toLowerCase();

    const validation = field.validation || { mode: 'none', value: '' };
    if (validation.mode === 'isNotEmpty' || validation.mode === 'isEmpty') {
      const op = validation.mode === 'isNotEmpty' ? '!=' : '==';
      if (type === 'bool') rules.push(`${ref} ${op} false`);
      else if (isNumericXrcType(type)) rules.push(`${ref} ${op} 0`);
      else rules.push(`${ref} ${op} ""`);
      continue;
    }

    if (
      validation.mode === 'greaterThan'
      || validation.mode === 'lessThan'
      || validation.mode === 'equals'
      || validation.mode === 'notEquals'
    ) {
      const literal = ruleLiteral(validation.value, type);
      if (literal != null) {
        const op = validation.mode === 'greaterThan'
          ? '>'
          : validation.mode === 'lessThan'
            ? '<'
            : validation.mode === 'notEquals'
              ? '!='
              : '==';
        rules.push(`${ref} ${op} ${literal}`);
      }
    }

    if (validation.mode === 'oneOf' || validation.mode === 'notOneOf') {
      const values = parseRuleValues(validation.value)
        .map((item) => ruleLiteral(item, type))
        .filter((item) => item != null);
      const compare = validation.mode === 'oneOf' ? '==' : '!=';
      const joiner = validation.mode === 'oneOf' ? ' || ' : ' && ';
      if (values.length === 1) rules.push(`${ref} ${compare} ${values[0]}`);
      if (values.length > 1) rules.push(`(${values.map((literal) => `${ref} ${compare} ${literal}`).join(joiner)})`);
    }
  }

  return Array.from(new Set(rules));
}

export function buildExpectedWaitPayload(schemaText = '') {
  const fields = normalizeFieldDefinitions(schemaText);
  const waitPayload = {
    RequestId: { type: 'string' },
    WakeMarker: { type: 'string' },
    DocumentName: { type: 'string', default: '' },
    DocumentHash: { type: 'string', default: '' },
    HashAlgorithm: { type: 'string', default: 'sha256' },
    ProofCreatedAt: { type: 'string', default: '' },
    ExtractedBy: { type: 'string', default: '' },
  };
  for (const field of fields) {
    if (!waitPayload[field.payloadKey]) {
      waitPayload[field.payloadKey] = { type: field.type, default: field.defaultValue };
    }
  }
  return waitPayload;
}

export function buildConfiguredWaiterBundle({ schemaText = '', ostcId = 'document_agent_waiter_flow' } = {}) {
  const fields = normalizeFieldDefinitions(schemaText);
  const waitPayload = buildExpectedWaitPayload(schemaText);

  const passthroughPayload = Object.fromEntries(Object.keys(waitPayload).map((key) => [key, `[${key}]`]));
  const donePayload = {
    RequestId: { type: 'string' },
    DocumentHash: { type: 'string', default: '' },
  };
  for (const field of fields.slice(0, 3)) {
    donePayload[field.payloadKey] = { type: field.type, default: field.defaultValue };
  }
  const doneOutput = Object.fromEntries(Object.keys(donePayload).map((key) => [key, `[${key}]`]));

  const waitRules = [
    '[DocumentHash] != ""',
    '[HashAlgorithm] == "sha256"',
    ...buildWaitValidationRules(schemaText),
  ];

  return {
    format: 'xgr-multi-bundle@1',
    kind: 'xgr.multi-bundle',
    version: 1,
    bundles: [
      {
        bundleId: 'document_agent_waiter',
        items: [
          {
            payload: {
              RequestId: { type: 'string' },
              WakeMarker: { type: 'string' },
            },
            rules: ['[RequestId] != ""'],
            onValid: {
              waitSec: 600,
              payload: {
                memo: 'document-waiter-armed',
                RequestId: '[RequestId]',
                WakeMarker: '[WakeMarker]',
              },
            },
            onInvalid: {
              payload: {
                memo: 'document-waiter-arm-invalid',
                RequestId: '[RequestId]',
                WakeMarker: '[WakeMarker]',
              },
            },
            meta: {
              bundleId: 'document_agent_waiter',
              alias: 'XRC137_ARM_DOCUMENT_WAIT',
              type: 'xrc137',
            },
          },
          {
            payload: waitPayload,
            rules: waitRules,
            onValid: {
              payload: {
                memo: 'document-proof-accepted',
                ...passthroughPayload,
              },
            },
            onInvalid: {
              payload: {
                memo: 'document-proof-rejected',
                RequestId: '[RequestId]',
                WakeMarker: '[WakeMarker]',
                DocumentHash: '[DocumentHash]',
                HashAlgorithm: '[HashAlgorithm]',
              },
            },
            meta: {
              bundleId: 'document_agent_waiter',
              alias: 'XRC137_WAIT_FOR_DOCUMENT',
              type: 'xrc137',
            },
          },
          {
            payload: donePayload,
            rules: ['1 == 1'],
            onValid: {
              payload: {
                memo: 'document-agent-demo-done',
                ...doneOutput,
              },
            },
            onInvalid: {},
            meta: {
              bundleId: 'document_agent_waiter',
              alias: 'XRC137_DONE',
              type: 'xrc137',
            },
          },
          {
            id: ostcId,
            structure: {
              ARM_WAIT: {
                rule: 'cm:xrc137:XRC137_ARM_DOCUMENT_WAIT',
                onValid: { spawns: ['WAIT_FOR_DOCUMENT'] },
                onInvalid: {},
              },
              WAIT_FOR_DOCUMENT: {
                rule: 'cm:xrc137:XRC137_WAIT_FOR_DOCUMENT',
                onValid: { spawns: ['DONE'] },
                onInvalid: {},
              },
              DONE: {
                rule: 'cm:xrc137:XRC137_DONE',
                onValid: {},
                onInvalid: {},
              },
            },
            meta: {
              bundleId: 'document_agent_waiter',
              alias: ostcId,
              type: 'xrc729',
            },
            name: 'document_agent_waiter',
          },
        ],
      },
    ],
  };
}

export function buildConfiguredWaiterBundleText(options = {}) {
  return JSON.stringify(buildConfiguredWaiterBundle(options), null, 2);
}
