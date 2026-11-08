import React, { useEffect, useRef, useState } from 'react';

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

const STATUS_CLS = { Requested: 'progress', Approved: 'done', 'Returned for reupload': 'pending' };
export function StatusBadge({ status }) {
  return <span className={`badge ${STATUS_CLS[status] || ''}`}>{status || 'Open'}</span>;
}
export function RiskBadge({ risk }) {
  if (!risk) return <span className="muted">—</span>;
  return <span className={`badge ${risk === 'High' ? 'leave' : 'pending'}`}>{risk}</span>;
}

/** Compact multi-select dropdown with checkboxes */
export function MultiSelect({ options, value, onChange, placeholder = 'Select…', disabled, id }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="ms" ref={ref}>
      <button type="button" id={id} className={`input ms-btn ${value.length ? '' : 'ms-empty'}`} disabled={disabled} onClick={() => setOpen(!open)}>
        {value.length ? value.join(', ') : placeholder}
      </button>
      {open && (
        <div className="ms-pop">
          {options.map((o) => (
            <label key={o} className="ms-opt"><input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /> {o}</label>
          ))}
        </div>
      )}
    </div>
  );
}
