import { Wallet } from 'ethers';
import { findXgrChain } from '../config/xgrChains.js';
import { decryptJson, encryptJson, requireSecretPassword as requirePassword } from './secrets/secretCrypto.js';
import {
  applyUnlockedEnvSecretsToConfig,
  getEnvSecretStatus,
  getUnlockedEnvSecrets,
  hasEncryptedEnvSecrets,
} from './secrets/envSecretVault.js';

const DEFAULT_UNLOCK_TTL_SEC = 20 * 60;
const runtimeRecords = new Map();

function normalizeRuntimeSessionId(value) {
  const id = String(value || '').trim();
  if (!id) throw new Error('Runtime session id missing. Reload the page and try again.');
  return id.slice(0, 128);
}

function normalizeAddress(value) {
  return String(value || '').trim();
}


function normalizeHexChainId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase().startsWith('0x')) return `0x${raw.slice(2).toLowerCase()}`;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return '';
  return `0x${n.toString(16)}`;
}

function normalizeLowerAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function derivePrivateKeyAddress(privateKey, label) {
  try {
    return new Wallet(String(privateKey || '').trim()).address.toLowerCase();
  } catch {
    throw new Error(`${label} private key is invalid.`);
  }
}

function validateBrowserWalletMatch({ chain, ownerPrivateKey, connectedWalletAddress, connectedWalletChainId }) {
  const walletAddress = normalizeLowerAddress(connectedWalletAddress);
  const walletChainId = normalizeHexChainId(connectedWalletChainId);
  const expectedChainId = normalizeHexChainId(chain.chainIdHex);
  const ownerAddress = derivePrivateKeyAddress(ownerPrivateKey, 'Owner');

  if (!walletAddress) {
    return {
      walletAddress: ownerAddress,
      walletChainId: expectedChainId,
      ownerAddress,
    };
  }

  if (!walletAddress) {
    throw new Error('Connect the browser wallet before saving live config. The connected wallet must match the owner private key.');
  }
  if (!/^0x[0-9a-f]{40}$/.test(walletAddress)) {
    throw new Error('Connected wallet address is invalid. Reconnect the browser wallet.');
  }
  if (walletChainId !== expectedChainId) {
    throw new Error(`Connected wallet is on ${walletChainId || 'unknown chain'}, but selected network requires ${expectedChainId}. Switch the wallet network first.`);
  }
  if (ownerAddress !== walletAddress) {
    throw new Error(`Owner private key does not match the connected wallet. Connected=${walletAddress}, ownerKey=${ownerAddress}.`);
  }
  return { walletAddress, walletChainId, ownerAddress };
}

function normalizeUnlockTtlSec(value) {
  const n = Number(value || DEFAULT_UNLOCK_TTL_SEC);
  return Math.max(60, Math.min(24 * 60 * 60, Number.isFinite(n) ? Math.round(n) : DEFAULT_UNLOCK_TTL_SEC));
}

function purgeExpired(record) {
  if (!record?.unlockedSecrets) return record;
  if (Number(record.unlockExpiresAt || 0) > Date.now()) return record;
  record.unlockedSecrets = null;
  record.unlockExpiresAt = 0;
  return record;
}

function readRecord(sessionId) {
  const id = normalizeRuntimeSessionId(sessionId);
  const record = runtimeRecords.get(id) || null;
  if (!record) return null;
  return purgeExpired(record);
}

function writeRecord(sessionId, record) {
  const id = normalizeRuntimeSessionId(sessionId);
  runtimeRecords.set(id, purgeExpired(record));
  return runtimeRecords.get(id);
}

function buildStatus(record) {
  const current = purgeExpired(record);
  if (!current) {
    return {
      configured: false,
      unlocked: false,
      unlockLeftSec: 0,
      publicConfig: null,
      hasEncryptedKeys: false,
    };
  }
  const envStatus = current.usesEnvSecrets ? getEnvSecretStatus() : null;
  const runtimeUnlockLeftSec = current.unlockedSecrets
    ? Math.max(0, Math.floor((Number(current.unlockExpiresAt || 0) - Date.now()) / 1000))
    : 0;
  const envUnlockLeftSec = Number(envStatus?.unlockLeftSec || 0);
  const unlocked = !!(
    (current.unlockedSecrets && runtimeUnlockLeftSec > 0)
    || (current.usesEnvSecrets && envStatus?.unlocked)
  );
  return {
    configured: true,
    unlocked,
    unlockExpiresAt: current.unlockedSecrets ? Number(current.unlockExpiresAt || 0) : Number(envStatus?.unlockExpiresAt || 0),
    unlockLeftSec: current.unlockedSecrets ? runtimeUnlockLeftSec : envUnlockLeftSec,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
    publicConfig: current.publicConfig,
    hasEncryptedKeys: !!current.encryptedSecrets,
    usesEnvSecrets: !!current.usesEnvSecrets,
    source: current.usesEnvSecrets && !current.encryptedSecrets ? 'encrypted-env' : 'runtime',
  };
}


