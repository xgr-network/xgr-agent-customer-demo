import React from 'react';

function AgentDebugDetails({ debug }) {
  if (!debug) return null;
  return (
    <details className="debug-collapse result-debug">
      <summary>Show agent prompt, schema, and complete answer</summary>
      <div className="debug-grid">
        <div>
          <span>Provider</span>
          <code>{debug.providerLabel || debug.provider}</code>
        </div>
        <div>
          <span>Model</span>
          <code>{debug.model}</code>
        </div>
      </div>
      <div className="debug-section">
        <strong>System instructions</strong>
        <pre>{debug.instructions || ''}</pre>
      </div>
      <div className="debug-section">
        <strong>Result schema sent with the request</strong>
        <pre>{debug.outputSchema || ''}</pre>
      </div>
      <div className="debug-section">
        <strong>Prompt sent to the model</strong>
        <pre>{debug.prompt || ''}</pre>
      </div>
      <div className="debug-section">
        <strong>Complete model answer</strong>
        <pre>{debug.rawAnswer || JSON.stringify(debug.parsedAnswer || {}, null, 2)}</pre>
      </div>
    </details>
  );
}

function ExtractionGrid({ extraction }) {
  const entries = Object.entries(extraction || {});
  if (!entries.length) return null;
  return (
    <div className="result-grid extraction-grid">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span>{key}</span>
          <strong>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function ResultPanel({ run }) {
  const result = run?.result;
  return (
    <section className="panel-card result-panel">
      <div className="eyebrow">Result</div>
      <h2>Final proof and wakeup payload</h2>
      {!result && <p className="muted">The result appears here after the session is woken.</p>}
      {result && (
        <>
          <div className="result-grid">
            <div>
              <span>Session</span>
              <strong>{result.waiter?.sessionId}</strong>
            </div>
            <div>
              <span>AI provider</span>
              <strong>{result.agent?.providerLabel || result.agent?.provider || '-'}</strong>
            </div>
            <div>
              <span>Extracted by</span>
              <strong>{result.agent?.extractedBy || result.wakeupPayload?.ExtractedBy || result.wakeupPayload?.extractedBy || '-'}</strong>
            </div>
            <div>
              <span>Document hash</span>
              <strong>{result.document?.hash?.slice(0, 18)}...</strong>
            </div>
            <div>
              <span>Wakeup</span>
              <strong>sent</strong>
            </div>
          </div>
          <div className="form-section-title">AI extraction result</div>
          <ExtractionGrid extraction={result.extraction} />
          <AgentDebugDetails debug={result.agentDebug} />
          <pre className="json-box">{JSON.stringify(result.wakeupPayload, null, 2)}</pre>
        </>
      )}
    </section>
  );
}
