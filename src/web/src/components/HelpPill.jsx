import React from 'react';

export default function HelpPill({ label = 'Help', title = '', children, className = '' }) {
  return (
    <details className={`help-pill ${className}`.trim()}>
      <summary>{label}</summary>
      <div className="help-pill-popover">
        {title && <strong>{title}</strong>}
        <div className="help-pill-body">{children}</div>
      </div>
    </details>
  );
}