function decryptExistingSecrets(existing, password) {
  if (!existing?.encryptedSecrets) return {};
  return decryptJson(existing.encryptedSecrets, password);
}

function pickSecret(inputValue, existingValue) {
  const next = String(inputValue || '').trim();
  return next || String(existingValue || '').trim();
}

function flattenEnvSecrets() {
  const envSecrets = getUnlockedEnvSecrets();
  if (!envSecrets) return {};
  return {
    ownerPrivateKey: String(envSecrets.xdala?.ownerPrivateKey || '').trim(),
    agentPrivateKey: String(envSecrets.xdala?.agentPrivateKey || '').trim(),
    openaiApiKey: String(envSecrets.openai?.apiKey || '').trim(),
    geminiApiKey: String(envSecrets.gemini?.apiKey || '').trim(),
    documentApiKey: String(envSecrets.document?.apiKey || '').trim(),
  };
}

function hasAnySecretValue(secrets = {}) {
  return Object.values(secrets || {}).some((value) => !!String(value || '').trim());
}

function normalizeRuntimeSecretInputs(input = {}) {
  return {
    ownerPrivateKey: String(input.ownerPrivateKey || '').trim(),
    agentPrivateKey: String(input.agentPrivateKey || '').trim(),
    openaiApiKey: String(input.openaiApiKey || '').trim(),
    geminiApiKey: String(input.geminiApiKey || '').trim(),
    documentApiKey: String(input.documentApiKey || '').trim(),
  };
}

function mergeSecretSources(runtimeSecrets = {}, envSecrets = {}) {
  return {
    ownerPrivateKey: pickSecret(runtimeSecrets.ownerPrivateKey, envSecrets.ownerPrivateKey),
    agentPrivateKey: pickSecret(runtimeSecrets.agentPrivateKey, envSecrets.agentPrivateKey),
    openaiApiKey: pickSecret(runtimeSecrets.openaiApiKey, envSecrets.openaiApiKey),
    geminiApiKey: pickSecret(runtimeSecrets.geminiApiKey, envSecrets.geminiApiKey),
    documentApiKey: pickSecret(runtimeSecrets.documentApiKey, envSecrets.documentApiKey),
  };
}

export function getRuntimeConfigStatus(sessionId) {
  return buildStatus(readRecord(sessionId));
}

export function clearRuntimeConfig(sessionId) {
  runtimeRecords.delete(normalizeRuntimeSessionId(sessionId));
}

