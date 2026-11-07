import React from 'react';

export function Modal({ title, children, onClose, footer, wide }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog">
        <h3>{title}</h3>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const cls = { Pending: 'pending', 'In Progress': 'progress', Completed: 'done' }[status] || '';
  return <span className={`badge ${cls}`}>{status}</span>;
}

/** Derive a compact summary of a row's original data for table display */
export function dataSummary(data, max = 3) {
  return Object.entries(data).slice(0, max).map(([k, v]) => `${k}: ${v}`).join(' · ');
}

/** Build a dynamic list of data columns across cases (first N keys seen) */
export function dataColumns(cases, skip = [], max = 5) {
  const keys = [];
  for (const c of cases) for (const k of Object.keys(c.data)) {
    if (!keys.includes(k) && !skip.includes(k)) keys.push(k);
    if (keys.length >= max) return keys;
  }
  return keys;
}
