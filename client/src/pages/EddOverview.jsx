import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context.jsx';

export default function EddOverview() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [uploads, setUploads] = useState([]);

  useEffect(() => {
    api('/edd/stats').then(setStats).catch(() => {});
    api('/edd/uploads').then(setUploads).catch(() => {});
  }, []);

  const count = (arr, s) => (arr || []).filter((x) => !s || x.status === s).reduce((a, b) => a + b.c, 0);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Enhanced Due Diligence</div><h1>Welcome, {user.name.split(' ')[0]} 👋</h1>
          <p>Your duties: {user.duties.length ? user.duties.map((d) => <span key={d} className="tag">{d}</span>) : 'none assigned'}</p></div>
        <div className="row">
          <Link to="/edd/upload" className="btn btn-primary" id="btn-goto-upload">⤒ Bulk Upload</Link>
          <Link to="/edd/cases" className="btn">My Cases</Link>
        </div>
      </div>

      <div className="grid stats">
        <div className="card stat"><div className="label">My open cases</div><div className="value">{stats ? count(stats.mine) - count(stats.mine, 'Completed') : '–'}</div></div>
        <div className="card stat" style={{ '--accent': 'var(--warning)' }}><div className="label">Pending</div><div className="value">{stats ? count(stats.mine, 'Pending') : '–'}</div></div>
        <div className="card stat" style={{ '--accent': 'var(--primary-2)' }}><div className="label">In progress</div><div className="value">{stats ? count(stats.mine, 'In Progress') : '–'}</div></div>
        <div className="card stat" style={{ '--accent': 'var(--success)' }}><div className="label">Completed</div><div className="value">{stats ? count(stats.mine, 'Completed') : '–'}</div></div>
        <div className="card stat" style={{ '--accent': 'hsl(280 90% 70%)' }}><div className="label">All EDD records</div><div className="value">{stats ? count(stats.all) : '–'}</div></div>
        {user.role === 'admin' && <div className="card stat" style={{ '--accent': 'var(--danger)' }}><div className="label">Unassigned</div><div className="value">{stats?.unassigned ?? '–'}</div></div>}
      </div>

      <div className="card">
        <h3 style={{ fontSize: 17, marginBottom: 14 }}>Recent uploads</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>File</th><th>Uploaded by</th><th>Date range</th><th>Rows</th><th>Imported</th><th>Skipped</th><th>When</th></tr></thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}><td>{u.filename}</td><td>{u.uploaded_by_name}</td><td>{u.date_from} → {u.date_to}</td>
                  <td>{u.total_rows}</td><td style={{ color: 'var(--success)' }}>{u.matched_rows}</td><td className="muted">{u.skipped_rows}</td><td className="muted">{u.created_at}</td></tr>
              ))}
              {!uploads.length && <tr><td colSpan={7} className="empty">No uploads yet. <Link to="/edd/upload" style={{ color: 'var(--primary-2)' }}>Upload a file</Link></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
