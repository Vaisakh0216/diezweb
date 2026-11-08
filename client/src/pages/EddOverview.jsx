import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../context.jsx';

export default function EddOverview() {
  const { user } = useAuth();
  const [c, setC] = useState(null);
  const [uploads, setUploads] = useState([]);
  useEffect(() => {
    api('/edd/counts').then(setC).catch(() => {});
    api('/edd/uploads').then(setUploads).catch(() => {});
  }, []);
  const v = (x) => (c ? x : '–');

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Enhanced Due Diligence</div><h1>Welcome, {user.name.split(' ')[0]} 👋</h1>
          <p>{user.title} · {user.bus.map((b) => <span key={b} className="tag">{b}</span>)}</p></div>
        <div className="row">
          <Link to="/edd/upload" className="btn btn-primary" id="btn-goto-upload">⤒ Bulk Upload</Link>
          <Link to="/edd/cases" className="btn">My Work</Link>
        </div>
      </div>
      <div className="grid stats">
        <div className="card stat"><div className="label">Work queue</div><div className="value">{v(c?.work_lr + c?.work_other)}</div></div>
        <div className="card stat" style={{ '--accent': 'var(--primary-2)' }}><div className="label">New applications</div><div className="value">{v(c?.new_apps)}</div></div>
        <div className="card stat" style={{ '--accent': 'hsl(280 90% 70%)' }}><div className="label">Resubmitted</div><div className="value">{v(c?.resubmitted)}</div></div>
        <div className="card stat" style={{ '--accent': 'var(--warning)' }}><div className="label">Awaiting client</div><div className="value">{v(c?.awaiting_lr + c?.awaiting_other)}</div></div>
        <div className="card stat" style={{ '--accent': 'var(--success)' }}><div className="label">Approved</div><div className="value">{v(c?.approved_lr + c?.approved_other)}</div></div>
        {user.role === 'admin' && <div className="card stat" style={{ '--accent': 'var(--danger)' }}><div className="label">Unassigned</div><div className="value">{v(c?.unassigned)}</div></div>}
      </div>
      <div className="card">
        <h3 style={{ fontSize: 17, marginBottom: 14 }}>Recent uploads</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>File</th><th>System</th><th>By</th><th>Date range</th><th>New</th><th>Resubmitted</th><th>History</th><th>Skipped</th><th>When</th></tr></thead>
            <tbody>
              {uploads.map((u) => {
                const s = u.stats || {};
                return (
                  <tr key={u.id}><td>{u.filename}</td><td><span className="tag">{u.system}</span></td><td>{u.uploaded_by_name}</td>
                    <td>{fmtDate(u.date_from)} → {fmtDate(u.date_to)}</td><td style={{ color: 'var(--primary-2)' }}>{s.newCases ?? 0}</td>
                    <td>{s.resubmitted ?? 0}</td><td>{s.history ?? 0}</td>
                    <td className="muted">{(s.outOfRange || 0) + (s.unmapped || 0) + (s.dupInFile || 0) + (s.alreadyOpen || 0) + (s.alreadyApproved || 0)}</td>
                    <td className="muted">{u.created_at}</td></tr>
                );
              })}
              {!uploads.length && <tr><td colSpan={9} className="empty">No uploads yet. <Link to="/edd/upload" style={{ color: 'var(--primary-2)' }}>Upload an export</Link></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
