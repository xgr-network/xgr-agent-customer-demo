const FORM_STORAGE_KEY = 'xgr.agent.liveSetup.form.v1';
const RUNTIME_SESSION_STORAGE_KEY = 'xgr.agent.runtimeSessionId.v1';
export const LIVE_SETUP_SYNC_EVENT = 'xgr-agent:sync-live-setup';

const PUBLIC_RUNTIME_CONFIG_FIELDS = [
  'chainKey',
  'rpcUrl',
  'explorerUrl',
  'orchestrationAddress',
  'ostcId',
  'ostcHash',
  'startStepId',
  'waitStepId',
  'aiProvider',
  'openaiModel',
  'geminiModel',
  'documentApiUrl',
  'customDocumentText',
  'customInstructions',
  'resultSchemaText',
  'unlockTtlMinutes',
  'connectedWalletAddress',
  'connectedWalletChainId',
];

function readRuntimeSessionIdFromStorage() {
  try {
    return sessionStorage.getItem(RUNTIME_SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

let latestPublicRuntimeConfigDraft = {};

function readSavedFormDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(FORM_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function pickPublicRuntimeConfigFields(source = {}) {
  const draft = {};
  for (const field of PUBLIC_RUNTIME_CONFIG_FIELDS) {
    if (source[field] !== undefined && source[field] !== null) {
      draft[field] = source[field];
    }
  }
  return draft;
}

function withUnlockTtlSeconds(draft = {}) {
  const unlockTtlMinutes = Number(draft.unlockTtlMinutes || 20);
  return {
    ...draft,
    unlockTtlSec: Math.max(1, Number.isFinite(unlockTtlMinutes) ? unlockTtlMinutes : 20) * 60,
  };
}

export function setLatestPublicRuntimeConfigDraft(form = {}) {
  latestPublicRuntimeConfigDraft = withUnlockTtlSeconds(pickPublicRuntimeConfigFields(form));
}

export function buildSavedPublicRuntimeConfigDraft() {
  return withUnlockTtlSeconds({
    ...pickPublicRuntimeConfigFields(readSavedFormDraft()),
    ...latestPublicRuntimeConfigDraft,
  });
}

export async function syncPublicRuntimeConfigBeforeRequest() {
  // Runtime setup is saved explicitly through the Live Setup panel.
  // Do not run a public-only save directly before actions because saved
  // runtime keys may already be unlocked while the password input is cleared.
}
