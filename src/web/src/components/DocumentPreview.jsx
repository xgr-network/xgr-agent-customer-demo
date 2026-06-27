import React from 'react';

export default function DocumentPreview({ run }) {
  const fetchStep = (run?.steps || []).find((step) => step.id === 'fetch_document');
  const prepareStep = (run?.steps || []).find((step) => step.id === 'prepare_document');

  return (
    <section className="panel-card">
      <div className="eyebrow">Document</div>
      <h2>Fetched proof source</h2>
      {fetchStep?.details ? (
        <div className="kv-list">
          <div><span>Name</span><code>{fetchStep.details.name}</code></div>
          <div><span>Source</span><code>{fetchStep.details.source}</code></div>
          <div><span>Content type</span><code>{fetchStep.details.contentType || 'unknown'}</code></div>
          <div><span>Size</span><code>{fetchStep.details.sizeBytes} bytes</code></div>
        </div>
      ) : (
        <p className="muted">Start the demo to fetch the sample insurance document.</p>
      )}
      {prepareStep?.details?.note && (
        <pre className="document-preview">{prepareStep.details.note}</pre>
      )}
    </section>
  );
}
