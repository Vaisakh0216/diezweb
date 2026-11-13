import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs, fmtDate, exportCSV } from '../api.js';
import { useAuth, useMeta, useToast } from '../context.jsx';
import { StatusBadge, RiskBadge, Modal } from '../components/ui.jsx';
import { CaseDetail, RemarkCount } from '../components/WorkTable.jsx';

export default function MasterData() {
  const meta = useMeta();
  const toast = useToast();
  const [cases, setCases] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [selected, setSelected] = useState([]);
  const [transfer, setTransfer] = useState(null); // { ids, to, reason }
  const [del, setDel] = useState(null); // applications to delete
  const [params] = useSearchParams(); // e.g. ?assignee=7 from the team workload on the overview
  const [f, setF] = useState({ search: '', bu: '', app_type: '', status: '', risk: '', assignee: params.get('assignee') || '', from: '', to: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const loadUsers = () => api('/users').then(setUsers).catch(() => {});
  useEffect(() => { loadUsers(); }, []);
  const load = () => {
    setLoading(true);
    return api('/edd/master' + qs(f)).then((c) => { setCases(c); setSelected((s) => s.filter((id) => c.some((x) => x.id === id))); })
      .catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [JSON.stringify(f)]);

  // admins select any application (delete); only those still in progress can be assigned / transferred
  const allChecked = cases.length > 0 && cases.every((c) => selected.includes(c.id));
  const someChecked = selected.length > 0 && !allChecked;
  const movableSel = cases.filter((c) => selected.includes(c.id) && c.edd_status !== 'Approved').map((c) => c.id);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const doTransfer = async () => {
    try {
      const r = await api('/edd/cases/transfer', { method: 'POST', body: { caseIds: transfer.ids, toUserId: transfer.to, reason: transfer.reason } });
      const to = users.find((u) => String(u.id) === transfer.to)?.name;
      toast(`${r.transferred} application(s) assigned to ${to}`); setTransfer(null); setSelected([]); load(); loadUsers();
    } catch (e) { toast(e.message, 'error'); }
  };

  const exportRows = () => exportCSV(`edd-master-${new Date().toISOString().slice(0, 10)}.csv`, cases, [
    { label: 'Service Request#', get: (c) => c.request_no }, { label: 'Company Name', get: (c) => c.company }, { label: 'BU', get: (c) => c.bu },
    { label: 'Created Date', get: (c) => fmtDate(c.created_date) }, { label: 'Salesforce Template', get: (c) => c.record_type },
    { label: 'Application Type', get: (c) => c.app_type }, { label: 'Risk Rating', get: (c) => c.risk_rating },
    { label: 'Root Cause', get: (c) => c.root_causes.join('; ') }, { label: 'EDD Status', get: (c) => c.edd_status || 'Open' },
    { label: 'Status Date', get: (c) => fmtDate(c.status_at) }, { label: 'Resubmissions', get: (c) => c.resubmission_count },
    { label: 'Assigned To', get: (c) => c.assigned_name || 'Unassigned' }, { label: 'Salesforce Owner', get: (c) => c.owner_name },
  ]);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Enhanced Due Diligence</div><h1>Master Data</h1>
          <p>Every EDD application across all BUs and officers.{isAdmin ? ' Select applications to assign, transfer or delete them.' : ''}</p></div>
        {!isAdmin && <span className="badge">🔒 View only</span>}
      </div>
      <div className="card">
        <div className="toolbar">
          <input id="master-search" className="input grow" placeholder="Search request #, company, template…" value={f.search} onChange={set('search')} />
          <select className="input" value={f.bu} onChange={set('bu')}><option value="">All BUs</option>{meta.bus.map((b) => <option key={b}>{b}</option>)}</select>
          <select className="input" value={f.app_type} onChange={set('app_type')}><option value="">All application types</option>{meta.appTypes.map((b) => <option key={b}>{b}</option>)}</select>
          <select className="input" value={f.status} onChange={set('status')}><option value="">All statuses</option><option>Open</option>{meta.eddStatuses.map((b) => <option key={b}>{b}</option>)}</select>
          <select className="input" value={f.risk} onChange={set('risk')}><option value="">All risk</option>{meta.riskRatings.map((b) => <option key={b}>{b}</option>)}</select>
          <select className="input" value={f.assignee} onChange={set('assignee')}><option value="">All officers</option><option value="unassigned">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <input type="date" className="input" value={f.from} onChange={set('from')} title="Created from" />
          <input type="date" className="input" value={f.to} onChange={set('to')} title="Created to" />
          <button className="btn" onClick={exportRows} disabled={!cases.length}>⤓ Export</button>
        </div>
        {isAdmin && selected.length > 0 && (
          <div className="row card select-bar">
            <b>{selected.length} selected</b>
            <button id="btn-transfer" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} disabled={!movableSel.length}
              title={movableSel.length ? '' : 'Approved applications cannot be reassigned'}
              onClick={() => setTransfer({ ids: movableSel, to: '', reason: '' })}>⇄ Assign / transfer{movableSel.length !== selected.length && movableSel.length ? ` (${movableSel.length})` : ''}</button>
            <button id="btn-edd-delete" className="btn btn-danger btn-sm" onClick={() => setDel(cases.filter((c) => selected.includes(c.id)))}>🗑 Delete</button>
            <button className="btn btn-sm" onClick={() => setSelected([])}>Clear</button>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr>{isAdmin && <th className="col-check"><input type="checkbox" id="edd-select-all" aria-label="Select all" checked={allChecked}
              ref={(el) => el && (el.indeterminate = someChecked)}
              onChange={() => setSelected(allChecked ? [] : cases.map((c) => c.id))} /></th>}<th>Service Request#</th><th>Company Name</th><th>BU</th><th>Created Date</th><th>Application Type</th><th>Risk</th><th>Root Cause</th><th>Assigned to</th><th>Status</th><th>Status date</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className={selected.includes(c.id) ? 'selected' : ''}>
                  {isAdmin && <td className="col-check"><input type="checkbox" aria-label={`Select ${c.request_no}`} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} /></td>}
                  <td><a href="#" onClick={(e) => { e.preventDefault(); setDetail(c); }} className="cell-link">{c.request_no}</a>
                    {c.resubmission_count > 0 && <> <span className="badge resub">×{c.resubmission_count}</span></>}
                    {c.remark_count > 0 && <> <RemarkCount n={c.remark_count} /></>}</td>
                  <td className="col-company">{c.company}</td>
                  <td><span className="tag">{c.bu}</span></td>
                  <td>{fmtDate(c.created_date)}</td>
                  <td title={c.record_type}>{c.app_type}</td>
                  <td><RiskBadge risk={c.risk_rating} /></td>
                  <td className="col-tags">{c.root_causes.map((r) => <span key={r} className="tag">{r}</span>)}</td>
                  <td>{c.assigned_name || <span className="badge leave">Unassigned</span>}</td>
                  <td><StatusBadge status={c.edd_status} />{c.is_history ? <span className="muted" style={{ fontSize: 11 }}> history</span> : null}</td>
                  <td className="muted">{fmtDate(c.status_at)}</td>
                </tr>
              ))}
              {!cases.length && <tr><td colSpan={isAdmin ? 11 : 10} className="empty">{loading ? 'Loading…' : 'No records'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>{cases.length} record(s){isAdmin ? ' · approved applications can be deleted but not reassigned' : ' · read-only'}</div>
      </div>
      {transfer && (
        <Modal title={`Assign / transfer ${transfer.ids.length} application(s)`} onClose={() => setTransfer(null)}
          footer={<><button className="btn" onClick={() => setTransfer(null)}>Cancel</button>
            <button id="btn-confirm-transfer" className="btn btn-primary" disabled={!transfer.to} onClick={doTransfer}>Assign</button></>}>
          <div className="grid">
            <div className="field"><label htmlFor="transfer-to">Assign to</label>
              <select id="transfer-to" className="input" value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })}>
                <option value="">Select an available officer…</option>
                {users.filter((u) => u.status === 'active').map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` (${u.title})` : ''} · {u.open_cases ?? 0} open</option>)}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>Officers on leave are hidden.</span>
            </div>
            <div className="field"><label htmlFor="transfer-reason">Reason</label>
              <textarea id="transfer-reason" className="input" rows={3} placeholder="e.g. Officer on annual leave" value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
      {detail && <CaseDetail c={detail} onClose={() => setDetail(null)} onDelete={isAdmin ? () => { setDel([detail]); setDetail(null); } : null}
        onRemarks={(id, n) => setCases((cs) => cs.map((x) => (x.id === id ? { ...x, remark_count: n } : x)))} />}
      {del && <DeleteApplications list={del} onClose={() => setDel(null)}
        onDeleted={(ids) => { setCases((cs) => cs.filter((c) => !ids.includes(c.id))); setSelected((s) => s.filter((id) => !ids.includes(id))); loadUsers(); }} />}
    </>
  );
}

