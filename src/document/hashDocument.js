import crypto from 'crypto';

export function hashDocumentBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error('hashDocumentBytes requires a Buffer');
  }
  return `0x${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}
