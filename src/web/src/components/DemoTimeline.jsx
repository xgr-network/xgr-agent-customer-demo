import React from 'react';
import StepCard from './StepCard.jsx';

const DEFAULT_STEPS = [
  { id: 'start_waiter', title: 'Start waiter session' },
  { id: 'wait_until_waiting', title: 'Wait until XDaLa step is WAITING' },
  { id: 'fetch_document', title: 'Fetch document from API' },
  { id: 'prepare_document', title: 'Prepare document for AI analysis' },
  { id: 'ai_extract', title: 'AI Agent extracts business data' },
  { id: 'hash_document', title: 'Create deterministic document proof' },
  { id: 'wake_xdala', title: 'Wake XDaLa waiter session' },
];

export default function DemoTimeline({ run }) {
  const stepMap = new Map((run?.steps || []).map((step) => [step.id, step]));
  const steps = DEFAULT_STEPS.map((step) => stepMap.get(step.id) || { ...step, status: 'pending', details: {} });

  return (
    <section className="timeline-card">
      <div className="section-header">
        <div>
          <div className="eyebrow">Live flow</div>
          <h2>Step-by-step execution</h2>
        </div>
        <span className={`run-status ${run?.status || 'idle'}`}>{run?.status || 'idle'}</span>
      </div>
      <div className="timeline-list">
        {steps.map((step, index) => (
          <StepCard key={step.id} index={index + 1} step={step} />
        ))}
      </div>
    </section>
  );
}
