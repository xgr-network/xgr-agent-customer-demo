import React from 'react';

function stringifyValue(value) {
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function renderDebugBlock(debug) {
  if (!debug || typeof debug !== 'object') return null;
  return (
    <details className="debug-collapse">
      <summary>Show agent prompt and raw answer</summary>
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
        <strong>Output schema / expected answer shape</strong>
        <pre>{debug.outputSchema || JSON.stringify(debug.parsedAnswer || {}, null, 2)}</pre>
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

function renderDetails(details = {}) {
  const entries = Object.entries(details || {}).filter(([key]) => key !== 'agentDebug');
  const debug = details?.agentDebug;
  if (!entries.length && !debug) return <span className="muted">Waiting for this step...</span>;
  return (
    <>
      {entries.slice(0, 8).map(([key, value]) => (
        <div className="detail-row" key={key}>
          <span>{key}</span>
          <code>{stringifyValue(value)}</code>
        </div>
      ))}
      {entries.length > 8 && (
        <details className="debug-collapse compact-debug">
          <summary>Show {entries.length - 8} more detail fields</summary>
          {entries.slice(8).map(([key, value]) => (
            <div className="detail-row" key={key}>
              <span>{key}</span>
              <code>{stringifyValue(value)}</code>
            </div>
          ))}
        </details>
      )}
      {renderDebugBlock(debug)}
    </>
  );
}

export default function StepCard({ index, step }) {
  return (
    <article className={`step-card ${step.status}`}>
      <div className="step-index">{index}</div>
      <div className="step-main">
        <div className="step-title-row">
          <h3>{step.title}</h3>
          <span className={`step-status ${step.status}`}>{step.status}</span>
        </div>
        <div className="step-details">{renderDetails(step.details)}</div>
      </div>
    </article>
  );
}
