import { buildSampleDocumentBytes, SAMPLE_DOCUMENT_NAME } from '../demo/sampleDocument.js';

export async function fetchDocument({ apiUrl = '', apiKey = '', customText = '', uploadedDocument = null } = {}) {
  if (uploadedDocument?.bytes) {
    return {
      name: uploadedDocument.name || 'uploaded-document',
      source: 'browser-upload',
      contentType: uploadedDocument.contentType || 'application/octet-stream',
      bytes: uploadedDocument.bytes,
    };
  }

  if (customText && String(customText).trim()) {
    return {
      name: 'custom-document-text.txt',
      source: 'manual-text',
      contentType: 'text/plain; charset=utf-8',
      bytes: Buffer.from(String(customText), 'utf8'),
    };
  }

  if (!apiUrl) {
    const bytes = buildSampleDocumentBytes();
    return {
      name: SAMPLE_DOCUMENT_NAME,
      source: 'built-in-sample',
      contentType: 'text/plain; charset=utf-8',
      bytes,
    };
  }

  const headers = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const response = await fetch(apiUrl, { headers });
  if (!response.ok) {
    throw new Error(`Document API failed with HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentDisposition = response.headers.get('content-disposition') || '';
  const nameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  const urlName = apiUrl.split('/').filter(Boolean).pop() || 'document.bin';

  return {
    name: nameMatch?.[1] || urlName,
    source: apiUrl,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    bytes: Buffer.from(arrayBuffer),
  };
}
