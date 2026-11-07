import React, { useEffect, useMemo, useState } from 'react';
import { api, DUTIES, STATUSES, qs, exportCSV } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { Modal, StatusBadge, dataColumns } from './ui.jsx';

/**
 * Shared EDD case table.
 *  mode="mine"   -> editable: status change + transfer (admins can switch scope to all/unassigned)
 *  mode="master" -> read-only view of every case
 */
export default function CasesTable({ mode }) {
  const { user } = useAuth();
  const toast = useToast();
  const readOnly = mode === 'master';
  const isAdmin = user.role === 'admin';

  const [cases, setCases] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', duty: '', status: '', assignee: '', from: '', to: '' });
  const [scope, setScope] = useState('mine'); // admin-only in mine mode: mine | all | unassigned
  const [selected, setSelected] = useState([]);
  const [transfer, setTransfer] = useState(null);
  const [detail, setDetail] = useState(null);

  const endpoint = readOnly || scope !== 'mine' ? '/edd/master' : '/edd/my-cases';
  const effFilters = scope === 'unassigned' ? { ...filters, assignee: 'unassigned' } : filters;

  const load = () => {
    setLoading(true);
    api(endpoint + qs(effFilters)).then((c) => { setCases(c); setSelected([]); })
      .catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [JSON.stringify(effFilters), endpoint]);
  useEffect(() => { api('/users').then(setUsers).catch(() => {}); }, []);

  const cols = useMemo(() => dataColumns(cases, [], 5), [cases]);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const canEdit = !readOnly;
  const allChecked = cases.length > 0 && selected.length === cases.length;

  const updateStatus = async (c, status) => {
    try { await api(`/edd/cases/${c.id}`, { method: 'PATCH', body: { status } }); setCases((cs) => cs.map((x) => x.id === c.id ? { ...x, status } : x)); }
    catch (e) { toast(e.message, 'error'); }
  };

  const doTransfer = async () => {
    try {
      const r = await api('/edd/cases/transfer', { method: 'POST', body: { caseIds: transfer.ids, toUserId: transfer.to, reason: transfer.reason } });
      toast(`${r.transferred} case(s) transferred`);
      setTransfer(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const openDetail = async (c) => {
    const history = await api(`/edd/cases/${c.id}/history`).catch(() => []);
    setDetail({ ...c, history });
  };

  const exportRows = () => exportCSV(`edd-${mode}-${new Date().toISOString().slice(0, 10)}.csv`, cases, [
    { label: 'Case ID', get: (c) => c.id }, { label: 'Duty', get: (c) => c.duty }, { label: 'Record Date', get: (c) => c.record_date },
    { label: 'Assigned To', get: (c) => c.assigned_name || 'Unassigned' }, { label: 'Status', get: (c) => c.status },
    ...Object.keys(cases[0]?.data || {}).map((k) => ({ label: k, get: (c) => c.data[k] })),
  ]);

  const targetUsers = users.filter((u) => u.status === 'active' && (!transfer || !transfer.fromIds?.includes(u.id)));

  return (
    <div className="card">
      <div className="toolbar">
        {canEdit && isAdmin && (
          <div className="chips" style={{ marginRight: 6 }}>
            {[['mine', 'My cases'], ['all', 'All cases'], ['unassigned', 'Unassigned']].map(([k, l]) => (
              <button key={k} id={`scope-${k}`} className={`chip-toggle ${scope === k ? 'on' : ''}`} onClick={() => setScope(k)}>{l}</button>
            ))}
          </div>
        )}
        <input id="cases-search" className="input grow" placeholder="Search any field…" value={filters.search} onChange={set('search')} />
        <select id="filter-duty" className="input" value={filters.duty} onChange={set('duty')}>
          <option value="">All duties</option>{DUTIES.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select id="filter-status" className="input" value={filters.status} onChange={set('status')}>
          <option value="">All statuses</option>{STATUSES.map((d) => <option key={d}>{d}</option>)}
        </select>
        {(readOnly || scope === 'all') && (
          <select id="filter-assignee" className="input" value={filters.assignee} onChange={set('assignee')}>
            <option value="">All assignees</option><option value="unassigned">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <input id="filter-from" type="date" className="input" value={filters.from} onChange={set('from')} title="Record date from" />
        <input id="filter-to" type="date" className="input" value={filters.to} onChange={set('to')} title="Record date to" />
        <button className="btn" onClick={exportRows} disabled={!cases.length} id="btn-export">⤓ Export</button>
      </div>

      {canEdit && selected.length > 0 && (
        <div className="row card" style={{ padding: '10px 14px', marginBottom: 12, background: 'hsla(252 90% 67% / .1)' }}>
          <b>{selected.length} selected</b>
          <button id="btn-transfer" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}
            onClick={() => setTransfer({ ids: selected, to: '', reason: '', fromIds: [...new Set(cases.filter((c) => selected.includes(c.id)).map((c) => c.assigned_to))] })}>
            ⇄ Transfer {isAdmin && scope === 'unassigned' ? '/ Assign' : ''}
          </button>
          <button className="btn btn-sm" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {canEdit && <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? [] : cases.map((c) => c.id))} /></th>}
              <th>Case</th><th>Duty</th><th>Record date</th>
              {cols.map((c) => <th key={c}>{c}</th>)}
              <th>Assigned to</th><th>Status</th>{canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className={selected.includes(c.id) ? 'selected' : ''}>
                {canEdit && <td><input type="checkbox" checked={selected.includes(c.id)} onChange={() => setSelected((s) => s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id])} /></td>}
                <td><a href="#" onClick={(e) => { e.preventDefault(); openDetail(c); }} style={{ color: 'var(--primary-2)', fontWeight: 600 }}>EDD-{String(c.id).padStart(5, '0')}</a></td>
                <td><span className="tag">{c.duty}</span></td>
                <td>{c.record_date}</td>
                {cols.map((k) => <td key={k} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(c.data[k] ?? '')}</td>)}
                <td>{c.assigned_name || <span className="badge leave">Unassigned</span>}</td>
                <td>
                  {canEdit && (c.assigned_to === user.id || isAdmin) && c.assigned_to ? (
                    <select className="input" style={{ padding: '5px 8px', width: 130 }} value={c.status} onChange={(e) => updateStatus(c, e.target.value)}>
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  ) : <StatusBadge status={c.status} />}
                </td>
                {canEdit && <td><button className="btn btn-sm" onClick={() => setTransfer({ ids: [c.id], to: '', reason: '', fromIds: [c.assigned_to] })}>⇄</button></td>}
              </tr>
            ))}
            {!cases.length && <tr><td colSpan={20} className="empty">{loading ? 'Loading…' : 'No cases found'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>{cases.length} record(s){readOnly && ' · read-only view'}</div>

      {transfer && (
        <Modal title={`Transfer ${transfer.ids.length} case(s)`} onClose={() => setTransfer(null)}
          footer={<><button className="btn" onClick={() => setTransfer(null)}>Cancel</button>
            <button id="btn-confirm-transfer" className="btn btn-primary" disabled={!transfer.to} onClick={doTransfer}>Transfer</button></>}>
          <div className="grid">
            <div className="field"><label>Transfer to</label>
              <select id="transfer-to" className="input" value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })}>
                <option value="">Select an available user…</option>
                {targetUsers.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.duties.join(', ') || 'no duties'} ({u.open_cases} open)</option>)}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>Users on leave are hidden.</span>
            </div>
            <div className="field"><label>Reason</label>
              <textarea id="transfer-reason" className="input" rows={3} placeholder="e.g. Assignee on leave until Monday" value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal wide title={`EDD-${String(detail.id).padStart(5, '0')}`} onClose={() => setDetail(null)} footer={<button className="btn" onClick={() => setDetail(null)}>Close</button>}>
          <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            <span className="tag">{detail.duty}</span><StatusBadge status={detail.status} />
            <span className="muted">Assigned to <b style={{ color: 'var(--text)' }}>{detail.assigned_name || 'Unassigned'}</b> · Record date {detail.record_date}</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 320 }}>
            <table><tbody>{Object.entries(detail.data).map(([k, v]) => <tr key={k}><td className="muted" style={{ width: '35%' }}>{k}</td><td style={{ whiteSpace: 'normal' }}>{String(v)}</td></tr>)}</tbody></table>
          </div>
          <h3 style={{ fontSize: 15, margin: '20px 0 10px' }}>Transfer history</h3>
          {detail.history.length ? detail.history.map((h) => (
            <div key={h.id} className="muted" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <b style={{ color: 'var(--text)' }}>{h.from_name || 'Unassigned'} → {h.to_name}</b> by {h.by_name} · {h.at}{h.reason && <> · “{h.reason}”</>}
            </div>
          )) : <div className="muted">No transfers yet.</div>}
        </Modal>
      )}
    </div>
  );
}
