import { z } from 'zod';

export const DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    insuranceNumber: { type: 'string', description: 'The insurance number found in the document.' },
    documentDate: { type: 'string', description: 'The document date in ISO format YYYY-MM-DD when possible.' },
    documentType: { type: 'string', description: 'A short business document type classification.' },
    confidence: { type: 'number', description: 'Confidence from 0 to 1.' },
    evidence: { type: 'string', description: 'Short evidence text. Do not copy the full document.' },
  },
  required: ['insuranceNumber', 'documentDate', 'documentType', 'confidence', 'evidence'],
};

export const DOCUMENT_EXTRACTION_SCHEMA_EXAMPLE = {
  insuranceNumber: 'KV-123456789',
  documentDate: '2026-05-20',
  documentType: 'confirmation letter',
  confidence: 1.0,
  evidence: 'short text reference from the document',
};

export const DOCUMENT_EXTRACTION_SCHEMA_TEXT = JSON.stringify(DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA, null, 2);

export function resolveResultJsonSchema(schemaText = '') {
  const raw = String(schemaText || '').trim();
  if (!raw) return DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA;

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || parsed.type !== 'object' || !parsed.properties || typeof parsed.properties !== 'object') {
    throw new Error('Result schema must be a JSON schema object with type="object" and properties.');
  }

  const required = Array.isArray(parsed.required) ? parsed.required.map(String) : Object.keys(parsed.properties);
  return {
    ...parsed,
    type: 'object',
    required,
  };
}


export function toProviderJsonSchema(schemaInput = DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA) {
  const schema = typeof schemaInput === 'string'
    ? resolveResultJsonSchema(schemaInput)
    : resolveResultJsonSchema(JSON.stringify(schemaInput || DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA));
  const properties = {};
  for (const [key, field] of Object.entries(schema.properties || {})) {
    properties[key] = {
      type: String(field?.type || 'string').toLowerCase(),
      ...(field?.description ? { description: String(field.description) } : {}),
    };
  }
  return {
    type: 'object',
    properties,
    required: Array.isArray(schema.required) ? schema.required : Object.keys(properties),
  };
}

function schemaFieldToZod(field, required) {
  const type = String(field?.type || 'string').toLowerCase();
  let base;
  if (type === 'number') base = z.number();
  else if (type === 'integer') base = z.number().int();
  else if (type === 'boolean') base = z.boolean();
  else base = z.string();

  if (field?.description && typeof base.describe === 'function') base = base.describe(String(field.description));
  if (!required) base = base.optional();
  return base;
}

export function buildZodSchemaFromJsonSchema(schema) {
  const required = new Set(Array.isArray(schema?.required) ? schema.required.map(String) : []);
  const shape = {};
  for (const [key, field] of Object.entries(schema?.properties || {})) {
    shape[key] = schemaFieldToZod(field, required.has(key));
  }
  return z.object(shape).passthrough();
}

export function normalizeExtraction(value, schemaInput = DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA) {
  const schema = typeof schemaInput === 'string'
    ? resolveResultJsonSchema(schemaInput)
    : resolveResultJsonSchema(JSON.stringify(schemaInput || DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA));
  const zodSchema = buildZodSchemaFromJsonSchema(schema);
  const parsed = zodSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`AI extraction did not match schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function buildSchemaDebugText(schema) {
  return JSON.stringify(toProviderJsonSchema(schema || DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA), null, 2);
}
