function toPascalCase(key) {
  return String(key || '')
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => String(c || '').toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

function resolveSchemaKeys(resultSchema) {
  const props = resultSchema?.properties && typeof resultSchema.properties === 'object' ? resultSchema.properties : {};
  return Object.keys(props);
}

export function buildWakeupPayload({ document, documentHash, extraction, extractedBy = 'ai-agent', resultSchema = null }) {
  const payload = {
    RequestId: document.requestId || 'demo-request-001',
    WakeMarker: 'woken-by-ai-agent',
    DocumentName: document.name,
    DocumentHash: documentHash,
    HashAlgorithm: 'sha256',
    ProofCreatedAt: new Date().toISOString(),
    ExtractedBy: extractedBy,
  };

  const keys = resolveSchemaKeys(resultSchema);
  for (const key of keys.length ? keys : Object.keys(extraction || {})) {
    const payloadKey = toPascalCase(key);
    if (!payloadKey) continue;
    payload[payloadKey] = extraction?.[key];
  }

  return payload;
}
