import React, { useEffect, useState } from 'react';
import { api, qs, fmtDate, exportCSV } from '../api.js';
import { useMeta, useToast } from '../context.jsx';
import { StatusBadge, RiskBadge } from '../components/ui.jsx';
import { CaseDetail } from '../components/WorkTable.jsx';

export default function MasterData() {
  const meta = useMeta();
  const toast = useToast();
  const [cases, setCases] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [f, setF] = useState({ search: '', bu: '', app_type: '', status: '', risk: '', assignee: '', from: '', to: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { api('/users').then(setUsers).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api('/edd/master' + qs(f)).then(setCases).catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(f)]);

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
          <p>Every EDD application across all BUs and officers.</p></div>
        <span className="badge">🔒 View only</span>
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
        <div className="table-wrap">
          <table>
            <thead><tr><th>Service Request#</th><th>Company Name</th><th>BU</th><th>Created Date</th><th>Application Type</th><th>Risk</th><th>Root Cause</th><th>Assigned to</th><th>Status</th><th>Status date</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td><a href="#" onClick={(e) => { e.preventDefault(); setDetail(c); }} style={{ color: 'var(--primary-2)', fontWeight: 600 }}>{c.request_no}</a>
                    {c.resubmission_count > 0 && <> <span className="badge resub">×{c.resubmission_count}</span></>}</td>
                  <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{c.company}</td>
                  <td><span className="tag">{c.bu}</span></td>
                  <td>{fmtDate(c.created_date)}</td>
                  <td title={c.record_type}>{c.app_type}</td>
                  <td><RiskBadge risk={c.risk_rating} /></td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{c.root_causes.map((r) => <span key={r} className="tag">{r}</span>)}</td>
                  <td>{c.assigned_name || <span className="badge leave">Unassigned</span>}</td>
                  <td><StatusBadge status={c.edd_status} />{c.is_history ? <span className="muted" style={{ fontSize: 11 }}> history</span> : null}</td>
                  <td className="muted">{fmtDate(c.status_at)}</td>
                </tr>
              ))}
              {!cases.length && <tr><td colSpan={10} className="empty">{loading ? 'Loading…' : 'No records'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>{cases.length} record(s) · read-only</div>
      </div>
      {detail && <CaseDetail c={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