/** Confirm deleting one or more EDD applications (reason required; a copy is kept in the deletion log). */
function DeleteApplications({ list, onClose, onDeleted }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const remarks = list.reduce((n, c) => n + (c.remark_count || 0), 0);
  const del = async () => {
    setBusy(true); setErr('');
    try {
      const ids = list.map((c) => c.id);
      const r = await api('/edd/cases/delete', { method: 'POST', body: { caseIds: ids, reason } });
      toast(`${r.deleted} application(s) deleted`); onDeleted(ids); onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={list.length === 1 ? `Delete ${list[0].request_no}?` : `Delete ${list.length} applications?`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button id="btn-confirm-edd-delete" className="btn btn-danger" disabled={busy || !reason.trim()} onClick={del}>{busy ? 'Deleting…' : 'Delete permanently'}</button></>}>
      <div className="grid">
        {err && <div className="error-box">{err}</div>}
        <div className="error-box">
          This removes the application{list.length > 1 ? 's' : ''} from every list, together with {remarks ? `${remarks} remark(s)` : 'any remarks'} and
          the activity history. A copy is kept in the deletion log for audit. This cannot be undone from the app.
          If the same request appears in a later Salesforce upload, it is imported again as a new application.
        </div>
        <div className="table-wrap" style={{ maxHeight: 200 }}>
          <table><tbody>
            {list.map((c) => (
              <tr key={c.id}><td><b>{c.request_no}</b></td><td className="col-wrap">{c.company}</td><td><StatusBadge status={c.edd_status} /></td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="field"><label htmlFor="edd-del-reason">Reason for deleting <span className="req">*</span></label>
          <textarea id="edd-del-reason" className="input" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Duplicate import / uploaded by mistake" /></div>
      </div>
    </Modal>
  );
}