export function saveRuntimeConfig(sessionId, input = {}) {
  const chain = findXgrChain(input.chainId || input.chainKey || input.chainIdHex);
  const existing = readRecord(sessionId);
  const envSecrets = flattenEnvSecrets();
  const runtimeSecretInputs = normalizeRuntimeSecretInputs(input);
  const hasRuntimeSecretInput = hasAnySecretValue(runtimeSecretInputs);
  const mustReadExistingRuntimeSecrets = !!existing?.encryptedSecrets;
  const password = hasRuntimeSecretInput || mustReadExistingRuntimeSecrets
    ? requirePassword(input.password)
    : '';
  const existingSecrets = password && existing?.encryptedSecrets
    ? decryptExistingSecrets(existing, password)
    : {};

  const aiProvider = String(input.aiProvider || existing?.publicConfig?.aiProvider || 'openai').trim().toLowerCase();
  const openaiModel = String(input.openaiModel || existing?.publicConfig?.openaiModel || 'gpt-4.1-mini').trim();
  const geminiModel = String(input.geminiModel || existing?.publicConfig?.geminiModel || 'gemini-3.5-flash').trim();
  const documentApiUrl = String(input.documentApiUrl || existing?.publicConfig?.documentApiUrl || '').trim();
  const customDocumentText = String(input.customDocumentText || existing?.publicConfig?.customDocumentText || '').slice(0, 50000);
  const customInstructions = String(input.customInstructions || input.aiInstructions || existing?.publicConfig?.customInstructions || existing?.publicConfig?.aiInstructions || '').slice(0, 12000);
  const resultSchemaText = String(input.resultSchemaText || existing?.publicConfig?.resultSchemaText || '').slice(0, 20000);

  const runtimeSecrets = {
    ownerPrivateKey: pickSecret(runtimeSecretInputs.ownerPrivateKey, existingSecrets.ownerPrivateKey),
    agentPrivateKey: pickSecret(runtimeSecretInputs.agentPrivateKey, existingSecrets.agentPrivateKey),
    openaiApiKey: pickSecret(runtimeSecretInputs.openaiApiKey, existingSecrets.openaiApiKey),
    geminiApiKey: pickSecret(runtimeSecretInputs.geminiApiKey, existingSecrets.geminiApiKey),
    documentApiKey: pickSecret(runtimeSecretInputs.documentApiKey, existingSecrets.documentApiKey),
  };
  const secrets = mergeSecretSources(runtimeSecrets, envSecrets);
  const usesEnvSecrets = hasAnySecretValue(envSecrets);

  if (!secrets.ownerPrivateKey || !secrets.agentPrivateKey) {
    if (hasEncryptedEnvSecrets()) {
      throw new Error('Encrypted server secrets are configured but locked or incomplete. Unlock server secrets first, or enter runtime override keys.');
    }
    throw new Error('Owner and agent private keys are required for live mode. Add them to encrypted server secrets or enter runtime override keys.');
  }

  const walletMatch = validateBrowserWalletMatch({
    chain,
    ownerPrivateKey: secrets.ownerPrivateKey,
    connectedWalletAddress: input.connectedWalletAddress,
    connectedWalletChainId: input.connectedWalletChainId,
  });

  const publicConfig = {
    chainKey: chain.id,
    chainLabel: chain.label,
    chainIdHex: chain.chainIdHex,
    chainIdDec: chain.chainIdDec,
    rpcUrl: String(input.rpcUrl || chain.rpcUrl || '').trim(),
    explorerUrl: String(input.explorerUrl || chain.explorerUrl || '').trim(),
    orchestrationAddress: normalizeAddress(input.orchestrationAddress),
    ostcId: String(input.ostcId || 'document_agent_waiter_flow').trim(),
    ostcHash: String(input.ostcHash || '0x' + '00'.repeat(32)).trim(),
    startStepId: String(input.startStepId || 'ARM_WAIT').trim(),
    waitStepId: String(input.waitStepId || 'WAIT_FOR_DOCUMENT').trim(),
    aiProvider: aiProvider === 'gemini' ? 'gemini' : aiProvider === 'mock' ? 'mock' : 'openai',
    openaiModel,
    geminiModel,
    documentApiUrl,
    customDocumentText,
    customInstructions,
    resultSchemaText,
    connectedWalletAddress: walletMatch.walletAddress,
    connectedWalletChainId: walletMatch.walletChainId,
    ownerAddress: walletMatch.ownerAddress,
    hasOpenAiRuntimeKey: !!secrets.openaiApiKey,
    hasGeminiRuntimeKey: !!secrets.geminiApiKey,
    hasDocumentApiKey: !!secrets.documentApiKey,
  };

  if (!publicConfig.rpcUrl) throw new Error('RPC URL is required.');
  if (!/^0x[0-9a-fA-F]+$/.test(publicConfig.chainIdHex)) throw new Error('Invalid chain id.');
  if (!/^0x[0-9a-fA-F]{40}$/.test(publicConfig.orchestrationAddress)) {
    throw new Error('XRC-729 orchestration address must be a valid 0x address.');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(publicConfig.ostcHash)) {
    throw new Error('OSTC hash must be a bytes32 hex value.');
  }

  const now = new Date().toISOString();
  const ttlSec = normalizeUnlockTtlSec(input.unlockTtlSec);
  const hasRuntimeSecrets = hasAnySecretValue(runtimeSecrets);
  const encryptedSecrets = hasRuntimeSecrets ? encryptJson(runtimeSecrets, password) : null;

  writeRecord(sessionId, {
    id: existing?.id || `runtime_${Date.now().toString(36)}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    publicConfig,
    usesEnvSecrets,
    encryptedSecrets,
    unlockedSecrets: hasRuntimeSecrets ? runtimeSecrets : null,
    unlockExpiresAt: hasRuntimeSecrets ? Date.now() + ttlSec * 1000 : 0,
  });

  return getRuntimeConfigStatus(sessionId);
}

export function unlockRuntimeConfig(sessionId, input = {}) {
  const record = readRecord(sessionId);
  if (!record?.encryptedSecrets) {
    if (record?.usesEnvSecrets) {
      const envStatus = getEnvSecretStatus();
      if (!envStatus.unlocked) {
        throw new Error('This runtime setup uses encrypted server secrets. Unlock server secrets first.');
      }
      return getRuntimeConfigStatus(sessionId);
    }
    throw new Error('No runtime config saved for this tab yet.');
  }
  const password = requirePassword(input.password);
  const ttlSec = normalizeUnlockTtlSec(input.unlockTtlSec);
  record.unlockedSecrets = decryptJson(record.encryptedSecrets, password);
  record.unlockExpiresAt = Date.now() + ttlSec * 1000;
  writeRecord(sessionId, record);
  return getRuntimeConfigStatus(sessionId);
}

export function lockRuntimeConfig(sessionId) {
  const record = readRecord(sessionId);
  if (record) {
    record.unlockedSecrets = null;
    record.unlockExpiresAt = 0;
    writeRecord(sessionId, record);
  }
  return getRuntimeConfigStatus(sessionId);
}

export function applyRuntimeConfig(baseConfig, sessionId, password = '') {
  const record = readRecord(sessionId);
  if (!record) return applyUnlockedEnvSecretsToConfig(baseConfig);

  const envSecrets = record.usesEnvSecrets ? flattenEnvSecrets() : {};
  let runtimeSecrets = record.unlockedSecrets || {};
  if (record.encryptedSecrets && !hasAnySecretValue(runtimeSecrets) && password) {
    runtimeSecrets = decryptJson(record.encryptedSecrets, requirePassword(password));
    record.unlockedSecrets = runtimeSecrets;
    record.unlockExpiresAt = Date.now() + DEFAULT_UNLOCK_TTL_SEC * 1000;
    writeRecord(sessionId, record);
  }

  if (record.encryptedSecrets && !hasAnySecretValue(runtimeSecrets) && !hasAnySecretValue(envSecrets)) {
    throw new Error('Runtime override keys are locked. Unlock runtime override keys in the setup panel first.');
  }
  if (record.usesEnvSecrets && !hasAnySecretValue(envSecrets)) {
    throw new Error('This runtime setup uses encrypted server secrets, but they are locked. Unlock encrypted server secrets first.');
  }

  const secrets = mergeSecretSources(runtimeSecrets, envSecrets);
  if (!secrets.ownerPrivateKey || !secrets.agentPrivateKey) {
    throw new Error('Live mode needs owner and agent private keys from encrypted server secrets or runtime override keys.');
  }

  return {
    ...baseConfig,
    mode: 'live',
    ai: {
      ...baseConfig.ai,
      provider: record.publicConfig.aiProvider || baseConfig.ai?.provider || '',
      instructions: record.publicConfig.customInstructions || baseConfig.ai?.instructions || '',
      resultSchemaText: record.publicConfig.resultSchemaText || baseConfig.ai?.resultSchemaText || '',
    },
    openai: {
      ...baseConfig.openai,
      apiKey: secrets.openaiApiKey || baseConfig.openai.apiKey,
      model: record.publicConfig.openaiModel || baseConfig.openai.model,
    },
    gemini: {
      ...baseConfig.gemini,
      apiKey: secrets.geminiApiKey || baseConfig.gemini?.apiKey || '',
      model: record.publicConfig.geminiModel || baseConfig.gemini?.model || 'gemini-3.5-flash',
    },
    document: {
      ...baseConfig.document,
      apiUrl: record.publicConfig.documentApiUrl || baseConfig.document.apiUrl,
      apiKey: secrets.documentApiKey || baseConfig.document.apiKey,
      customText: record.publicConfig.customDocumentText || '',
      uploadedDocument: record.uploadedDocument || null,
    },
    xdala: {
      ...baseConfig.xdala,
      rpcUrl: record.publicConfig.rpcUrl,
      ownerPrivateKey: secrets.ownerPrivateKey,
      agentPrivateKey: secrets.agentPrivateKey,
      orchestrationAddress: record.publicConfig.orchestrationAddress,
      ostcId: record.publicConfig.ostcId,
      ostcHash: record.publicConfig.ostcHash,
      waitStepId: record.publicConfig.waitStepId,
      startStepId: record.publicConfig.startStepId,
    },
    chain: record.publicConfig,
  };
}
