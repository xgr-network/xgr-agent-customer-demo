const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const documents = new Map();

function normalizeRuntimeSessionId(value) {
  return String(value || 'default').trim().slice(0, 128) || 'default';
}

function sanitizeName(value, fallback = 'uploaded-document') {
  const raw = String(value || '').trim() || fallback;
  return raw.replace(/[\\/\0]/g, '_').slice(0, 160);
}

export function saveUploadedDocument(sessionId, input = {}) {
  const id = normalizeRuntimeSessionId(sessionId);
  const name = sanitizeName(input.name);
  const contentType = String(input.contentType || 'application/octet-stream').trim();
  const base64 = String(input.base64 || '').trim();
  const text = String(input.text || '');

  let bytes;
  if (base64) {
    bytes = Buffer.from(base64, 'base64');
  } else if (text) {
    bytes = Buffer.from(text, 'utf8');
  } else {
    throw new Error('Uploaded document is empty.');
  }

  if (!bytes.length) throw new Error('Uploaded document is empty.');
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document too large. Maximum size is ${MAX_DOCUMENT_BYTES} bytes.`);
  }

  const record = {
    name,
    contentType,
    bytesBase64: bytes.toString('base64'),
    sizeBytes: bytes.length,
    uploadedAt: new Date().toISOString(),
  };
  documents.set(id, record);
  return getUploadedDocumentStatus(id);
}

export function saveDocumentText(sessionId, input = {}) {
  const text = String(input.text || '');
  if (!text.trim()) throw new Error('Document text is empty.');
  return saveUploadedDocument(sessionId, {
    name: input.name || 'custom-document.txt',
    contentType: 'text/plain; charset=utf-8',
    text,
  });
}

export function getUploadedDocument(sessionId) {
  const record = documents.get(normalizeRuntimeSessionId(sessionId));
  if (!record) return null;
  return {
    ...record,
    bytes: Buffer.from(record.bytesBase64, 'base64'),
  };
}

export function getUploadedDocumentStatus(sessionId) {
  const record = documents.get(normalizeRuntimeSessionId(sessionId));
  if (!record) return { configured: false };
  return {
    configured: true,
    name: record.name,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    uploadedAt: record.uploadedAt,
  };
}

export function clearUploadedDocument(sessionId) {
  documents.delete(normalizeRuntimeSessionId(sessionId));
  return getUploadedDocumentStatus(sessionId);
}
