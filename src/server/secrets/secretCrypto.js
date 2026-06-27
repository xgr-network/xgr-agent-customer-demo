import crypto from 'crypto';

const SECRET_BUNDLE_VERSION = 1;
const KDF_NAME = 'scrypt';
const CIPHER_NAME = 'aes-256-gcm';

export function requireSecretPassword(password) {
  const value = String(password || '');
  if (value.length < 8) {
    throw new Error('Secret password must contain at least 8 characters.');
  }
  return value;
}

function deriveKey(password, salt) {
  return crypto.scryptSync(requireSecretPassword(password), salt, 32);
}

export function encryptJson(value, password, metadata = {}) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv(CIPHER_NAME, key, iv);
  const input = Buffer.from(JSON.stringify(value || {}), 'utf8');
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: SECRET_BUNDLE_VERSION,
    kdf: KDF_NAME,
    cipher: CIPHER_NAME,
    createdAt: new Date().toISOString(),
    ...metadata,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

export function decryptJson(payload, password) {
  const envelope = typeof payload === 'string' ? decodeEncryptedSecretBundle(payload) : payload;
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Encrypted secret bundle is missing or invalid.');
  }
  if (Number(envelope.version || 0) !== SECRET_BUNDLE_VERSION) {
    throw new Error(`Unsupported encrypted secret bundle version: ${envelope.version || 'unknown'}.`);
  }
  if (String(envelope.kdf || '') !== KDF_NAME) {
    throw new Error(`Unsupported encrypted secret bundle KDF: ${envelope.kdf || 'unknown'}.`);
  }
  if (String(envelope.cipher || '') !== CIPHER_NAME) {
    throw new Error(`Unsupported encrypted secret bundle cipher: ${envelope.cipher || 'unknown'}.`);
  }

  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const data = Buffer.from(envelope.data, 'base64');
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(CIPHER_NAME, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

export function encodeEncryptedSecretBundle(envelope) {
  return Buffer
    .from(JSON.stringify(envelope || {}), 'utf8')
    .toString('base64url');
}

export function decodeEncryptedSecretBundle(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Encrypted secret bundle is empty.');
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error(`Encrypted secret bundle could not be decoded: ${error.message}`);
  }
}
