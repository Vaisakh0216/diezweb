import React, { useEffect, useRef, useState } from 'react';
import { api, qs, fmtDate, exportCSV } from '../api.js';
import { useAuth, useMeta, useToast } from '../context.jsx';
import { Modal, StatusBadge, RiskBadge, MultiSelect } from './ui.jsx';

/** SQLite UTC "YYYY-MM-DD HH:MM:SS" -> local, readable */
export const fmtStamp = (s) => {
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return isNaN(d) ? s : d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Findings / discussion thread between officers and admins on one case.
 *  base: API path of the case, e.g. `/edd/cases/12` or `/modules/cases/3` */
/** readOnly: list only, no compose box (view-only Master Data) */
export function Remarks({ base, onCount, readOnly }) {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef();

  useEffect(() => { api(`${base}/remarks`).then(setItems).catch((e) => { setItems([]); toast(e.message, 'error'); }); }, [base]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [items?.length]);

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const list = await api(`${base}/remarks`, { method: 'POST', body: { body: text } });
      setItems(list); setText(''); onCount?.(list.length);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="remarks">
      <div className="remarks-list">
        {items === null && <div className="muted">Loading…</div>}
        {items?.length === 0 && <div className="muted remarks-empty">No remarks yet. Record findings, questions or decisions for this case.</div>}
        {items?.map((r) => (
          <div key={r.id} className={`remark ${r.user_id === user.id ? 'mine' : ''}`}>
            <div className="remark-head">
              <b>{r.user_name || 'Deleted user'}</b>
              {r.user_role === 'admin' ? <span className="badge admin">Admin</span> : r.user_title && <span className="muted">{r.user_title}</span>}
              <span className="muted remark-time">{fmtStamp(r.created_at)}</span>
            </div>
            <div className="remark-body">{r.body}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {!readOnly && <div className="remark-compose">
        <textarea id="remark-input" className="input" rows={3} maxLength={4000} placeholder="Add a remark… (⌘/Ctrl + Enter to send)"
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
        <div className="row">
          <span className="muted" style={{ fontSize: 12 }}>Remarks are permanent and visible to everyone with access to this case.</span>
          <button id="btn-remark" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} disabled={!text.trim() || busy} onClick={send}>
            {busy ? 'Posting…' : 'Post remark'}
          </button>
        </div>
      </div>}
    </div>
  );
}

/** Small count marker shown next to a request # */
export function RemarkCount({ n }) {
  return n ? <span className="remark-count" title={`${n} remark(s)`}>💬 {n}</span> : null;
}

/** Case detail + remarks + history modal (shared) */
export function CaseDetail({ c, onClose, onRemarks, onDelete }) {
  const [history, setHistory] = useState([]);
  useEffect(() => { api(`/edd/cases/${c.id}/history`).then(setHistory).catch(() => {}); }, [c.id]);
  return (
    <Modal size="xl" title={`${c.request_no} · ${c.company}`} onClose={onClose} footer={<>
      {onDelete && <button id="btn-delete-edd" className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={onDelete}>🗑 Delete application</button>}
      <button className="btn" onClick={onClose}>Close</button></>}>
      <div className="detail-split">
        <div className="detail-main">
          <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            <span className="tag">{c.bu}</span><span className="tag">{c.app_type}</span><StatusBadge status={c.edd_status} />
            {c.resubmission_count > 0 && <span className="badge resub">Resubmitted ×{c.resubmission_count}</span>}
            {c.is_history ? <span className="badge">History import</span> : null}
          </div>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div><div className="muted">Assigned to</div><b>{c.assigned_name || 'Unassigned'}</b></div>
            <div><div className="muted">Salesforce owner</div><b>{c.owner_name || '—'}</b></div>
            <div><div className="muted">Risk rating</div><RiskBadge risk={c.risk_rating} /></div>
            <div><div className="muted">Root cause</div>{c.root_causes.length ? c.root_causes.map((r) => <span key={r} className="tag">{r}</span>) : '—'}</div>
          </div>
          <div className="table-wrap kv-table">
            <table><tbody>{Object.entries(c.data).map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td>{String(v)}</td></tr>)}</tbody></table>
          </div>
          <h3 className="detail-h">Activity</h3>
          {history.map((h) => (
            <div key={h.id} className="activity-row">
              <b>{h.type}</b>
              {h.type === 'transfer' && <> · {h.from_name || 'Unassigned'} → {h.to_name}</>}
              {h.detail && <> · {h.detail}</>} · by {h.by_name || 'system'} · {fmtStamp(h.at)}
            </div>
          ))}
        </div>
        <aside className="detail-side">
          <h3 className="detail-h" style={{ marginTop: 0 }}>Remarks &amp; findings</h3>
          <Remarks base={`/edd/cases/${c.id}`} onCount={(n) => onRemarks?.(c.id, n)} />
        </aside>
      </div>
    </Modal>
  );
}

/**
 * Officer work table.
 * Every application type in one list (BU and Application Type columns).
 * tab: 'work' | 'awaiting' | 'approved'
 */
export default function WorkTable({ tab, scope, onChanged }) {
  const { user } = useAuth();
  const meta = useMeta();
  const toast = useToast();
  const [cases, setCases] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [bu, setBu] = useState('');
  const [selected, setSelected] = useState([]);
  const [transfer, setTransfer] = useState(null);
  const [detail, setDetail] = useState(null);
  const isAdmin = user.role === 'admin';
  const editable = tab !== 'approved';

  const load = () => {
    setLoading(true);
    api('/edd/my-cases' + qs({ tab, scope, search, bu })).then((c) => { setCases(c); setSelected([]); })
      .catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  };
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [tab, scope, search, bu]);
  useEffect(() => { api('/users').then(setUsers).catch(() => {}); }, []);

  const patch = async (c, body) => {
    try {
      const updated = await api(`/edd/cases/${c.id}`, { method: 'PATCH', body });
      if ('edd_status' in body && body.edd_status) {
        setCases((cs) => cs.filter((x) => x.id !== c.id));
        toast(`${c.request_no} → ${body.edd_status}. Moved to ${body.edd_status === 'Approved' ? 'Approved' : 'Awaiting Client'}.`);
        onChanged?.();
      } else setCases((cs) => cs.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) { toast(e.message, 'error'); }
  };

  const doTransfer = async () => {
    try {
      const r = await api('/edd/cases/transfer', { method: 'POST', body: { caseIds: transfer.ids, toUserId: transfer.to, reason: transfer.reason } });
      toast(`${r.transferred} case(s) transferred`); setTransfer(null); load(); onChanged?.();
    } catch (e) { toast(e.message, 'error'); }
  };

  const showRiskCols = tab === 'work' ? cases.some((c) => c.is_new) : true;
  const allChecked = cases.length > 0 && selected.length === cases.length;
  const showAssignee = isAdmin && scope !== 'mine';

  const exportRows = () => exportCSV(`edd-${tab}.csv`, cases, [
    { label: 'Service Request#', get: (c) => c.request_no }, { label: 'Company Name', get: (c) => c.company },
    { label: 'Risk Rating', get: (c) => c.risk_rating }, { label: 'Root Cause', get: (c) => c.root_causes.join('; ') },
    { label: 'BU', get: (c) => c.bu }, { label: 'Created Date', get: (c) => fmtDate(c.created_date) },
    { label: 'Application Type', get: (c) => c.app_type },
    { label: 'Status', get: (c) => c.edd_status || 'Open' }, { label: 'Assigned To', get: (c) => c.assigned_name },
  ]);

  return (
    <div className="card">
      <div className="toolbar">
        <input id={`search-${tab}`} className="input grow" placeholder="Search request #, company…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={bu} onChange={(e) => setBu(e.target.value)} id="filter-bu">
          <option value="">All BUs</option>{meta.bus.map((b) => <option key={b}>{b}</option>)}
        </select>
        <button className="btn" onClick={exportRows} disabled={!cases.length}>⤓ Export</button>
      </div>

      {selected.length > 0 && (
        <div className="row card" style={{ padding: '10px 14px', marginBottom: 12, background: 'hsla(252 90% 67% / .1)' }}>
          <b>{selected.length} selected</b>
          <button id="btn-transfer" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}
            onClick={() => setTransfer({ ids: selected, to: '', reason: '' })}>⇄ Transfer</button>
          <button className="btn btn-sm" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="col-check"><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? [] : cases.map((c) => c.id))} /></th>
              <th>Service Request#</th>
              <th>Company Name</th>
              {showRiskCols && <><th>Risk Rating</th><th>Root Cause</th></>}
              <th>BU</th>
              <th>Created Date</th>
              <th>Application Type</th>
              {showAssignee && <th>Assigned to</th>}
              {tab !== 'work' && <th>Status date</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className={selected.includes(c.id) ? 'selected' : ''}>
                <td><input type="checkbox" checked={selected.includes(c.id)} onChange={() => setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))} /></td>
                <td>
                  <a href="#" onClick={(e) => { e.preventDefault(); setDetail(c); }} className="cell-link">{c.request_no}</a>
                  <div className="row" style={{ marginTop: 4, gap: 6 }}>
                    <RemarkCount n={c.remark_count} />
                    {c.resubmission_count > 0
                      ? <span className="badge resub" title={`Resubmitted ${c.resubmitted_at}`}>Resubmitted</span>
                      : tab === 'work' && <span className="badge new">New</span>}
                  </div>
                </td>
                <td className="col-company">{c.company}</td>
                {showRiskCols && (
                  c.is_new && editable ? (<>
                    <td>
                      <select className="input cell-select" value={c.risk_rating || ''} onChange={(e) => patch(c, { risk_rating: e.target.value })}>
                        <option value="">Select…</option>{meta.riskRatings.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td><MultiSelect options={meta.rootCauses} value={c.root_causes} onChange={(v) => patch(c, { root_causes: v })} /></td>
                  </>) : (<>
                    <td><RiskBadge risk={c.risk_rating} /></td>
                    <td className="col-tags">{c.root_causes.length ? c.root_causes.map((r) => <span key={r} className="tag">{r}</span>) : <span className="muted">—</span>}</td>
                  </>)
                )}
                <td><span className="tag">{c.bu}</span></td>
                <td>{fmtDate(c.created_date)}</td>
                <td title={c.record_type}>{c.app_type}</td>
                {showAssignee && <td>{c.assigned_name || <span className="badge leave">Unassigned</span>}</td>}
                {tab !== 'work' && <td className="muted">{fmtDate(c.status_at)}</td>}
                <td>
                  {editable && (c.assigned_to === user.id || isAdmin) ? (
                    <select className="input cell-select" value={c.edd_status || ''} id={`status-${c.id}`}
                      onChange={(e) => e.target.value && patch(c, { edd_status: e.target.value })}>
                      <option value="">{tab === 'work' ? 'Select status…' : c.edd_status}</option>
                      {meta.eddStatuses.filter((s) => s !== c.edd_status).map((s) => <option key={s}>{s}</option>)}
                    </select>
                  ) : <StatusBadge status={c.edd_status} />}
                </td>
              </tr>
            ))}
            {!cases.length && <tr><td colSpan={20} className="empty">{loading ? 'Loading…' : tab === 'work' ? '🎉 Queue clear: nothing pending' : 'Nothing here yet'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        {cases.length} record(s)
        {tab === 'awaiting' && ' · these return to the work queue automatically when the client resubmits (same request # in a new upload)'}
      </div>

      {transfer && (
        <Modal title={`Transfer ${transfer.ids.length} case(s)`} onClose={() => setTransfer(null)}
          footer={<><button className="btn" onClick={() => setTransfer(null)}>Cancel</button>
            <button id="btn-confirm-transfer" className="btn btn-primary" disabled={!transfer.to} onClick={doTransfer}>Transfer</button></>}>
          <div className="grid">
            <div className="field"><label>Transfer to</label>
              <select id="transfer-to" className="input" value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })}>
                <option value="">Select an available officer…</option>
                {users.filter((u) => u.status === 'active').map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` (${u.title})` : ''} · {u.open_cases} open</option>)}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>Officers on leave are hidden.</span>
            </div>
            <div className="field"><label>Reason</label>
              <textarea id="transfer-reason" className="input" rows={3} placeholder="e.g. Officer on annual leave" value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
      {detail && <CaseDetail c={detail} onClose={() => setDetail(null)}
        onRemarks={(id, n) => setCases((cs) => cs.map((x) => (x.id === id ? { ...x, remark_count: n } : x)))} />}
    </div>
  );
}
