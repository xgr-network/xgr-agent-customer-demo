import React from 'react';
import { Wallet } from 'ethers';
import HelpPill from './HelpPill.jsx';
import { buildSampleDocumentText } from '../../../demo/sampleDocument.js';
import {
  LIVE_SETUP_SYNC_EVENT,
  setLatestPublicRuntimeConfigDraft,
  syncPublicRuntimeConfigBeforeRequest,
} from '../utils/publicRuntimeConfigDraft.js';

const DOCUMENT_UPLOAD_ACCEPT = '.txt,.json,.html,.htm,.pdf,.png,.jpg,.jpeg,.webp,.gif,text/plain,application/json,text/html,application/pdf,image/png,image/jpeg,image/webp,image/gif';

const DEFAULT_CUSTOM_INSTRUCTIONS = `You are an XGR document verification agent.

Read the document text and extract the requested business values.
Return only data that is visible in the document.
Do not invent values. Use lower confidence when uncertain.
Evidence must be short and must not include the full document.`;

const DEFAULT_RESULT_SCHEMA_TEXT = JSON.stringify({
  type: 'object',
  properties: {
    insuranceNumber: {
      type: 'string',
      description: 'The insurance number found in the document.',
      'x-xrc137-type': 'string',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
    documentDate: {
      type: 'string',
      description: 'The document date in ISO format YYYY-MM-DD when possible.',
      'x-xrc137-type': 'string',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
    documentType: {
      type: 'string',
      description: 'A short business document type classification.',
      'x-xrc137-type': 'string',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
    confidence: {
      type: 'number',
      description: 'Confidence from 0 to 1.',
      'x-xrc137-type': 'double',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
    evidence: {
      type: 'string',
      description: 'Short evidence text. Do not copy the full document.',
      'x-xrc137-type': 'string',
      'x-xrc137-validation': { mode: 'isNotEmpty', value: '' },
    },
  },
  required: ['insuranceNumber', 'documentDate', 'documentType', 'confidence', 'evidence'],
}, null, 2);


const XRC137_PAYLOAD_TYPE_OPTIONS = [
  'string',
  'bool',
  'int64',
  'uint64',
  'double',
  'decimal',
  'timestamp_ms',
  'duration_ms',
  'uuid',
  'address',
  'bytes',
  'bytes32',
  'uint256',
  'int256',
];

const XRC137_VALIDATION_MODE_OPTIONS = [
  { value: 'none', label: 'No XRC-137 rule' },
  { value: 'isNotEmpty', label: 'Is not empty' },
  { value: 'isEmpty', label: 'Is empty' },
  { value: 'greaterThan', label: 'Greater than' },
  { value: 'lessThan', label: 'Smaller than' },
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Is not equal' },
  { value: 'oneOf', label: 'One of' },
  { value: 'notOneOf', label: 'Is not one of' },
];

function jsonTypeForXrcType(xrcType) {
  const type = String(xrcType || 'string').toLowerCase();
  if (type === 'bool') return 'boolean';
  if (['int64', 'uint64', 'double', 'decimal', 'timestamp_ms', 'duration_ms', 'uint256', 'int256'].includes(type)) return 'number';
  return 'string';
}

function xrcTypeForSchemaSpec(spec) {
  const explicit = String(spec?.['x-xrc137-type'] || spec?.xrc137Type || '').trim().toLowerCase();
  if (XRC137_PAYLOAD_TYPE_OPTIONS.includes(explicit)) return explicit;
  const jsonType = String(spec?.type || 'string').toLowerCase();
  if (jsonType === 'boolean') return 'bool';
  if (jsonType === 'number') return 'double';
  if (jsonType === 'integer') return 'int64';
  return 'string';
}

function normalizeFieldName(value) {
  return String(value || '').replace(/[^A-Za-z0-9_]/g, '').replace(/^[^A-Za-z]+/, '').slice(0, 64);
}

function resultFieldsFromSchemaText(text) {
  try {
    const schema = JSON.parse(String(text || ''));
    const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
    return Object.entries(schema?.properties || {}).map(([name, spec]) => {
      const validation = spec?.['x-xrc137-validation'] || spec?.xrc137Validation || {};
      const fieldRequired = required.has(name);
      const rawMode = String(validation?.mode || '').trim();
      const mode = XRC137_VALIDATION_MODE_OPTIONS.some((item) => item.value === rawMode)
        ? rawMode
        : fieldRequired ? 'isNotEmpty' : 'none';
      return {
        name,
        xrcType: xrcTypeForSchemaSpec(spec),
        description: String(spec?.description || '').trim(),
        required: fieldRequired,
        validationMode: mode,
        validationValue: validation?.value == null ? '' : String(validation.value),
      };
    });
  } catch {
    return [];
  }
}

function schemaTextFromResultFields(fields) {
  const properties = {};
  const required = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    const name = normalizeFieldName(field?.name || '');
    if (!name) continue;
    const xrcType = XRC137_PAYLOAD_TYPE_OPTIONS.includes(String(field?.xrcType || '').toLowerCase())
      ? String(field.xrcType).toLowerCase()
      : 'string';
    const validationMode = XRC137_VALIDATION_MODE_OPTIONS.some((item) => item.value === field?.validationMode) ? field.validationMode : 'none';
    properties[name] = {
      type: jsonTypeForXrcType(xrcType),
      description: String(field?.description || '').trim() || `Extract ${name} from the document.`,
      'x-xrc137-type': xrcType,
    };
    if (validationMode !== 'none') {
      properties[name]['x-xrc137-validation'] = {
        mode: validationMode,
        value: String(field?.validationValue || '').trim(),
      };
    }
    if (field?.required) required.push(name);
  }
  return JSON.stringify({ type: 'object', properties, required }, null, 2);
}

function validateResultSchemaText(text) {
  try {
    const schema = JSON.parse(String(text || ''));
    if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') {
      return 'Schema must be a JSON schema object with type="object" and properties.';
    }
    return '';
  } catch (error) {
    return error.message || 'Schema JSON is invalid.';
  }
}

const FORM_STORAGE_KEY = 'xgr.agent.liveSetup.form.v1';
const RUNTIME_SESSION_STORAGE_KEY = 'xgr.agent.runtimeSessionId.v1';

function readSavedForm() {
  try {
    return JSON.parse(sessionStorage.getItem(FORM_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function readRuntimeSessionIdFromStorage() {
  try {
    return sessionStorage.getItem(RUNTIME_SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function publicRuntimeDraftFromForm(form = {}) {
  const unlockTtlMinutes = Number(form.unlockTtlMinutes || 20);
  return {
    chainKey: form.chainKey,
    rpcUrl: form.rpcUrl,
    explorerUrl: form.explorerUrl,
    orchestrationAddress: form.orchestrationAddress,
    ostcId: form.ostcId,
    ostcHash: form.ostcHash,
    startStepId: form.startStepId,
    waitStepId: form.waitStepId,
    aiProvider: form.aiProvider,
    openaiModel: form.openaiModel,
    geminiModel: form.geminiModel,
    documentApiUrl: form.documentApiUrl,
    customDocumentText: form.customDocumentText,
    customInstructions: form.customInstructions,
    resultSchemaText: form.resultSchemaText,
    unlockTtlSec: Math.max(1, Number.isFinite(unlockTtlMinutes) ? unlockTtlMinutes : 20) * 60,
  };
}

function hasEnoughPublicRuntimeConfigToSync(draft = {}) {
  return Boolean(
    String(draft.chainKey || '').trim()
    && String(draft.rpcUrl || '').trim()
    && /^0x[0-9a-fA-F]{40}$/.test(String(draft.orchestrationAddress || '').trim())
    && String(draft.ostcId || '').trim()
    && /^0x[0-9a-fA-F]{64}$/.test(String(draft.ostcHash || '').trim())
    && String(draft.startStepId || '').trim()
    && String(draft.waitStepId || '').trim()
  );
}

let publicRuntimeSyncTimer = null;
let publicRuntimeSyncAbortController = null;

function schedulePublicRuntimeConfigSync(form) {
  const runtimeSessionId = readRuntimeSessionIdFromStorage();
  if (!runtimeSessionId) return;

  const draft = publicRuntimeDraftFromForm(form);
  if (!hasEnoughPublicRuntimeConfigToSync(draft)) return;

  if (publicRuntimeSyncTimer) clearTimeout(publicRuntimeSyncTimer);
  publicRuntimeSyncTimer = window.setTimeout(() => {
    publicRuntimeSyncTimer = null;
    if (publicRuntimeSyncAbortController) {
      publicRuntimeSyncAbortController.abort();
    }
    publicRuntimeSyncAbortController = new AbortController();

    fetch('/api/runtime-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-xgr-agent-session': runtimeSessionId,
      },
      body: JSON.stringify({
        ...draft,
        runtimeSessionId,
      }),
      signal: publicRuntimeSyncAbortController.signal,
    }).catch((error) => {
      if (error?.name === 'AbortError') return;
      console.warn('Public live config auto-sync failed:', error?.message || error);
    });
  }, 150);
}

function saveFormDraft(form) {
  try {
    const { ownerPrivateKey, agentPrivateKey, openaiApiKey, geminiApiKey, documentApiKey, runtimePassword, ...safeDraft } = form || {};
    setLatestPublicRuntimeConfigDraft(safeDraft);
    sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(safeDraft));
    schedulePublicRuntimeConfigSync(safeDraft);
  } catch {
    // sessionStorage is optional for the demo flow
  }
}

function zeroHash() {
  return '0x' + '00'.repeat(32);
}

function defaultDocumentText() {
  return buildSampleDocumentText();
}

function asInitialForm(config) {
  const chains = Array.isArray(config?.chains) ? config.chains : [];
  const currentRuntime = config?.runtimeConfig?.publicConfig || {};
  const saved = readSavedForm();
  const selected = chains.find((chain) => chain.id === (currentRuntime.chainKey || saved.chainKey)) || chains[2] || chains[0] || null;
  return {
    chainKey: selected?.id || '',
    rpcUrl: currentRuntime.rpcUrl || saved.rpcUrl || selected?.rpcUrl || '',
    explorerUrl: currentRuntime.explorerUrl || saved.explorerUrl || selected?.explorerUrl || '',
    orchestrationAddress: currentRuntime.orchestrationAddress || saved.orchestrationAddress || config?.xdala?.orchestrationAddress || '',
    ostcId: currentRuntime.ostcId || saved.ostcId || config?.xdala?.ostcId || 'document_agent_waiter_flow',
    ostcHash: currentRuntime.ostcHash || saved.ostcHash || config?.demoBundle?.ostcHash || zeroHash(),
    startStepId: currentRuntime.startStepId || saved.startStepId || config?.xdala?.startStepId || 'ARM_WAIT',
    waitStepId: currentRuntime.waitStepId || saved.waitStepId || config?.xdala?.waitStepId || 'WAIT_FOR_DOCUMENT',
    aiProvider: currentRuntime.aiProvider || saved.aiProvider || config?.ai?.provider || 'openai',
    openaiModel: currentRuntime.openaiModel || saved.openaiModel || config?.ai?.openaiModel || 'gpt-4.1-mini',
    openaiApiKey: '',
    geminiModel: currentRuntime.geminiModel || saved.geminiModel || config?.ai?.geminiModel || 'gemini-3.5-flash',
    geminiApiKey: '',
    documentApiUrl: currentRuntime.documentApiUrl || saved.documentApiUrl || '',
    documentApiKey: '',
    customDocumentText: currentRuntime.customDocumentText || saved.customDocumentText || defaultDocumentText(),
    customInstructions: currentRuntime.customInstructions || currentRuntime.aiInstructions || saved.customInstructions || saved.aiInstructions || DEFAULT_CUSTOM_INSTRUCTIONS,
    resultSchemaText: currentRuntime.resultSchemaText || saved.resultSchemaText || DEFAULT_RESULT_SCHEMA_TEXT,
    ownerPrivateKey: '',
    agentPrivateKey: '',
    runtimePassword: '',
    unlockTtlMinutes: saved.unlockTtlMinutes || 20,
  };
}


async function postJson(url, body, runtimeSessionId, method = 'POST') {
  await syncPublicRuntimeConfigBeforeRequest(url, method, runtimeSessionId);
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-xgr-agent-session': runtimeSessionId,
    },
    body: JSON.stringify({ ...(body || {}), runtimeSessionId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function downloadJsonFromPost(url, body, filename, runtimeSessionId) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-xgr-agent-session': runtimeSessionId,
    },
    body: JSON.stringify({ ...(body || {}), runtimeSessionId }),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = parsed.error;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function normalizeHexChainId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase().startsWith('0x')) return `0x${raw.slice(2).toLowerCase()}`;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return '';
  return `0x${n.toString(16)}`;
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function addressFromPrivateKey(privateKey) {
  const key = String(privateKey || '').trim();
  if (!key) return '';
  try {
    return new Wallet(key).address.toLowerCase();
  } catch {
    return '';
  }
}

function maskAddress(address) {
  const value = String(address || '').trim();
  return value ? `${value.slice(0, 8)}...${value.slice(-6)}` : '';
}

function StepPill({ ok, waiting, label }) {
  const text = label || (ok ? 'done' : waiting ? 'needed' : 'open');
  return <span className={`setup-step-pill ${ok ? 'done' : waiting ? 'waiting' : ''}`}>{text}</span>;
}

function SetupStep({ number, title, help, helpLabel = 'Why this step matters', helpTitle = '', helpContent = null, ok, waiting, statusLabel, children }) {
  const resolvedHelp = helpContent || help;
  return (
    <section className={`setup-step ${ok ? 'done' : waiting ? 'waiting' : ''}`}>
      <div className="setup-step-header">
        <div className="setup-step-number">{number}</div>
        <div className="setup-step-heading">
          <div className="title-with-help">
            <h3>{title}</h3>
            {resolvedHelp ? (
              <HelpPill label={helpLabel} title={helpTitle || title}>
                {resolvedHelp}
              </HelpPill>
            ) : null}
          </div>
        </div>
        <StepPill ok={ok} waiting={waiting} label={statusLabel} />
      </div>
      <div className="setup-step-body">{children}</div>
    </section>
  );
}

function SecretInput({ label, value, onChange, visible, onToggle, placeholder = '' }) {
  return (
    <label>
      <span>{label}</span>
      <div className="secret-input-wrap">
        <input
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck="false"
          name={`xgr-${String(label || 'secret').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          aria-autocomplete="none"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="eye-button" type="button" onClick={onToggle} aria-label={visible ? `Hide ${label}` : `Show ${label}`} title={visible ? 'Hide' : 'Show'}>
          {visible ? '🙈' : '👁'}
        </button>
      </div>
    </label>
  );
}

function formatUnlockTime(seconds) {
  const n = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(n / 60);
  const rest = n % 60;
  if (minutes <= 0) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

function secretStateLabel(configured, sourceLabel = 'encrypted .env') {
  return configured ? `configured in ${sourceLabel}` : 'not configured';
}

function EnvSecretBadge({ configured, label, optional = false }) {
  return (
    <span className={`setup-step-pill ${configured ? 'done' : optional ? 'waiting' : ''}`}>
      {label}: {configured ? 'configured' : optional ? 'optional' : 'missing'}
    </span>
  );
}

function EnvSecretsSummary({ envSecrets }) {
  if (!envSecrets?.configured) return null;
  const meta = envSecrets.publicMeta || {};
  return (
    <div className="runtime-source-box">
      <div className="runtime-source-title-row">
        <div className="runtime-source-title">
          Encrypted server secrets are {envSecrets.unlocked ? 'unlocked' : 'configured but locked'}
        </div>
        <HelpPill label="Source details" title="Encrypted .env bundle">
          <p>These values come from <code>{envSecrets.envName || 'XGR_AGENT_ENCRYPTED_SECRETS'}</code>.</p>
          <p>Use the runtime fields in this step only when you want to add missing values or override the encrypted bundle for this browser tab.</p>
        </HelpPill>
      </div>
      <div className="setup-pill-row">
        <EnvSecretBadge configured={!!meta.hasXdalaOwnerPrivateKey} label="Owner key" />
        <EnvSecretBadge configured={!!meta.hasXdalaAgentPrivateKey} label="Agent key" />
        <EnvSecretBadge configured={!!meta.hasGeminiApiKey} label="Gemini key" />
        <EnvSecretBadge configured={!!meta.hasOpenAiApiKey} label="OpenAI key" />
        <EnvSecretBadge configured={!!meta.hasDocumentApiKey} optional label="Document API key" />
      </div>
    </div>
  );
}

export default function LiveSetupPanel({ config, runtimeSessionId, onConfigReload }) {
  const [form, setForm] = React.useState(() => asInitialForm(config));
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [ostcHashError, setOstcHashError] = React.useState('');
  const [wallet, setWallet] = React.useState(null);
  const [showSecrets, setShowSecrets] = React.useState({ owner: false, agent: false, openai: false, gemini: false, document: false, password: false });
  const [schemaCheck, setSchemaCheck] = React.useState(null);
  const [schemaChecking, setSchemaChecking] = React.useState(false);
  const [ostcHashCalculating, setOstcHashCalculating] = React.useState(false);
  const [waiterStarting, setWaiterStarting] = React.useState(false);
  const configRevision = `${config?.runtimeConfig?.id || ''}:${config?.runtimeConfig?.updatedAt || ''}:${config?.demoBundle?.ostcHash || ''}`;


  React.useEffect(() => {
    if (!window.ethereum?.request) return undefined;
    const syncWallet = async () => {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
        setWallet(accounts?.[0] ? { address: accounts[0], chainId: currentChainId } : null);
      } catch {
        // ignore passive wallet sync errors
      }
    };
    syncWallet();
    const handleAccounts = (accounts) => setWallet((current) => ({
      address: accounts?.[0] || '',
      chainId: current?.chainId || '',
    }));
    const handleChain = (chainId) => setWallet((current) => ({
      address: current?.address || '',
      chainId,
    }));
    try {
      window.ethereum.on?.('accountsChanged', handleAccounts);
      window.ethereum.on?.('chainChanged', handleChain);
    } catch {
      // noop
    }
    return () => {
      try {
        window.ethereum.removeListener?.('accountsChanged', handleAccounts);
        window.ethereum.removeListener?.('chainChanged', handleChain);
      } catch {
        // noop
      }
    };
  }, []);

  React.useEffect(() => {
    setForm((current) => {
      const nextBase = asInitialForm(config);
      const hasActiveDocument = Boolean(config?.documentUpload?.configured);
      return {
        ...nextBase,
        ownerPrivateKey: current.ownerPrivateKey || '',
        agentPrivateKey: current.agentPrivateKey || '',
        openaiApiKey: current.openaiApiKey || '',
        geminiApiKey: current.geminiApiKey || '',
        documentApiKey: current.documentApiKey || '',
        customDocumentText: hasActiveDocument ? (current.customDocumentText || '') : (current.customDocumentText || nextBase.customDocumentText || defaultDocumentText()),
        customInstructions: current.customInstructions || nextBase.customInstructions || DEFAULT_CUSTOM_INSTRUCTIONS,
        resultSchemaText: current.resultSchemaText || nextBase.resultSchemaText || DEFAULT_RESULT_SCHEMA_TEXT,
        runtimePassword: current.runtimePassword || '',
      };
    });
  }, [configRevision]);

  React.useEffect(() => {
    saveFormDraft(form);
  }, [
    form.chainKey, form.rpcUrl, form.explorerUrl, form.orchestrationAddress,
    form.ostcId, form.ostcHash, form.startStepId, form.waitStepId,
    form.aiProvider, form.openaiModel, form.geminiModel, form.documentApiUrl,
    form.customDocumentText, form.customInstructions, form.resultSchemaText,
    form.unlockTtlMinutes,
  ]);

  React.useEffect(() => {
    async function handleLiveSetupSync(event) {
      const detail = event?.detail || {};
      const requestRuntimeSessionId = detail.runtimeSessionId || runtimeSessionId;
      const draft = publicRuntimeDraftFromForm(form);

      if (!hasEnoughPublicRuntimeConfigToSync(draft)) {
        detail.reject?.(new Error('Complete the public live setup first: chain, RPC URL, orchestration address, OSTC hash, start step, and wait step are required.'));
        return;
      }

      try {
        const response = await fetch('/api/runtime-config', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-xgr-agent-session': requestRuntimeSessionId,
          },
          body: JSON.stringify({
            ...draft,
            runtimeSessionId: requestRuntimeSessionId,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || `Could not save public live config. HTTP ${response.status}`);
        }
        detail.resolve?.(true);
      } catch (error) {
        detail.reject?.(error);
      }
    }

    window.addEventListener(LIVE_SETUP_SYNC_EVENT, handleLiveSetupSync);
    return () => window.removeEventListener(LIVE_SETUP_SYNC_EVENT, handleLiveSetupSync);
  }, [form, runtimeSessionId]);

  React.useEffect(() => {
    const unlockLeft = Number(config?.runtimeConfig?.unlockLeftSec || 0);
    if (!unlockLeft) return undefined;
    const id = window.setInterval(() => {
      onConfigReload?.().catch(() => {});
    }, 1000);
    return () => window.clearInterval(id);
  }, [config?.runtimeConfig?.unlockLeftSec, onConfigReload]);

  const chains = Array.isArray(config?.chains) ? config.chains : [];
  const selectedChain = chains.find((chain) => chain.id === form.chainKey) || chains[0] || null;
  const runtimeStatus = config?.runtimeConfig || {};
  const runtimeConfigured = !!runtimeStatus.configured;
  const runtimeUnlocked = !!runtimeStatus.unlocked;
  const unlockLeftSec = Number(runtimeStatus.unlockLeftSec || 0);
  const envSecrets = config?.envSecrets || {};
  const envSecretsMeta = envSecrets?.publicMeta || {};
  const envOwnerConfigured = !!envSecretsMeta.hasXdalaOwnerPrivateKey;
  const envAgentConfigured = !!envSecretsMeta.hasXdalaAgentPrivateKey;
  const envOpenAiConfigured = !!envSecretsMeta.hasOpenAiApiKey;
  const envGeminiConfigured = !!envSecretsMeta.hasGeminiApiKey;
  const envOwnerAddress = normalizeAddress(envSecretsMeta.ownerAddress || '');
  const envOwnerReady = !!envSecrets.unlocked && envOwnerConfigured;
  const envAgentReady = !!envSecrets.unlocked && envAgentConfigured;
  const selectedProviderKeyConfigured = form.aiProvider === 'mock'
    || (form.aiProvider === 'openai' && (!!String(form.openaiApiKey || '').trim() || !!runtimeStatus.publicConfig?.hasOpenAiRuntimeKey || envOpenAiConfigured))
    || (form.aiProvider === 'gemini' && (!!String(form.geminiApiKey || '').trim() || !!runtimeStatus.publicConfig?.hasGeminiRuntimeKey || envGeminiConfigured));
  const selectedProviderKeyUsable = form.aiProvider === 'mock'
    || (form.aiProvider === 'openai' && (!!String(form.openaiApiKey || '').trim() || (runtimeUnlocked && !!runtimeStatus.publicConfig?.hasOpenAiRuntimeKey) || (!!envSecrets.unlocked && envOpenAiConfigured)))
    || (form.aiProvider === 'gemini' && (!!String(form.geminiApiKey || '').trim() || (runtimeUnlocked && !!runtimeStatus.publicConfig?.hasGeminiRuntimeKey) || (!!envSecrets.unlocked && envGeminiConfigured)));
  const xdalaKeysConfigured = (!!form.ownerPrivateKey || runtimeConfigured || envOwnerConfigured) && (!!form.agentPrivateKey || runtimeConfigured || envAgentConfigured);
  const xdalaKeysUsable = (!!form.ownerPrivateKey && !!form.agentPrivateKey) || runtimeUnlocked || (envOwnerReady && envAgentReady);
  const liveWaiter = config?.liveWaiter || null;

  const expectedWalletChainId = normalizeHexChainId(selectedChain?.chainIdHex || selectedChain?.walletConfig?.chainId);
  const connectedWalletChainId = normalizeHexChainId(wallet?.chainId);
  const connectedWalletAddress = normalizeAddress(wallet?.address);
  const typedOwnerKeyAddress = addressFromPrivateKey(form.ownerPrivateKey);
  const savedOwnerAddress = normalizeAddress(runtimeStatus?.publicConfig?.ownerAddress);
  const ownerKeyAddress = typedOwnerKeyAddress || savedOwnerAddress || (envOwnerReady ? envOwnerAddress : '');
  const ownerAddressLabel = envOwnerAddress
    ? maskAddress(envOwnerAddress)
    : envOwnerConfigured
      ? secretStateLabel(true)
      : 'enter owner key';
  const hasConnectedWallet = /^0x[0-9a-f]{40}$/.test(connectedWalletAddress);
  const walletChainMatches = !!connectedWalletChainId && !!expectedWalletChainId && connectedWalletChainId === expectedWalletChainId;
  const walletOwnerMatches = !!connectedWalletAddress && !!ownerKeyAddress && connectedWalletAddress === ownerKeyAddress;
  const walletReady = hasConnectedWallet && walletChainMatches && walletOwnerMatches;
  const validOrchestrationAddress = /^0x[0-9a-fA-F]{40}$/.test(String(form.orchestrationAddress || '').trim());
  const hasOstcId = !!String(form.ostcId || '').trim();
  const ostcHashValue = String(form.ostcHash || '').trim();
  const isZeroOstcHash = /^0x0{64}$/i.test(ostcHashValue);
  const validOstcHash = /^0x[0-9a-fA-F]{64}$/.test(ostcHashValue) && !isZeroOstcHash;
  const hasStartStep = !!String(form.startStepId || '').trim();
  const hasWaitStep = !!String(form.waitStepId || '').trim();
  const step1Ok = hasConnectedWallet && walletChainMatches;
  const resultSchemaError = React.useMemo(() => validateResultSchemaText(form.resultSchemaText), [form.resultSchemaText]);
  const hasValidResultSchema = !resultSchemaError;
  const resultFields = React.useMemo(() => resultFieldsFromSchemaText(form.resultSchemaText), [form.resultSchemaText]);
  const schemaCheckKey = React.useMemo(() => JSON.stringify({
    rpcUrl: String(form.rpcUrl || '').trim(),
    orchestrationAddress: normalizeAddress(form.orchestrationAddress),
    ostcId: String(form.ostcId || '').trim(),
    waitStepId: String(form.waitStepId || '').trim(),
    resultSchemaText: String(form.resultSchemaText || '').trim(),
    ostcHash: String(form.ostcHash || '').trim().toLowerCase(),
  }), [form.rpcUrl, form.orchestrationAddress, form.ostcId, form.waitStepId, form.resultSchemaText, form.ostcHash]);
  const xrc729ConfigOk = validOrchestrationAddress && hasOstcId && validOstcHash && hasStartStep && hasWaitStep;
  const schemaCheckStale = !!schemaCheck && schemaCheck.key !== schemaCheckKey;
  const schemaCheckResult = !schemaCheckStale && schemaCheck?.key === schemaCheckKey ? schemaCheck.result : null;
  const schemaCheckOk = !!schemaCheckResult?.ok;
  const schemaCheckMismatch = !!schemaCheckResult && !schemaCheckResult.ok;
  const schemaCheckMissing = xrc729ConfigOk && hasValidResultSchema && !schemaCheck;
  const resultSchemaNeedsCheck = xrc729ConfigOk && hasValidResultSchema && (schemaCheckMissing || schemaCheckStale || schemaCheckMismatch);
  const step2Ok = xrc729ConfigOk && schemaCheckOk;
  const step2StatusLabel = step2Ok
    ? 'done'
    : !validOrchestrationAddress
      ? 'missing address'
      : !hasOstcId
        ? 'missing OSTC ID'
        : !validOstcHash
          ? (isZeroOstcHash ? 'calculate hash' : 'missing hash')
          : !hasStartStep
            ? 'missing start step'
            : !hasWaitStep
              ? 'missing wait step'
              : schemaCheckStale
                ? 're-check waiter'
                : schemaCheckMismatch
                  ? 'schema mismatch'
                  : 'check waiter';
  const step3Ok = hasValidResultSchema && selectedProviderKeyUsable;
  const documentUpload = config?.documentUpload || null;
  const hasOwnerSecretForSave = !!form.ownerPrivateKey || runtimeConfigured || envOwnerReady;
  const hasAgentSecretForSave = !!form.agentPrivateKey || runtimeConfigured || envAgentReady;
  const combinedCredentialsOk = step3Ok && xdalaKeysUsable;
  const combinedCredentialsStatusLabel = combinedCredentialsOk
    ? 'ready'
    : !hasValidResultSchema
      ? 'fix schema'
      : !selectedProviderKeyConfigured
        ? 'AI key needed'
        : !selectedProviderKeyUsable
          ? 'unlock AI key'
          : !xdalaKeysConfigured
            ? 'XDaLa keys needed'
            : !xdalaKeysUsable
              ? 'unlock XDaLa keys'
              : 'needed';
  const step4CanSave = walletReady && step2Ok && !!form.runtimePassword && hasOwnerSecretForSave && hasAgentSecretForSave;

  function assertWalletReadyForLive() {
    if (!connectedWalletAddress) {
      throw new Error('Connect the browser wallet first. It must be the same wallet as the owner private key.');
    }
    if (!walletChainMatches) {
      throw new Error(`Wallet is on ${connectedWalletChainId || 'unknown chain'}, but selected network requires ${expectedWalletChainId}. Click "Connect selected network wallet" so the wallet is switched first.`);
    }
    if (!walletOwnerMatches) {
      throw new Error('Connected wallet does not match the owner private key. Use the owner wallet or paste the matching owner key.');
    }
  }

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateResultField(index, patch) {
    const nextFields = resultFields.map((field, idx) => {
      if (idx !== index) return field;
      const next = { ...field, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'name')) next.name = normalizeFieldName(patch.name);
      return next;
    });
    setField('resultSchemaText', schemaTextFromResultFields(nextFields));
  }

  function addResultField() {
    const base = 'documentReason';
    const names = new Set(resultFields.map((field) => String(field.name || '')));
    let name = base;
    let i = 2;
    while (names.has(name)) {
      name = `${base}${i}`;
      i += 1;
    }
    setField('resultSchemaText', schemaTextFromResultFields([
      ...resultFields,
      { name, xrcType: 'string', description: 'Short reason or context extracted from the document.', required: false, validationMode: 'none', validationValue: '' },
    ]));
  }

  function removeResultField(index) {
    setField('resultSchemaText', schemaTextFromResultFields(resultFields.filter((_, idx) => idx !== index)));
  }

  function selectChain(chainKey) {
    const chain = chains.find((item) => item.id === chainKey);
    setForm((current) => ({
      ...current,
      chainKey,
      rpcUrl: chain?.rpcUrl || current.rpcUrl,
      explorerUrl: chain?.explorerUrl || current.explorerUrl,
    }));
  }

  async function ensureSelectedWalletChain() {
    if (!window.ethereum?.request) throw new Error('No browser wallet found. Install MetaMask or a compatible wallet.');
    if (!selectedChain?.walletConfig?.chainId) throw new Error('No chain selected.');

    const targetChainId = normalizeHexChainId(selectedChain.walletConfig.chainId);
    let currentChainId = normalizeHexChainId(await window.ethereum.request({ method: 'eth_chainId' }));

    if (currentChainId !== targetChainId) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: selectedChain.walletConfig.chainId }],
        });
      } catch (switchError) {
        const code = Number(switchError?.code || switchError?.data?.originalError?.code || 0);
        if (code !== 4902) throw switchError;
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [selectedChain.walletConfig],
        });
      }
      currentChainId = normalizeHexChainId(await window.ethereum.request({ method: 'eth_chainId' }));
    }

    if (currentChainId !== targetChainId) {
      throw new Error(`Wallet still reports ${currentChainId || 'unknown chain'} after switch. Expected ${targetChainId}. Please confirm the network switch in your wallet.`);
    }
    return currentChainId;
  }

  async function connectWallet() {
    setError('');
    setMessage('');
    try {
      const currentChainId = await ensureSelectedWalletChain();
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0] || '';
      if (!address) throw new Error('Wallet did not return an account. Please unlock your wallet and try again.');
      setWallet({ address, chainId: currentChainId });
      setMessage(`Wallet connected on ${selectedChain.label}. Now paste the matching owner private key and save/unlock.`);
    } catch (err) {
      setError(err.message || 'Could not connect wallet.');
    }
  }

  async function switchWalletChain() {
    setError('');
    setMessage('');
    try {
      const currentChainId = await ensureSelectedWalletChain();
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      setWallet({ address: accounts?.[0] || wallet?.address || '', chainId: currentChainId });
      setMessage(`Wallet switched to ${selectedChain.label}.`);
    } catch (err) {
      setError(err.message || 'Could not switch wallet chain.');
    }
  }

  async function calculateOstcHash() {
    setError('');
    setOstcHashError('');
    setMessage('');
    setOstcHashCalculating(true);
    try {
      const params = new URLSearchParams();
      if (form.rpcUrl) params.set('rpcUrl', form.rpcUrl);
      if (form.orchestrationAddress) params.set('orchestrationAddress', form.orchestrationAddress);
      if (form.ostcId) params.set('ostcId', form.ostcId);
      const response = await fetch(`/api/xdala/ostc-hash?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not calculate OSTC hash.');
      setField('ostcHash', payload.ostcHash);
      setMessage('OSTC hash calculated from the deployed XRC-729 contract.');
    } catch (err) {
      const message = err.message || 'Could not calculate OSTC hash.';
      setOstcHashError(message);
      setError(message);
    } finally {
      setOstcHashCalculating(false);
    }
  }

  async function checkWaiterSchema() {
    setError('');
    setMessage('');
    setSchemaChecking(true);
    try {
      if (!xrc729ConfigOk) throw new Error('Complete XRC-729 address, OSTC ID, OSTC hash, start step, and wait step first.');
      if (resultSchemaError) throw new Error(`Fix the result schema first: ${resultSchemaError}`);
      const payload = await postJson('/api/xdala/check-waiter-schema', {
        rpcUrl: form.rpcUrl,
        orchestrationAddress: form.orchestrationAddress,
        ostcId: form.ostcId,
        waitStepId: form.waitStepId,
        schemaText: form.resultSchemaText,
        ostcHash: form.ostcHash,
      }, runtimeSessionId);
      setSchemaCheck({ key: schemaCheckKey, result: payload.result });
      setMessage(payload.result?.ok
        ? `Wait step schema is compatible. Rule ${maskAddress(payload.result.ruleAddress)} contains all required payload fields.`
        : 'Wait step schema mismatch. Download the configured bundle, deploy it, paste the new XRC-729 address, calculate the hash again, and re-check.');
    } catch (err) {
      setSchemaCheck({ key: schemaCheckKey, result: { ok: false, error: err.message || 'Waiter schema check failed.' } });
      setError(err.message || 'Waiter schema check failed.');
    } finally {
      setSchemaChecking(false);
    }
  }

  async function downloadConfiguredBundle() {
    setError('');
    setMessage('');
    try {
      const schemaError = validateResultSchemaText(form.resultSchemaText);
      if (schemaError) throw new Error(`Fix the result schema before downloading the configured bundle: ${schemaError}`);
      await downloadJsonFromPost('/api/downloads/waiter-bundle-configured', {
        schemaText: form.resultSchemaText,
        ostcId: form.ostcId || 'document_agent_waiter_flow',
      }, 'document-agent-waiter.configured.multi-bundle.json', runtimeSessionId);
      setMessage('Configured waiter bundle downloaded from the current result schema. Deploy it in xDaLaWeb, then calculate the OSTC hash again.');
    } catch (err) {
      setError(err.message || 'Could not download configured waiter bundle.');
    }
  }

  function buildRuntimePayload() {
    return {
      chainKey: form.chainKey,
      chainId: form.chainKey,
      rpcUrl: form.rpcUrl,
      explorerUrl: form.explorerUrl,
      orchestrationAddress: form.orchestrationAddress,
      ostcId: form.ostcId,
      ostcHash: form.ostcHash,
      startStepId: form.startStepId,
      waitStepId: form.waitStepId,
      aiProvider: form.aiProvider,
      openaiModel: form.openaiModel,
      openaiApiKey: form.openaiApiKey,
      geminiModel: form.geminiModel,
      geminiApiKey: form.geminiApiKey,
      documentApiUrl: form.documentApiUrl,
      documentApiKey: form.documentApiKey,
      customDocumentText: form.customDocumentText,
      customInstructions: form.customInstructions,
      resultSchemaText: form.resultSchemaText,
      ownerPrivateKey: form.ownerPrivateKey,
      agentPrivateKey: form.agentPrivateKey,
      password: form.runtimePassword,
      connectedWalletAddress,
      connectedWalletChainId,
      unlockTtlSec: Math.round(Number(form.unlockTtlMinutes || 20) * 60),
    };
  }

  async function saveRuntimeConfig() {
    setError('');
    setMessage('');
    try {
      assertWalletReadyForLive();
      await postJson('/api/runtime-config', buildRuntimePayload(), runtimeSessionId);
      setForm((current) => ({ ...current, ownerPrivateKey: '', agentPrivateKey: '', openaiApiKey: '', geminiApiKey: '', documentApiKey: '', runtimePassword: '' }));
      setShowSecrets({ owner: false, agent: false, openai: false, gemini: false, document: false, password: false });
      setMessage('Runtime config saved and unlocked in backend memory. Secret fields were cleared.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not save runtime config.');
    }
  }

  async function unlockRuntimeConfig() {
    setError('');
    setMessage('');
    try {
      await postJson('/api/runtime-config/unlock', {
        password: form.runtimePassword,
        unlockTtlSec: Math.round(Number(form.unlockTtlMinutes || 20) * 60),
      }, runtimeSessionId);
      setForm((current) => ({ ...current, ownerPrivateKey: '', agentPrivateKey: '', openaiApiKey: '', geminiApiKey: '', documentApiKey: '', runtimePassword: '' }));
      setShowSecrets({ owner: false, agent: false, openai: false, gemini: false, document: false, password: false });
      setMessage('Runtime config unlocked in backend memory. Secret fields were cleared.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not unlock runtime config.');
    }
  }

  async function lockRuntimeConfig() {
    setError('');
    setMessage('');
    try {
      await postJson('/api/runtime-config/lock', {}, runtimeSessionId);
      setMessage('Runtime keys locked.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not lock runtime config.');
    }
  }

  async function clearRuntimeConfig() {
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/runtime-config', {
        method: 'DELETE',
        headers: { 'x-xgr-agent-session': runtimeSessionId },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setForm((current) => ({ ...current, ownerPrivateKey: '', agentPrivateKey: '', openaiApiKey: '', geminiApiKey: '', documentApiKey: '', runtimePassword: '' }));
      setShowSecrets({ owner: false, agent: false, openai: false, gemini: false, document: false, password: false });
      setMessage('Runtime config cleared from backend memory for this browser tab.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not clear runtime config.');
    }
  }

  async function startLiveWaiter() {
    if (waiterStarting) return;
    setError('');
    setMessage('');
    setWaiterStarting(true);
    try {
      await postJson('/api/live/start-waiter', { timeoutMs: 60000, pollMs: 2000 }, runtimeSessionId);
      setMessage('Live waiter started and reached the waiting step. Continue with Run AI wakeup below.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not start live waiter session.');
    } finally {
      setWaiterStarting(false);
    }
  }

  async function refreshLiveWaiter() {
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/live/waiter', {
        headers: { 'x-xgr-agent-session': runtimeSessionId },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setMessage('Live waiter status refreshed.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not refresh waiter status.');
    }
  }


  async function saveManualDocumentText() {
    setError('');
    setMessage('');
    try {
      await postJson('/api/document/text', { text: form.customDocumentText, name: 'manual-document.txt' }, runtimeSessionId);
      setMessage('Manual document text saved for this browser tab.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not save manual document text.');
    }
  }

  async function uploadDocumentFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setMessage('');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      await postJson('/api/document/upload', {
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        base64: btoa(binary),
      }, runtimeSessionId);
      setField('customDocumentText', '');
      setMessage(`Uploaded ${file.name}. This document will be used before manual text, API URL, or built-in sample.`);
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not upload document.');
    } finally {
      event.target.value = '';
    }
  }

  async function clearUploadedDocument() {
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/document/upload', {
        method: 'DELETE',
        headers: { 'x-xgr-agent-session': runtimeSessionId },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setField('customDocumentText', defaultDocumentText());
      setMessage('Uploaded/manual document cleared. The example text is active again.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not clear uploaded document.');
    }
  }

  async function clearLiveWaiter() {
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/live/waiter', {
        method: 'DELETE',
        headers: { 'x-xgr-agent-session': runtimeSessionId },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setMessage('Live waiter cleared for this browser tab.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not clear waiter session.');
    }
  }

  return (
    <section className="panel-card live-setup-card">
      <div className="section-header compact">
        <div>
          <div className="eyebrow">Configure first</div>
          <div className="title-with-help">
            <h2>Live XDaLa setup and AI Agent credentials</h2>
            <HelpPill label="Deployment flow" title="Recommended setup order">
              <p>Download the configured waiter bundle whenever you change the AI result schema or XRC-137 validation logic.</p>
              <p>Deploy the bundle in xDaLaWeb, calculate the on-chain OSTC hash, save or unlock the credentials, start the waiter session, and finally run the AI wakeup.</p>
            </HelpPill>
          </div>
        </div>
        <div className={`run-status ${runtimeUnlocked ? 'completed' : ''}`}>
          {runtimeUnlocked ? `unlocked ${formatUnlockTime(unlockLeftSec)}` : runtimeConfigured ? 'locked' : 'not configured'}
        </div>
      </div>

      <div className="download-row">
        <button className="secondary-button" type="button" onClick={downloadConfiguredBundle}>Download configured waiter bundle</button>
        <a className="secondary-button" href="/api/downloads/waiter-bundle">Download default bundle</a>
        <a className="secondary-button" href="/api/downloads/waiter-start-payload">Download start payload</a>
        <a className="secondary-button" href="/api/downloads/chain-config">Download chain config</a>
      </div>

      <SetupStep
        number="1"
        title="Select network and connect the owner wallet"
        helpContent={(
          <>
            <p>The browser wallet must use the selected network.</p>
            <p>Later, the connected wallet must match the owner private key that starts the waiter session.</p>
          </>
        )}
        ok={step1Ok}
        waiting={!step1Ok}
      >
        <div className="form-grid">
          <label>
            <span>Network</span>
            <select value={form.chainKey} onChange={(event) => selectChain(event.target.value)}>
              {chains.map((chain) => <option key={chain.id} value={chain.id}>{chain.label}</option>)}
            </select>
          </label>
          <label>
            <span>RPC URL</span>
            <input value={form.rpcUrl} onChange={(event) => setField('rpcUrl', event.target.value)} />
          </label>
          <label>
            <span>Explorer URL</span>
            <input value={form.explorerUrl} onChange={(event) => setField('explorerUrl', event.target.value)} />
          </label>
        </div>
        <div className="wallet-row">
          <button className="primary-button" type="button" onClick={connectWallet}>Connect selected network wallet</button>
          <button className="secondary-button" type="button" onClick={switchWalletChain}>Switch/add selected chain</button>
          <div className="wallet-check-grid">
            <div className={`wallet-check ${hasConnectedWallet ? 'ok' : ''}`}>
              <span>Wallet</span>
              <strong>{hasConnectedWallet ? maskAddress(connectedWalletAddress) : 'not connected'}</strong>
            </div>
            <div className={`wallet-check ${walletChainMatches ? 'ok' : hasConnectedWallet ? 'bad' : ''}`}>
              <span>Network</span>
              <strong>{hasConnectedWallet ? `${connectedWalletChainId || 'unknown'} / expected ${expectedWalletChainId || '?'}` : expectedWalletChainId || 'select network'}</strong>
            </div>
          </div>
        </div>
      </SetupStep>

      <SetupStep
        number="2"
        title="Configure the deployed XRC-729 waiter"
        helpContent={(
          <>
            <p>Paste the deployed waiter contract address and the OSTC ID from your XRC-729 deployment.</p>
            <p>Then calculate the real OSTC hash from chain so the live demo matches the deployed waiter.</p>
          </>
        )}
        ok={step2Ok}
        waiting={!step2Ok}
        statusLabel={step2StatusLabel}
      >
        <div className="form-grid contract-config-grid">
          <label className={!validOrchestrationAddress ? 'attention-field' : ''}>
            <span>XRC-729 address</span>
            <input placeholder="0x..." value={form.orchestrationAddress} onChange={(event) => setField('orchestrationAddress', event.target.value)} />
            {!validOrchestrationAddress && <small className="attention-note">Paste the deployed XRC-729 contract address.</small>}
          </label>
          <label className={!hasOstcId ? 'attention-field' : ''}>
            <span>OSTC ID</span>
            <input value={form.ostcId} onChange={(event) => setField('ostcId', event.target.value)} />
            {!hasOstcId && <small className="attention-note">Enter the OSTC ID deployed in the XRC-729 contract.</small>}
          </label>
          <label className={!validOstcHash ? 'attention-field' : ''}>
            <span>OSTC hash</span>
            <div className="inline-field-action">
              <input value={form.ostcHash} onChange={(event) => setField('ostcHash', event.target.value)} />
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={calculateOstcHash}
                disabled={ostcHashCalculating}
              >
                {ostcHashCalculating ? 'Calculating...' : 'Calculate'}
              </button>
            </div>
            <small className="field-hint">Uses RPC + XRC-729 address + OSTC ID, so it matches Manage Sessions after deployment.</small>
            {ostcHashError && <small className="attention-note">{ostcHashError}</small>}
            {!validOstcHash && (
              <small className="attention-note">
                {isZeroOstcHash ? 'The zero hash is only a placeholder. Press Calculate after deployment or paste the real on-chain OSTC hash.' : 'Calculate or paste the real 0x32-byte OSTC hash.'}
              </small>
            )}
          </label>
          <label className={!hasStartStep ? 'attention-field' : ''}>
            <span>Start step</span>
            <input value={form.startStepId} onChange={(event) => setField('startStepId', event.target.value)} />
            {!hasStartStep && <small className="attention-note">Enter the waiter start step.</small>}
          </label>
          <label className={!hasWaitStep ? 'attention-field' : ''}>
            <span>Wait step</span>
            <input value={form.waitStepId} onChange={(event) => setField('waitStepId', event.target.value)} />
            {!hasWaitStep && <small className="attention-note">Enter the step that the AI agent will wake.</small>}
          </label>
        </div>

        <div className={`schema-check-card ${schemaCheckOk ? 'ok' : schemaCheckMismatch ? 'bad' : ''}`}>
          <div>
            <div className="title-with-help">
              <strong>Wait step compatibility check</strong>
              <HelpPill label="What is checked?" title="On-chain wait step validation">
                <p>The demo loads the deployed XRC-729 from chain, resolves the rule address for <code>{form.waitStepId || 'WAIT_FOR_DOCUMENT'}</code>, and reads that XRC-137 via <code>getRule()</code>.</p>
                <p>It checks required payload fields, payload types, and the generated XRC-137 validation rules before you run the live demo.</p>
              </HelpPill>
            </div>
            {schemaCheckResult?.ruleAddress && (
              <div className="kv-list compact-kv">
                <div><span>Rule address</span><code>{schemaCheckResult.ruleAddress}</code></div>
              </div>
            )}
            {schemaCheckResult && schemaCheckResult.ostcHashMatches === false && (
              <div className="attention-note">OSTC hash mismatch. Expected {schemaCheckResult.expectedOstcHash}, but the field contains {schemaCheckResult.providedOstcHash || 'nothing'}.</div>
            )}
            {schemaCheckResult?.missing?.length > 0 && (
              <div className="attention-note">Missing fields: {schemaCheckResult.missing.map((item) => `${item.key}:${item.expectedType}`).join(', ')}</div>
            )}
            {schemaCheckResult?.mismatched?.length > 0 && (
              <div className="attention-note">Type mismatches: {schemaCheckResult.mismatched.map((item) => `${item.key} expected ${item.expectedType}, got ${item.actualType}`).join(', ')}</div>
            )}
            {schemaCheckResult?.missingRules?.length > 0 && (
              <div className="attention-note">Missing XRC-137 rules: {schemaCheckResult.missingRules.join(' · ')}</div>
            )}
            {schemaCheckResult?.extra?.length > 0 && (
              <div className="attention-note">Extra fields: {schemaCheckResult.extra.map((item) => `${item.key}:${item.actualType}`).join(', ')}</div>
            )}
            {schemaCheckResult?.extraRules?.length > 0 && (
              <div className="attention-note">Extra XRC-137 rules: {schemaCheckResult.extraRules.join(' · ')}</div>
            )}
            {schemaCheckResult?.error && <div className="attention-note">{schemaCheckResult.error}</div>}
            {schemaCheckMismatch && (
              <div className="schema-mismatch-actions">
                <button className="secondary-button" type="button" onClick={downloadConfiguredBundle}>Download configured waiter bundle</button>
                <span className="muted">Deploy this bundle, then calculate the OSTC hash again and re-run this check.</span>
              </div>
            )}
          </div>
          <button className="primary-button" type="button" onClick={checkWaiterSchema} disabled={!xrc729ConfigOk || !hasValidResultSchema || schemaChecking}>
            {schemaChecking ? 'Checking...' : schemaCheckOk ? 'Re-check wait step' : 'Check wait step schema'}
          </button>
        </div>
      </SetupStep>

      <SetupStep
        number="3"
        title="Configure AI, document source, and encrypted credentials"
        helpContent={(
          <>
            <p>This combined step keeps both key-heavy areas together: AI/document configuration and the encrypted XDaLa runtime credentials.</p>
            <p>Both AI keys and XDaLa keys can come from the encrypted .env bundle or be saved as browser-tab-local runtime secrets.</p>
          </>
        )}
        ok={combinedCredentialsOk}
        waiting={!combinedCredentialsOk}
        statusLabel={combinedCredentialsStatusLabel}
      >
        <EnvSecretsSummary envSecrets={envSecrets} />

        <div className="setup-pill-row">
          <span className={`setup-step-pill ${selectedProviderKeyUsable ? 'done' : selectedProviderKeyConfigured ? 'waiting' : ''}`}>
            AI provider key {selectedProviderKeyUsable ? 'ready' : selectedProviderKeyConfigured ? 'unlock needed' : 'missing'}
          </span>
          <span className={`setup-step-pill ${xdalaKeysUsable ? 'done' : xdalaKeysConfigured ? 'waiting' : ''}`}>
            XDaLa keys {xdalaKeysUsable ? 'ready' : xdalaKeysConfigured ? 'unlock needed' : 'missing'}
          </span>
        </div>

        <div className="custom-agent-config">
          <div className="subsection-title-row">
          <div>
            <div className="form-section-title">AI provider and document source</div>
          </div>
          <HelpPill label="Source rules" title="How document input works">
            <p>The selected AI provider receives only the document content plus the field names, JSON types, descriptions, and AI required flags from the schema editor below.</p>
            <p>You can use a browser upload, saved manual text, a document API URL, or the built-in sample document.</p>
          </HelpPill>
        </div>
        <div className="form-grid">
          <label>
            <span>AI provider</span>
            <select value={form.aiProvider} onChange={(event) => setField('aiProvider', event.target.value)}>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="mock">Static demo result</option>
            </select>
          </label>
          {form.aiProvider === 'openai' && (
            <>
              <label>
                <span>OpenAI model</span>
                <input value={form.openaiModel} onChange={(event) => setField('openaiModel', event.target.value)} />
              </label>
              <SecretInput
                label="OpenAI API key"
                value={form.openaiApiKey}
                visible={showSecrets.openai}
                onToggle={() => setShowSecrets((current) => ({ ...current, openai: !current.openai }))}
                onChange={(value) => setField('openaiApiKey', value)}
                placeholder={runtimeStatus?.publicConfig?.hasOpenAiRuntimeKey ? 'Leave empty to keep saved key' : 'sk-... or leave empty to use .env'}
              />
            </>
          )}
          {form.aiProvider === 'gemini' && (
            <>
              <label>
                <span>Gemini model</span>
                <input value={form.geminiModel} onChange={(event) => setField('geminiModel', event.target.value)} />
              </label>
              <SecretInput
                label="Gemini API key"
                value={form.geminiApiKey}
                visible={showSecrets.gemini}
                onToggle={() => setShowSecrets((current) => ({ ...current, gemini: !current.gemini }))}
                onChange={(value) => setField('geminiApiKey', value)}
                placeholder={runtimeStatus?.publicConfig?.hasGeminiRuntimeKey ? 'Leave empty to keep saved key' : 'AIza... or leave empty to use .env'}
              />
            </>
          )}
          {form.aiProvider === 'mock' && (
            <div className="inline-help-row">
              <HelpPill label="Mock provider details" title="Static demo mode">
                <p>The mock provider returns fixed sample data.</p>
                <p>It does not parse the uploaded document and it does not call an external AI API.</p>
              </HelpPill>
            </div>
          )}
          <label>
            <span>Document API URL</span>
            <input value={form.documentApiUrl} onChange={(event) => setField('documentApiUrl', event.target.value)} placeholder="Leave empty for built-in sample" />
          </label>
          <SecretInput
            label="Document API key"
            value={form.documentApiKey}
            visible={showSecrets.document}
            onToggle={() => setShowSecrets((current) => ({ ...current, document: !current.document }))}
            onChange={(value) => setField('documentApiKey', value)}
            placeholder={runtimeStatus?.publicConfig?.hasDocumentApiKey ? 'Leave empty to keep saved key' : 'Bearer token, optional'}
          />
        </div>
        {form.aiProvider === 'openai' && <div className="field-note">OpenAI API keys are encrypted with the runtime password in backend memory.</div>}
        {form.aiProvider === 'gemini' && <div className="field-note">Gemini API keys are encrypted with the runtime password in backend memory.</div>}
        </div>

        <div className="custom-agent-config">
          <div className="subsection-title-row">
          <div>
            <div className="form-section-title">Encrypted XDaLa credentials</div>
          </div>
          <HelpPill label="Key handling" title="Owner and agent keys">
            <p>The owner key starts the waiter session and must match the connected browser wallet.</p>
            <p>The agent key signs the wakeup permit. Both keys can come from the encrypted .env bundle or from this runtime form.</p>
          </HelpPill>
        </div>
        <div className="form-grid secrets-grid">
          <SecretInput
            label="Owner private key"
            value={form.ownerPrivateKey}
            visible={showSecrets.owner}
            onToggle={() => setShowSecrets((current) => ({ ...current, owner: !current.owner }))}
            onChange={(value) => setField('ownerPrivateKey', value)}
            placeholder={envOwnerConfigured ? 'Already configured in encrypted .env; leave empty unless overriding' : runtimeConfigured ? 'Leave empty to keep saved key' : 'Starts the waiter session'}
          />
          <SecretInput
            label="Agent private key"
            value={form.agentPrivateKey}
            visible={showSecrets.agent}
            onToggle={() => setShowSecrets((current) => ({ ...current, agent: !current.agent }))}
            onChange={(value) => setField('agentPrivateKey', value)}
            placeholder={envAgentConfigured ? 'Already configured in encrypted .env; leave empty unless overriding' : runtimeConfigured ? 'Leave empty to keep saved key' : 'Signs the wakeup permit'}
          />
          <SecretInput
            label="Runtime password"
            value={form.runtimePassword}
            visible={showSecrets.password}
            onToggle={() => setShowSecrets((current) => ({ ...current, password: !current.password }))}
            onChange={(value) => setField('runtimePassword', value)}
            placeholder="Min. 8 characters"
          />
          <label>
            <span>Unlock time in minutes</span>
            <input type="number" min="1" max="1440" value={form.unlockTtlMinutes} onChange={(event) => setField('unlockTtlMinutes', event.target.value)} />
          </label>
        </div>
        <div className="wallet-check-grid owner-check-grid">
          <div className={`wallet-check ${ownerKeyAddress ? 'ok' : ''}`}>
            <span>Owner key address</span>
            <strong>{ownerKeyAddress ? maskAddress(ownerKeyAddress) : ownerAddressLabel}</strong>
          </div>
          <div className={`wallet-check ${walletOwnerMatches ? 'ok' : ownerKeyAddress && hasConnectedWallet ? 'bad' : ''}`}>
            <span>Owner key match</span>
            <strong>{walletOwnerMatches ? (envOwnerReady && !typedOwnerKeyAddress && !savedOwnerAddress ? 'matches encrypted .env owner' : 'matches connected wallet') : envOwnerConfigured && !envSecrets.unlocked ? 'unlock encrypted server secrets first' : hasConnectedWallet ? 'must match connected wallet' : 'connect wallet first'}</strong>
          </div>
        </div>
        <div className="hero-actions small-actions">
          <button className="primary-button" type="button" onClick={saveRuntimeConfig} disabled={!step4CanSave}>Save and unlock</button>
          <button className="secondary-button" type="button" onClick={unlockRuntimeConfig} disabled={!runtimeConfigured}>Unlock saved keys</button>
          <button className="secondary-button" type="button" onClick={lockRuntimeConfig} disabled={!runtimeUnlocked}>Lock now</button>
          <button className="secondary-button" type="button" onClick={clearRuntimeConfig}>Clear this tab</button>
        </div>
        </div>

        <div className="custom-agent-config">
          <div className="subsection-title-row">
            <div className="form-section-title">Configurable customer workflow</div>
            <HelpPill label="What changes here?" title="AI workflow customization">
              <p>Change the agent instructions, manual document text, and result schema.</p>
              <p>XRC-137 payload types and rule checks are used for the generated waiter bundle and the wait step compatibility check.</p>
              <p>After schema changes, download and deploy the configured waiter bundle again and calculate the new OSTC hash.</p>
            </HelpPill>
          </div>
          {resultSchemaNeedsCheck && (
            <div className="error-box inline-error schema-warning-box">
              <div>
                {schemaCheckStale
                  ? 'Result parameters or live XDaLa settings changed after the last compatibility check. Download and deploy the configured waiter bundle again when needed, then calculate the OSTC hash and re-check the wait step schema before running the demo.'
                  : schemaCheckMismatch
                    ? 'The deployed wait step does not match the current result schema. Download and deploy the configured waiter bundle again, calculate the OSTC hash, and re-check the wait step schema before running the demo.'
                    : 'Run the wait step compatibility check before running the demo.'}
              </div>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={checkWaiterSchema}
                disabled={schemaChecking || !xrc729ConfigOk || !hasValidResultSchema}
              >
                {schemaChecking ? 'Checking...' : 'Re-check wait step'}
              </button>
            </div>
          )}
          {schemaCheckOk && (
            <div className="success-box">
              The deployed wait step matches the current result schema and XRC-137 validation rules.
            </div>
          )}
          <label className="wide-label">
            <span>Agent instructions / prompt</span>
            <textarea value={form.customInstructions} onChange={(event) => setField('customInstructions', event.target.value)} rows={7} />
          </label>
          <div className={`result-field-editor ${resultSchemaError ? 'attention-field' : ''}`}>
            <div className="result-field-editor-head">
              <div className="title-with-help">
                <strong>AI result fields and XRC-137 validation</strong>
                <HelpPill label="Field mapping" title="How result fields are used">
                  <p>AI fields define what the provider must return.</p>
                  <p>XRC-137 types and rule checks define what the deployed WAIT rule validates on-chain.</p>
                </HelpPill>
              </div>
              <button className="secondary-button compact-button" type="button" onClick={addResultField}>Add field</button>
            </div>
            <div className="result-field-list">
              {resultFields.map((field, index) => (
                <div className="result-field-row" key={`${field.name || 'field'}-${index}`}>
                  <label>
                    <span>Field name</span>
                    <input value={field.name} onChange={(event) => updateResultField(index, { name: event.target.value })} placeholder="documentReason" />
                  </label>
                  <label>
                    <span>XRC-137 type</span>
                    <select value={field.xrcType} onChange={(event) => updateResultField(index, { xrcType: event.target.value })}>
                      {XRC137_PAYLOAD_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="result-field-description">
                    <span>Description for the AI</span>
                    <input value={field.description} onChange={(event) => updateResultField(index, { description: event.target.value })} placeholder="What should the AI extract?" />
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={!!field.required} onChange={(event) => updateResultField(index, { required: event.target.checked })} />
                    <span>AI required</span>
                  </label>
                  <label>
                    <span>XRC-137 rule check</span>
                    <select value={field.validationMode || 'none'} onChange={(event) => updateResultField(index, { validationMode: event.target.value })}>
                      {XRC137_VALIDATION_MODE_OPTIONS.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                    </select>
                  </label>
                  <label className="result-rule-value">
                    <span>Rule value</span>
                    <input
                      value={field.validationValue || ''}
                      onChange={(event) => updateResultField(index, { validationValue: event.target.value })}
                      placeholder={(field.validationMode || 'none') === 'oneOf' ? 'KV-1, KV-2, KV-3' : 'e.g. 100'}
                      disabled={(field.validationMode || 'none') === 'none'}
                    />
                  </label>
                  <button className="secondary-button compact-button" type="button" onClick={() => removeResultField(index)} disabled={resultFields.length <= 1}>Remove</button>
                </div>
              ))}
            </div>
            {resultSchemaError && <small className="attention-note">{resultSchemaError}</small>}
            <details className="debug-collapse schema-json-collapse">
              <summary>Advanced JSON schema</summary>
              <textarea value={form.resultSchemaText} onChange={(event) => setField('resultSchemaText', event.target.value)} rows={11} />
            </details>
          </div>
          <label className="wide-label">
            <span>Manual document text</span>
            <textarea
              value={form.customDocumentText}
              onChange={(event) => setField('customDocumentText', event.target.value)}
              rows={8}
              placeholder="Paste a letter, email, claim text, invoice text, or any other document text here."
              disabled={documentUpload?.configured}
            />
          </label>
          <div className="inline-help-row">
            <HelpPill label="Manual text behavior" title="Manual text and active uploads">
              {documentUpload?.configured ? (
                <>
                  <p>An uploaded or manually saved document is active right now.</p>
                  <p>Clear the active document to edit or use the example text again.</p>
                </>
              ) : (
                <>
                  <p>This example text is used when no uploaded document is active.</p>
                  <p>You can replace it with your own document text at any time.</p>
                </>
              )}
            </HelpPill>
          </div>
          <div className="upload-card">
            <div>
              <div className="title-with-help upload-card-title">
                <strong>Upload document</strong>
                <HelpPill label="Supported formats" title="Document types accepted by the demo">
                  <p>Supported uploads: .txt, .json, .html, .pdf, .png, .jpg, .jpeg, .webp, and .gif.</p>
                  <p>OpenAI and Gemini can inspect PDF and image documents directly. This is also the right option for scanned letters, photographed documents, and screenshots.</p>
                </HelpPill>
              </div>
              {documentUpload?.configured && (
                <div className="kv-list compact-kv">
                  <div><span>Current upload</span><code>{documentUpload.name}</code></div>
                  <div><span>Type</span><code>{documentUpload.contentType}</code></div>
                  <div><span>Size</span><code>{documentUpload.sizeBytes} bytes</code></div>
                </div>
              )}
            </div>
            <div className="hero-actions small-actions upload-actions">
              <label className="secondary-button file-button">
                Upload file
                <input type="file" accept={DOCUMENT_UPLOAD_ACCEPT} onChange={uploadDocumentFile} />
              </label>
              <button className="secondary-button" type="button" onClick={saveManualDocumentText} disabled={documentUpload?.configured || !form.customDocumentText.trim()}>Use manual text</button>
              <button className="secondary-button" type="button" onClick={clearUploadedDocument} disabled={!documentUpload?.configured}>Clear document</button>
            </div>
          </div>
        </div>
      </SetupStep>

      <SetupStep
        number="4"
        title="Start the live waiter session"
        helpContent={(
          <>
            <p>After your credentials are unlocked, start the real XDaLa waiter session.</p>
            <p>Continue only after the session reaches the waiting step.</p>
          </>
        )}
        ok={!!liveWaiter?.waiting}
        waiting={!liveWaiter?.waiting}
      >
        <div className="waiter-box">
          {liveWaiter?.waiter ? (
            <div className="kv-list">
              <div><span>Session ID</span><code>{liveWaiter.waiter.sessionId}</code></div>
              <div><span>Owner</span><code>{liveWaiter.waiter.owner}</code></div>
              <div><span>Status</span><code>{liveWaiter.status}{liveWaiter.waiting ? ' / waiting' : ''}</code></div>
              <div><span>Rows</span><code>{liveWaiter.rowCount || 0}</code></div>
            </div>
          ) : (
            <p className="muted">No live waiter started for this browser tab yet.</p>
          )}
          <div className="hero-actions small-actions">
            <button className="primary-button" type="button" onClick={startLiveWaiter} disabled={!runtimeUnlocked || waiterStarting}>
              <span className={`button-label-with-spinner ${waiterStarting ? 'is-busy' : ''}`}>
                {waiterStarting && <span className="button-spinner hourglass-spinner" aria-hidden="true">⌛</span>}
                <span>{waiterStarting ? 'Starting waiter...' : 'Start live waiter'}</span>
              </span>
            </button>
            <button className="secondary-button" type="button" onClick={refreshLiveWaiter} disabled={!liveWaiter?.exists || waiterStarting}>Refresh waiter</button>
            <button className="secondary-button" type="button" onClick={clearLiveWaiter} disabled={!liveWaiter?.exists || waiterStarting}>Clear waiter</button>
          </div>
        </div>
      </SetupStep>

      <div className="inline-help-row security-note-row">
        <HelpPill label="Security model" title="How runtime secrets are handled">
          <p>Runtime config is scoped to this browser tab.</p>
          <p>Private keys and AI or document API keys are encrypted with your runtime password in backend memory and unlocked only for the configured timer.</p>
          <p>Password, key, and token fields are cleared immediately after save or unlock. The selected AI provider receives document content only, never private keys or API tokens.</p>
        </HelpPill>
      </div>
      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box inline-error">{error}</div>}
    </section>
  );
}
