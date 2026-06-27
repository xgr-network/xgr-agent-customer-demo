import React from 'react';

async function getJson(url, runtimeSessionId = '') {
  const headers = runtimeSessionId ? { 'x-xgr-agent-session': runtimeSessionId } : {};
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

const EXPECTED_RECEIPT_ROWS = 3;
const RECEIPT_WAIT_TIMEOUT_MS = 45000;
const RECEIPT_POLL_MS = 3000;

function buildReceiptReportUrl() {
  const params = new URLSearchParams({
    minRows: String(EXPECTED_RECEIPT_ROWS),
    timeoutMs: String(RECEIPT_WAIT_TIMEOUT_MS),
    pollMs: String(RECEIPT_POLL_MS),
  });
  return `/api/live/session-receipts?${params.toString()}`;
}

function short(value, left = 10, right = 6) {
  const text = String(value || '');
  if (!text) return '-';
  return text.length > left + right + 3 ? `${text.slice(0, left)}...${text.slice(-right)}` : text;
}

function formatValid(valid) {
  if (valid === true) return 'valid';
  if (valid === false) return 'invalid';
  return 'unknown';
}

function StepReceiptCard({ step, explorerUrl }) {
  const txUrl = step.txHash && explorerUrl ? `${String(explorerUrl).replace(/\/+$/, '')}/tx/${step.txHash}` : '';
  return (
    <article className={`receipt-step-card ${step.valid === false ? 'invalid' : step.valid === true ? 'valid' : ''}`}>
      <div className="receipt-step-top">
        <div>
          <span className="receipt-index">#{step.iteration ?? step.index}</span>
          <h4>{step.stepId || 'Unknown step'}</h4>
        </div>
        <span className={`receipt-valid ${formatValid(step.valid)}`}>{formatValid(step.valid)}</span>
      </div>
      <div className="receipt-kv-grid">
        <div><span>Tx</span>{txUrl ? <a href={txUrl} target="_blank" rel="noreferrer">{short(step.txHash)}</a> : <code>{short(step.txHash)}</code>}</div>
        <div><span>Block</span><code>{step.blockNumber ?? '-'}</code></div>
        <div><span>XRC-729</span><code>{short(step.orchestrationAddress)}</code></div>
        <div><span>XRC-137</span><code>{short(step.ruleContract)}</code></div>
        <div><span>Exec</span><code>{short(step.execContract)}</code></div>
        <div><span>Gas</span><code>{step.innerGasUsed || '-'}</code></div>
      </div>
      <details className="debug-collapse compact-debug">
        <summary>Show decoded receipt JSON</summary>
        <pre className="json-box compact-json">{JSON.stringify({
          iteration: step.iteration,
          stepId: step.stepId,
          valid: step.valid,
          txHash: step.txHash,
          blockNumber: step.blockNumber,
          orchestrationAddress: step.orchestrationAddress,
          ruleContract: step.ruleContract,
          execContract: step.execContract,
          payload: step.payload,
          apiSaves: step.apiSaves,
          contractSaves: step.contractSaves,
          additionalInformation: step.additionalInformation,
        }, null, 2)}</pre>
      </details>
    </article>
  );
}

export default function SessionReceiptPanel({ run, config, runtimeSessionId, resetKey = 0 }) {
  const [report, setReport] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const hasLiveWaiter = !!config?.liveWaiter?.exists || !!run?.result?.waiter?.sessionId;
  const resultCompleted = run?.status === 'completed';

  async function loadReceipts({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const payload = await getJson(buildReceiptReportUrl(), runtimeSessionId);
      setReport(payload);
    } catch (err) {
      if (!silent) {
        setError(err.message || 'Could not load receipts from explorer.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  React.useEffect(() => {
    setReport(null);
    setError('');
    setLoading(false);
  }, [resetKey, run?.id]);

  React.useEffect(() => {
    if (!resultCompleted || !hasLiveWaiter) return undefined;

    let cancelled = false;

    async function loadWithBackendPolling() {
      if (cancelled) return;
      await loadReceipts({ silent: false });
    }

    loadWithBackendPolling();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultCompleted, hasLiveWaiter, run?.id, resetKey]);

  const summary = report?.summary || null;
  const steps = Array.isArray(report?.steps) ? report.steps : [];
  const polling = report?.polling || null;
  const receiptIndexingPending = !!polling && !polling.complete;

  return (
    <section className="panel-card receipt-panel">
      <div className="section-header compact">
        <div>
          <div className="eyebrow">Explorer proof</div>
          <h2>Session receipts and transaction data</h2>
        </div>
        <button className="secondary-button compact-button" type="button" onClick={loadReceipts} disabled={loading || !hasLiveWaiter}>
          {loading ? 'Loading...' : 'Load receipts'}
        </button>
      </div>

      {!hasLiveWaiter && <p className="muted">Start a live waiter session first. The receipt proof appears after the session has transactions.</p>}
      {error && <div className="error-box inline-error wrap-error">{error}</div>}
      {receiptIndexingPending && (
        <p className="muted">
          Explorer indexing is still catching up. Found {steps.length} of at least {polling.expectedRows} expected receipts after {polling.attempts} checks.
          Use "Load receipts" again in a few seconds if the final receipt is still missing.
        </p>
      )}

      {summary && (
        <>
          <div className="receipt-summary-grid">
            <div><span>Session</span><strong>{summary.sessionId}</strong></div>
            <div><span>Receipts</span><strong>{summary.rowCount}</strong></div>
            <div><span>Valid</span><strong>{summary.validCount}</strong></div>
            <div><span>Invalid</span><strong>{summary.invalidCount}</strong></div>
            <div><span>Transactions</span><strong>{summary.txCount}</strong></div>
            <div><span>Blocks</span><strong>{summary.blockCount}</strong></div>
          </div>

          <details className="debug-collapse">
            <summary>Customer API call</summary>
            <div className="api-example-box">
              <div><span>Method</span><code>{report.customerApi?.method || 'GET'}</code></div>
              <div><span>URL</span><code>{report.customerApi?.url || report.apiUrl}</code></div>
            </div>
            <pre className="json-box compact-json">{`const response = await fetch(${JSON.stringify(report.customerApi?.url || report.apiUrl)});
const receiptReport = await response.json();`}</pre>
          </details>

          <div className="receipt-step-list">
            {steps.map((step) => (
              <StepReceiptCard key={`${step.iteration}-${step.stepId}-${step.txHash}`} step={step} explorerUrl={summary.explorerUrl} />
            ))}
          </div>

          <details className="debug-collapse">
            <summary>Show complete explorer JSON response</summary>
            <pre className="json-box">{JSON.stringify(report, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
