import dotenv from 'dotenv';
import { ENCRYPTED_SECRETS_ENV_NAME } from '../server/secrets/envSecretVault.js';

dotenv.config({ path: '.env' });
dotenv.config({
  path: '.env.secrets',
  override: true,
});

function readString(name, defaultValue = '') {
  const value = process.env[name];
  return value == null || String(value).trim() === '' ? defaultValue : String(value).trim();
}

function readNumber(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

export function loadConfig() {
  const mode = readString('DEMO_MODE', 'mock').toLowerCase();
  return {
    mode: mode === 'live' ? 'live' : 'mock',
    port: readNumber('PORT', 3020),
    ai: {
      provider: readString('AI_PROVIDER', ''),
      instructions: readString('AI_INSTRUCTIONS', ''),
      resultSchemaText: readString('AI_RESULT_SCHEMA', ''),
    },
    openai: {
      apiKey: '',
      model: readString('OPENAI_MODEL', 'gpt-4.1-mini'),
    },
    gemini: {
      apiKey: '',
      model: readString('GEMINI_MODEL', 'gemini-3.5-flash'),
    },
    document: {
      apiUrl: readString('DOCUMENT_API_URL'),
      apiKey: '',
    },
    xdala: {
      rpcUrl: readString('XDALA_RPC_URL'),
      ownerPrivateKey: '',
      agentPrivateKey: '',
      orchestrationAddress: readString('XDALA_ORCHESTRATION_ADDRESS'),
      ostcId: readString('XDALA_OSTC_ID', 'document_agent_waiter_flow'),
      ostcHash: readString('XDALA_OSTC_HASH', '0x' + '00'.repeat(32)),
      waitStepId: readString('XDALA_WAIT_STEP_ID', 'WAIT_FOR_DOCUMENT'),
      startStepId: readString('XDALA_START_STEP_ID', 'ARM_WAIT'),
      maxTotalGas: readNumber('XDALA_MAX_TOTAL_GAS', 0),
      permitTtlSec: readNumber('XDALA_PERMIT_TTL_SEC', 1200),
    },
    secrets: {
      encryptedEnvName: ENCRYPTED_SECRETS_ENV_NAME,
      encryptedEnvSecretsConfigured: !!readString(ENCRYPTED_SECRETS_ENV_NAME),
      encryptedEnvSecrets: readString(ENCRYPTED_SECRETS_ENV_NAME),
    },
  };
}

export function assertLiveConfig(config) {
  const missing = [];
  if (!config.xdala.rpcUrl) missing.push('XDALA_RPC_URL');
  if (!config.xdala.ownerPrivateKey) missing.push('xdala.ownerPrivateKey from unlocked XGR_AGENT_ENCRYPTED_SECRETS or runtime override');
  if (!config.xdala.agentPrivateKey) missing.push('xdala.agentPrivateKey from unlocked XGR_AGENT_ENCRYPTED_SECRETS or runtime override');
  if (!config.xdala.orchestrationAddress) missing.push('XDALA_ORCHESTRATION_ADDRESS');
  if (missing.length) {
    throw new Error(`Live mode is missing required environment variables: ${missing.join(', ')}`);
  }
}
