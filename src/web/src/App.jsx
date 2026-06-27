import React from 'react';
import DemoTimeline from './components/DemoTimeline.jsx';
import ResultPanel from './components/ResultPanel.jsx';
import SessionReceiptPanel from './components/SessionReceiptPanel.jsx';
import Footer from './components/Footer.jsx';
import DocumentPreview from './components/DocumentPreview.jsx';
import LiveSetupPanel from './components/LiveSetupPanel.jsx';
import HelpPill from './components/HelpPill.jsx';
import { buildSavedPublicRuntimeConfigDraft, syncPublicRuntimeConfigBeforeRequest } from './utils/publicRuntimeConfigDraft.js';

function getRuntimeSessionId() {
  const key = 'xgr.agent.runtimeSessionId.v1';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const next = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(key, next);
    return next;
  } catch {
    return `memory_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function shouldAttachPublicRuntimeConfig(url, method) {
  const normalizedUrl = String(url || '');
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (normalizedMethod !== 'POST') return false;
  if (normalizedUrl === '/api/runs') return true;
  if (!normalizedUrl.startsWith('/api/live/')) return false;
  return !normalizedUrl.includes('/demo-state');
}

function withPublicRuntimeConfigBody(url, options, runtimeSessionId) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!shouldAttachPublicRuntimeConfig(url, method)) return options;

  const draft = buildSavedPublicRuntimeConfigDraft();
  let existingBody = {};
  try {
    existingBody = options.body ? JSON.parse(options.body) : {};
  } catch {
    existingBody = {};
  }

  return {
    ...options,
    body: JSON.stringify({
      ...draft,
      ...existingBody,
      runtimeSessionId,
    }),
  };
}

async function getJson(url, options = {}, runtimeSessionId = '') {
  const method = String(options.method || 'GET').toUpperCase();
  await syncPublicRuntimeConfigBeforeRequest(url, method, runtimeSessionId);
  const finalOptions = withPublicRuntimeConfigBody(url, options, runtimeSessionId);

  const headers = {
    ...(finalOptions.headers || {}),
    ...(runtimeSessionId ? { 'x-xgr-agent-session': runtimeSessionId } : {}),
  };
  const response = await fetch(url, { ...finalOptions, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}


function StatusChip({ ok, warning, children }) {
  return (
    <span className={`setup-step-pill ${ok ? 'done' : warning ? 'waiting' : ''}`}>
      {children}
    </span>
  );
}

function EnvSecretsPanel({ config, runtimeSessionId, onConfigReload }) {
  const envSecrets = config?.envSecrets || {};
  const secretFlow = config?.secretFlow || {};
  const [password, setPassword] = React.useState('');
  const [ttlMinutes, setTtlMinutes] = React.useState(20);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');

  if (!envSecrets.configured) return null;

  const unlockLeftSec = Number(envSecrets.unlockLeftSec || 0);
  const unlocked = !!envSecrets.unlocked && unlockLeftSec > 0;
  const meta = envSecrets.publicMeta || {};

  async function unlock() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await getJson('/api/env-secrets/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runtimeSessionId,
          password,
          unlockTtlSec: Math.max(1, Number(ttlMinutes || 20)) * 60,
        }),
      }, runtimeSessionId);
      setPassword('');
      setMessage('Encrypted server secrets are unlocked in server memory.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not unlock encrypted server secrets.');
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await getJson('/api/env-secrets/lock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runtimeSessionId }),
      }, runtimeSessionId);
      setMessage('Encrypted server secrets are locked again.');
      await onConfigReload?.();
    } catch (err) {
      setError(err.message || 'Could not lock encrypted server secrets.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`panel-card secret-flow-card ${envSecrets.unlocked ? 'done' : 'waiting'}`}>
      <div className="section-header compact">
        <div>
          <div className="eyebrow">Step 0</div>
          <div className="title-with-help">
            <h2>Unlock encrypted server secrets first</h2>
            <HelpPill label="Secret sources" title="How Step 0 works">
              <p>The encrypted .env bundle is the base secret source for the demo.</p>
              <p>Use the runtime fields in the next section only for missing values or browser-tab-local overrides.</p>
              <p>The server found <code>{envSecrets.envName || 'XGR_AGENT_ENCRYPTED_SECRETS'}</code>. The unlock password is never stored.</p>
            </HelpPill>
          </div>
        </div>
        <div className={`run-status ${unlocked ? 'completed' : 'running'}`}>
          {unlocked ? `unlocked ${unlockLeftSec}s` : 'unlock needed'}
        </div>
      </div>
      <div className="setup-pill-row">
        <StatusChip ok={!!meta.hasXdalaOwnerPrivateKey}>Owner key {meta.hasXdalaOwnerPrivateKey ? 'configured' : 'missing'}</StatusChip>
        <StatusChip ok={!!meta.hasXdalaAgentPrivateKey}>Agent key {meta.hasXdalaAgentPrivateKey ? 'configured' : 'missing'}</StatusChip>
        <StatusChip ok={!!meta.hasGeminiApiKey}>Gemini key {meta.hasGeminiApiKey ? 'configured' : 'missing'}</StatusChip>
        <StatusChip ok={!!meta.hasOpenAiApiKey}>OpenAI key {meta.hasOpenAiApiKey ? 'configured' : 'missing'}</StatusChip>
        <StatusChip ok={!!meta.hasDocumentApiKey} warning={!meta.hasDocumentApiKey}>Document API key {meta.hasDocumentApiKey ? 'configured' : 'optional / missing'}</StatusChip>
        <StatusChip ok={!!secretFlow.providerKeyConfigured} warning={!secretFlow.providerKeyConfigured}>AI provider key {secretFlow.providerKeyConfigured ? 'ready' : 'missing'}</StatusChip>
        <StatusChip ok={!!secretFlow.xdala?.ready} warning={!secretFlow.xdala?.ready}>XDaLa keys {secretFlow.xdala?.ready ? 'ready' : envSecrets.unlocked ? 'incomplete' : 'configured, locked'}</StatusChip>
      </div>
      {error && <div className="error-box inline-error">{error}</div>}
      {message && <div className="success-box inline-success">{message}</div>}
      <div className="form-grid two">
        <label>
          <span>Encrypted server secret password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        <label>
          <span>Unlock time in minutes</span>
          <input type="number" min="1" max="1440" value={ttlMinutes} onChange={(event) => setTtlMinutes(event.target.value)} />
        </label>
      </div>
      <div className="hero-actions small-actions">
        <button className="primary-button" type="button" onClick={unlock} disabled={busy || !password}>
          {unlocked ? 'Refresh server unlock' : 'Unlock encrypted server secrets'}
        </button>
        <button className="secondary-button" type="button" onClick={lock} disabled={busy || !unlocked}>
          Lock server secrets
        </button>
      </div>
    </section>
  );
}

export default function App() {
  const runtimeSessionId = React.useMemo(() => getRuntimeSessionId(), []);
  const [config, setConfig] = React.useState(null);
  const [run, setRun] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [liveWaiter, setLiveWaiter] = React.useState(null);
  const [error, setError] = React.useState('');
  const [resetVersion, setResetVersion] = React.useState(0);
  const configRequestRef = React.useRef(null);

  const reloadConfig = React.useCallback(async () => {
    if (configRequestRef.current) return configRequestRef.current;

    const request = getJson('/api/config', {}, runtimeSessionId)
      .then((next) => {
        setConfig(next);
        setLiveWaiter(next.liveWaiter || null);
        return next;
      })
      .finally(() => {
        configRequestRef.current = null;
      });

    configRequestRef.current = request;
    return request;
  }, [runtimeSessionId]);

  React.useEffect(() => {
    reloadConfig().catch((err) => setError(err.message));
  }, [reloadConfig]);

  React.useEffect(() => {
    if (!run?.id || ['completed', 'failed'].includes(run.status)) return undefined;
    const events = new EventSource(`/api/runs/${run.id}/events?runtimeSessionId=${encodeURIComponent(runtimeSessionId)}`);
    events.addEventListener('run', (event) => {
      setRun(JSON.parse(event.data));
    });
    events.onerror = () => {
      events.close();
    };
    return () => events.close();
  }, [run?.id, run?.status, runtimeSessionId]);

  async function startDemo() {
    setBusy(true);
    setError('');
    if (mode === 'live' && !liveWaiter?.waiting) {
      setBusy(false);
      setError('Start the live waiter first. The AI run wakes the existing waiter and never starts a new one.');
      return;
    }
    try {
      const payload = await getJson('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runtimeSessionId }),
      }, runtimeSessionId);
      setRun(payload.run);
      if (payload.liveWaiter) setLiveWaiter(payload.liveWaiter);
    } catch (err) {
      setError(err.message || 'Could not start demo');
    } finally {
      setBusy(false);
    }
  }

  async function clearRun() {
    setBusy(true);
    setError('');
    try {
      const payload = await getJson('/api/live/demo-state', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runtimeSessionId,
          runId: run?.id || '',
        }),
      }, runtimeSessionId);

      setRun(null);
      setLiveWaiter(payload.liveWaiter || null);
      setResetVersion((value) => value + 1);
      await reloadConfig();
    } catch (err) {
      setError(err.message || 'Could not clear run state.');
    } finally {
      setBusy(false);
    }
  }

  async function clearComplete() {
    const confirmed = window.confirm(
      'Clear the complete example page? This removes runtime config, encrypted keys, waiter state, uploaded document, run result, receipts, and local form draft for this browser tab.'
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    try {
      await getJson('/api/live/demo-state/full', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runtimeSessionId,
          runId: run?.id || '',
        }),
      }, runtimeSessionId);

      try {
        const keysToRemove = [];
        for (let index = 0; index < sessionStorage.length; index += 1) {
          const key = sessionStorage.key(index);
          if (String(key || '').startsWith('xgr.agent.')) keysToRemove.push(key);
        }
        keysToRemove.forEach((key) => sessionStorage.removeItem(key));
      } catch {
        // sessionStorage is optional for the demo page.
      }

      window.location.reload();
    } catch (err) {
      setError(err.message || 'Could not clear complete demo page.');
      setBusy(false);
    }
  }

  const runtimeStatus = config?.runtimeConfig || {};
  const runtimeConfigured = !!runtimeStatus.configured;
  const runtimeUnlocked = !!runtimeStatus.unlocked;
  const envSecrets = config?.envSecrets || {};
  const secretFlow = config?.secretFlow || {};
  const effectiveLiveReady = !!(config?.effectiveMode === 'live' || secretFlow.liveReady);
  const mode = effectiveLiveReady ? 'live' : (config?.mode || 'mock');
  const aiProvider = config?.runtimeConfig?.publicConfig?.aiProvider || config?.ai?.provider || (config?.geminiConfigured ? 'gemini' : config?.openaiConfigured ? 'openai' : 'mock');
  const aiModel = aiProvider === 'gemini'
    ? (config?.runtimeConfig?.publicConfig?.geminiModel || config?.ai?.geminiModel || 'gemini-3.5-flash')
    : (config?.runtimeConfig?.publicConfig?.openaiModel || config?.ai?.openaiModel || config?.openaiModel || 'gpt-4.1-mini');
  const aiState = config?.aiConfigured
    ? `AI Agent enabled (${aiProvider}: ${aiModel})`
    : 'Mock AI extraction until an OpenAI or Gemini API key is set';
  const liveState = runtimeConfigured
    ? (runtimeUnlocked ? `Runtime override unlocked for ${runtimeStatus.unlockLeftSec || 0}s` : 'Runtime override saved, keys locked')
    : envSecrets?.configured
      ? (envSecrets?.unlocked ? `Encrypted server secrets unlocked for ${envSecrets.unlockLeftSec || 0}s` : 'Encrypted server secrets configured, locked')
      : 'Mock chain until runtime override or encrypted .env secrets are set';
  const waitStepId = runtimeStatus?.publicConfig?.waitStepId || config?.waitStepId || 'WAIT_FOR_DOCUMENT';
  const runExists = !!run?.id;
  const clearAvailable = runExists;

  return (
    <>
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-content">
          <div className="eyebrow">XGR.Network demo</div>
          <h1>AI Agent wakes an XDaLa session with verified document proof</h1>
          <p>
            This customer example shows an OpenAI/Gemini-powered document agent, deterministic hashing, permit signing,
            and XDaLa wakeup communication in one Dockerized demo.
          </p>
          <div className="hero-actions">
            <a className="secondary-button" href="/api/sample-document" target="_blank" rel="noreferrer">
              Open sample document
            </a>
            <a className="secondary-button" href="/api/downloads/waiter-bundle-configured">
              Download configured bundle
            </a>
            <a className="secondary-button" href="/docs/customer-api" target="_blank" rel="noreferrer">
              Customer API guide
            </a>
            {clearAvailable && (
              <button
                className="secondary-button"
                type="button"
                onClick={clearRun}
                disabled={busy || run?.status === 'running'}
              >
                Clear run
              </button>
            )}
            <button
              className="secondary-button"
              type="button"
              onClick={clearComplete}
              disabled={busy}
            >
              Clear complete
            </button>
          </div>
        </div>
        <div className="status-stack">
          <div className={`status-pill ${mode === 'live' ? 'live' : 'mock'}`}>{mode.toUpperCase()} MODE</div>
          <div className="mini-card">{aiState}</div>
          <div className="mini-card">{liveState}</div>
          <div className="mini-card">Wait step: {waitStepId}</div>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}

      <EnvSecretsPanel
        config={config}
        runtimeSessionId={runtimeSessionId}
        onConfigReload={reloadConfig}
      />

      <LiveSetupPanel
        config={config}
        runtimeSessionId={runtimeSessionId}
        onConfigReload={reloadConfig}
      />

      <section className="panel-card run-panel-card">
        <div className="section-header compact">
          <div>
            <div className="eyebrow">Step 5</div>
            <div className="title-with-help">
              <h2>{mode === 'live' ? 'Run AI wakeup on the waiting session' : 'Run the mock demo'}</h2>
              <HelpPill label="Run details" title="What happens in the final run">
                <p>Continue here only after the setup above is complete.</p>
                <p>In live mode the agent fetches the document, extracts the business data, builds the proof, and wakes the existing waiter session.</p>
              </HelpPill>
            </div>
          </div>
          <div className={`run-status ${run?.status === 'completed' ? 'completed' : run?.status === 'failed' ? 'failed' : run?.status === 'running' ? 'running' : ''}`}>
            {run?.status || (mode === 'live' ? (liveWaiter?.waiting ? 'ready' : 'waiting needed') : 'mock ready')}
          </div>
        </div>
        <div className="hero-actions small-actions">
          <button
            className="primary-button"
            onClick={startDemo}
            disabled={busy || runExists || (mode === 'live' && !liveWaiter?.waiting)}
          >
            {busy || run?.status === 'running' ? 'Demo running...' : mode === 'live' ? 'Run AI wakeup on waiter' : 'Start mock demo'}
          </button>

        </div>
        {runExists && run?.status !== 'running' && (
          <div className="error-box inline-error">
            This run is locked. Clear run before starting a fresh session and AI wakeup.
          </div>
        )}
        {runtimeConfigured && !runtimeUnlocked && (
          <div className="error-box inline-error">Live keys are locked. Unlock them in the setup panel before starting the waiter or running the AI wakeup.</div>
        )}
        {mode === 'live' && !liveWaiter?.waiting && (
          <div className="error-box inline-error">Start the live waiter session first. The AI wakeup run is enabled after the waiter reaches the waiting step.</div>
        )}
      </section>

      <section className="grid-layout">
        <DemoTimeline run={run} />
        <div className="side-column">
          <DocumentPreview run={run} />
          <ResultPanel run={run} />
          <SessionReceiptPanel
            run={run}
            config={config}
            runtimeSessionId={runtimeSessionId}
            resetKey={resetVersion}
          />
        </div>
      </section>
    </main>
    <Footer />
    </>
  );
}
