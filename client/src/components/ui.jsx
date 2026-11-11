import React, { useEffect, useRef, useState } from 'react';

/** size: undefined (narrow) | 'xl' (case detail with side column); wide = medium */
export function Modal({ title, children, onClose, footer, wide, size }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${size || ''}`} role="dialog">
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
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open]);
  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  const label = !value.length ? placeholder : value.length <= 2 ? value.join(', ') : `${value[0]} +${value.length - 1} more`;
  return (
    <div className="ms" ref={ref}>
      <button type="button" id={id} className={`input ms-btn ${value.length ? '' : 'ms-empty'} ${open ? 'open' : ''}`} disabled={disabled}
        title={value.join(', ')} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="ms-pop" role="listbox" aria-multiselectable="true">
          <div className="ms-head">
            <span>{value.length ? `${value.length} selected` : 'Select one or more'}</span>
            {value.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}
          </div>
          {options.map((o) => (
            <label key={o} className={`ms-opt ${value.includes(o) ? 'on' : ''}`}><input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /> {o}</label>
          ))}
        </div>
      )}
    </div>
  );
}
