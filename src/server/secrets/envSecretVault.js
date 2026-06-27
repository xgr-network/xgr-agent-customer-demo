import { Wallet } from 'ethers';
import { decodeEncryptedSecretBundle, decryptJson, requireSecretPassword } from './secretCrypto.js';

export const ENCRYPTED_SECRETS_ENV_NAME = 'XGR_AGENT_ENCRYPTED_SECRETS';

const DEFAULT_UNLOCK_TTL_SEC = 20 * 60;

let unlockedSecrets = null;
let unlockExpiresAt = 0;

function nowMs() {
  return Date.now();
}

function normalizeUnlockTtlSec(value) {
  const n = Number(value || DEFAULT_UNLOCK_TTL_SEC);
  return Math.max(60, Math.min(24 * 60 * 60, Number.isFinite(n) ? Math.round(n) : DEFAULT_UNLOCK_TTL_SEC));
}

function readEncryptedEnvValue() {
  return String(process.env[ENCRYPTED_SECRETS_ENV_NAME] || '').trim();
}

function readEnvelope() {
  const value = readEncryptedEnvValue();
  return value ? decodeEncryptedSecretBundle(value) : null;
}

function envelopePublicMeta() {
  try {
    return readEnvelope()?.publicMeta || {};
  } catch {
    return {};
  }
}

function purgeExpired() {
  if (unlockedSecrets && unlockExpiresAt <= nowMs()) {
    unlockedSecrets = null;
    unlockExpiresAt = 0;
  }
}

function normalizeSecretBundle(input) {
  const bundle = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    openai: {
      apiKey: String(bundle.openai?.apiKey || '').trim(),
    },
    gemini: {
      apiKey: String(bundle.gemini?.apiKey || '').trim(),
    },
    document: {
      apiKey: String(bundle.document?.apiKey || '').trim(),
    },
    xdala: {
      ownerPrivateKey: String(bundle.xdala?.ownerPrivateKey || '').trim(),
      agentPrivateKey: String(bundle.xdala?.agentPrivateKey || '').trim(),
    },
  };
}

function safeWalletAddress(privateKey) {
  const value = String(privateKey || '').trim();
  if (!value) return '';
  try {
    return new Wallet(value).address.toLowerCase();
  } catch {
    return '';
  }
}

function buildUnlockedPublicMeta(secrets) {
  return {
    hasOpenAiApiKey: !!secrets?.openai?.apiKey,
    hasGeminiApiKey: !!secrets?.gemini?.apiKey,
    hasDocumentApiKey: !!secrets?.document?.apiKey,
    hasXdalaOwnerPrivateKey: !!secrets?.xdala?.ownerPrivateKey,
    hasXdalaAgentPrivateKey: !!secrets?.xdala?.agentPrivateKey,
    ownerAddress: safeWalletAddress(secrets?.xdala?.ownerPrivateKey),
    agentAddress: safeWalletAddress(secrets?.xdala?.agentPrivateKey),
  };
}

function normalizePublicMeta(meta = {}) {
  return {
    hasOpenAiApiKey: !!meta.hasOpenAiApiKey,
    hasGeminiApiKey: !!meta.hasGeminiApiKey,
    hasDocumentApiKey: !!meta.hasDocumentApiKey,
    hasXdalaOwnerPrivateKey: !!meta.hasXdalaOwnerPrivateKey,
    hasXdalaAgentPrivateKey: !!meta.hasXdalaAgentPrivateKey,
    ownerAddress: String(meta.ownerAddress || '').trim().toLowerCase(),
    agentAddress: String(meta.agentAddress || '').trim().toLowerCase(),
  };
}

export function hasEncryptedEnvSecrets() {
  return !!readEncryptedEnvValue();
}

export function getEnvSecretStatus() {
  purgeExpired();
  const configured = hasEncryptedEnvSecrets();
  const unlockLeftSec = unlockedSecrets
    ? Math.max(0, Math.floor((unlockExpiresAt - nowMs()) / 1000))
    : 0;
  const publicMeta = unlockedSecrets
    ? buildUnlockedPublicMeta(unlockedSecrets)
    : normalizePublicMeta(envelopePublicMeta());

  return {
    source: 'env',
    envName: ENCRYPTED_SECRETS_ENV_NAME,
    configured,
    unlocked: !!unlockedSecrets && unlockLeftSec > 0,
    unlockExpiresAt: unlockExpiresAt || 0,
    unlockLeftSec,
    publicMeta,
  };
}

export function unlockEnvSecrets(input = {}) {
  const encrypted = readEncryptedEnvValue();
  if (!encrypted) {
    throw new Error(`${ENCRYPTED_SECRETS_ENV_NAME} is not configured.`);
  }

  const password = requireSecretPassword(input.password);
  const ttlSec = normalizeUnlockTtlSec(input.unlockTtlSec);
  unlockedSecrets = normalizeSecretBundle(decryptJson(encrypted, password));
  unlockExpiresAt = nowMs() + ttlSec * 1000;
  return getEnvSecretStatus();
}

export function lockEnvSecrets() {
  unlockedSecrets = null;
  unlockExpiresAt = 0;
  return getEnvSecretStatus();
}

export function getUnlockedEnvSecrets() {
  purgeExpired();
  return unlockedSecrets;
}

function normalizeAiProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'gemini') return 'gemini';
  if (provider === 'mock') return 'mock';
  return 'openai';
}

function resolveAiProviderForUnlockedSecrets(baseConfig, secrets) {
  const configuredProvider = normalizeAiProvider(baseConfig?.ai?.provider || 'openai');
  const hasOpenAi = !!(secrets?.openai?.apiKey || baseConfig?.openai?.apiKey);
  const hasGemini = !!(secrets?.gemini?.apiKey || baseConfig?.gemini?.apiKey);

  if (configuredProvider === 'gemini' && hasGemini) return 'gemini';
  if (configuredProvider === 'openai' && hasOpenAi) return 'openai';
  if (configuredProvider === 'mock') return 'mock';
  if (hasGemini && !hasOpenAi) return 'gemini';
  if (hasOpenAi && !hasGemini) return 'openai';
  return configuredProvider;
}

export function applyUnlockedEnvSecretsToConfig(baseConfig) {
  if (!hasEncryptedEnvSecrets()) return baseConfig;

  const secrets = getUnlockedEnvSecrets();
  if (!secrets) {
    throw new Error('Encrypted server secrets are configured but locked. Unlock server secrets in the setup panel first.');
  }

  return {
    ...baseConfig,
    mode: 'live',
    ai: {
      ...baseConfig.ai,
      provider: resolveAiProviderForUnlockedSecrets(baseConfig, secrets),
    },
    openai: {
      ...baseConfig.openai,
      apiKey: secrets.openai.apiKey || baseConfig.openai?.apiKey || '',
    },
    gemini: {
      ...baseConfig.gemini,
      apiKey: secrets.gemini.apiKey || baseConfig.gemini?.apiKey || '',
    },
    document: {
      ...baseConfig.document,
      apiKey: secrets.document.apiKey || baseConfig.document?.apiKey || '',
    },
    xdala: {
      ...baseConfig.xdala,
      ownerPrivateKey: secrets.xdala.ownerPrivateKey,
      agentPrivateKey: secrets.xdala.agentPrivateKey,
    },
  };
}
