import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** size: undefined (narrow) | 'xl' (case detail with side column); wide = medium */
export function Modal({ title, children, onClose, footer, wide, size }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${size || ''}`} role="dialog" aria-modal="true">
        <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
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

/**
 * Compact multi-select dropdown with checkboxes.
 * The list is rendered on top of the page (portal, position: fixed), so tables and other scrolling
 * containers can't clip or cover it. It opens below the field, or above when there's no room.
 */
export function MultiSelect({ options, value, onChange, placeholder = 'Select…', disabled, id }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef();
  const popRef = useRef();
  useEffect(() => {
    const h = (e) => {
      if (ref.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open]);
  // keep the list attached to the field while the page or the table scrolls
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = ref.current?.querySelector('.ms-btn');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; } // field scrolled out of view
      const width = Math.max(r.width, 240);
      const popH = Math.min(popRef.current?.offsetHeight || 360, 360);
      const below = window.innerHeight - r.bottom;
      const up = below < popH + 12 && r.top > below;
      const rtl = document.documentElement.dir === 'rtl';
      let left = rtl ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      setPos({ left, width, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  const label = !value.length ? placeholder : value.length <= 2 ? value.join(', ') : `${value[0]} +${value.length - 1} more`;
  return (
    <div className="ms" ref={ref}>
      <button type="button" id={id} className={`input ms-btn ${value.length ? '' : 'ms-empty'} ${open ? 'open' : ''}`} disabled={disabled}
        title={value.join(', ')} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && createPortal(
        <div ref={popRef} className="ms-pop ms-floating" role="listbox" aria-multiselectable="true"
          style={pos ? { ...pos } : { visibility: 'hidden' }}>
          <div className="ms-head">
            <span>{value.length ? `${value.length} selected` : 'Select one or more'}</span>
            {value.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}
          </div>
          {options.map((o) => (
            <label key={o} className={`ms-opt ${value.includes(o) ? 'on' : ''}`}><input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /> {o}</label>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
