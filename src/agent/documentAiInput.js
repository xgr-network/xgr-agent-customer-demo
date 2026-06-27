const DEFAULT_BINARY_MIME = 'application/octet-stream';

const EXTENSION_MIME_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
  ['.xml', 'application/xml'],
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.doc', 'application/msword'],
]);

function stripMimeParameters(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function inferMimeTypeFromName(name) {
  const filename = String(name || '').toLowerCase();
  const entry = [...EXTENSION_MIME_TYPES.entries()].find(([extension]) => filename.endsWith(extension));
  return entry?.[1] || '';
}

function normalizeMimeType({ contentType = '', name = '' } = {}) {
  return stripMimeParameters(contentType) || inferMimeTypeFromName(name) || DEFAULT_BINARY_MIME;
}

function isUtf8TextMime(mimeType) {
  return (
    mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/xml'
    || mimeType === 'application/xhtml+xml'
  );
}

function readTextIfPlainDocument(bytes, mimeType) {
  if (!isUtf8TextMime(mimeType)) return '';
  return bytes.toString('utf8');
}

export function buildDocumentAiInput(document = {}) {
  const bytes = document.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error('Document bytes are required before the AI can analyze the document.');
  }

  const name = String(document.name || 'document.bin').trim() || 'document.bin';
  const contentType = normalizeMimeType({ contentType: document.contentType, name });
  const bytesBase64 = bytes.toString('base64');
  const text = readTextIfPlainDocument(bytes, contentType);

  return {
    name,
    source: String(document.source || '').trim(),
    contentType,
    sizeBytes: bytes.length,
    bytesBase64,
    dataUrl: `data:${contentType};base64,${bytesBase64}`,
    text,
  };
}

export function buildDocumentAiDebug(input = {}) {
  return {
    name: input.name || 'document.bin',
    source: input.source || '',
    contentType: input.contentType || DEFAULT_BINARY_MIME,
    sizeBytes: Number(input.sizeBytes || 0),
    delivery: input.text ? 'text-part' : 'inline-binary',
  };
}

export function buildDocumentTaskPrompt({ instructions, schemaDebugText }) {
  return [
    String(instructions || '').trim(),
    '',
    'Analyze the attached document directly. The document may be a PDF, image, scanned document, spreadsheet, or plain text.',
    'Extract only values that are visible in the document. Do not invent missing values.',
    'Return exactly one JSON object that matches this JSON schema. Do not add markdown.',
    schemaDebugText,
  ].filter(Boolean).join('\n');
}
