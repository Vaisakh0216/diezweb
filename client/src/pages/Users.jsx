import React, { useEffect, useState } from 'react';
import { api, DUTIES } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { Modal } from '../components/ui.jsx';
import { initials } from '../components/Layout.jsx';

const blank = { name: '', email: '', password: '', role: 'user', duties: [], status: 'active' };

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = () => api('/users').then(setUsers).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const toggleDuty = (d) => setForm((f) => ({ ...f, duties: f.duties.includes(d) ? f.duties.filter((x) => x !== d) : [...f.duties, d] }));

  const save = async () => {
    setError('');
    try {
      if (form.id) await api(`/users/${form.id}`, { method: 'PUT', body: form });
      else await api('/users', { method: 'POST', body: form });
      toast(form.id ? 'User updated' : 'User created');
      setForm(null); load();
    } catch (e) { setError(e.message); }
  };

  const remove = async (u) => {
    if (!confirm(`Delete ${u.name}?`)) return;
    try { await api(`/users/${u.id}`, { method: 'DELETE' }); toast('User deleted'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const toggleLeave = async (u) => {
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body: { ...u, status: u.status === 'active' ? 'on_leave' : 'active' } });
      toast(`${u.name} marked ${u.status === 'active' ? 'on leave' : 'active'}`); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const shown = users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Administration</div><h1>User Management</h1><p>Create users and assign their duties.</p></div>
        <button id="btn-new-user" className="btn btn-primary" onClick={() => { setForm(blank); setError(''); }}>＋ New User</button>
      </div>

      <div className="grid stats">
        <div className="card stat"><div className="label">Total users</div><div className="value">{users.length}</div></div>
        <div className="card stat" style={{ '--accent': 'var(--success)' }}><div className="label">Active</div><div className="value">{users.filter((u) => u.status === 'active').length}</div></div>
        <div className="card stat" style={{ '--accent': 'var(--danger)' }}><div className="label">On leave</div><div className="value">{users.filter((u) => u.status === 'on_leave').length}</div></div>
        <div className="card stat" style={{ '--accent': 'var(--primary-2)' }}><div className="label">Admins</div><div className="value">{users.filter((u) => u.role === 'admin').length}</div></div>
      </div>

      <div className="card">
        <div className="toolbar"><input id="user-search" className="input grow" placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Duties</th><th>Status</th><th>Open cases</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td><div className="row"><div className="avatar">{initials(u.name)}</div><div><div style={{ fontWeight: 600 }}>{u.name}</div><div className="muted" style={{ fontSize: 12 }}>{u.email}</div></div></div></td>
                  <td><span className={`badge ${u.role === 'admin' ? 'admin' : ''}`}>{u.role}</span></td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>{u.duties.length ? u.duties.map((d) => <span key={d} className="tag">{d}</span>) : <span className="muted">—</span>}</td>
                  <td><span className={`badge ${u.status === 'active' ? 'active' : 'leave'}`}>{u.status === 'active' ? 'Active' : 'On leave'}</span></td>
                  <td>{u.open_cases}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => toggleLeave(u)}>{u.status === 'active' ? 'Mark leave' : 'Mark active'}</button>
                      <button className="btn btn-sm" onClick={() => { setForm({ ...u, password: '' }); setError(''); }}>Edit</button>
                      {u.id !== me.id && <button className="btn btn-sm btn-danger" onClick={() => remove(u)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={6} className="empty">No users found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <Modal title={form.id ? 'Edit user' : 'Create user'} onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button id="btn-save-user" className="btn btn-primary" onClick={save}>Save</button></>}>
          <div className="form-grid">
            {error && <div className="error-box full">{error}</div>}
            <div className="field"><label>Full name</label><input id="user-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>Email</label><input id="user-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="field"><label>{form.id ? 'New password (optional)' : 'Password'}</label><input id="user-password" className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div className="field"><label>Role</label>
              <select id="user-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="user">User</option><option value="admin">Admin</option>
              </select>
            </div>
            <div className="field full"><label>Assigned duties</label>
              <div className="chips">
                {DUTIES.map((d) => (
                  <button type="button" key={d} id={`duty-${d.replace(/\s/g, '-')}`} className={`chip-toggle ${form.duties.includes(d) ? 'on' : ''}`} onClick={() => toggleDuty(d)}>
                    {form.duties.includes(d) ? '✓ ' : ''}{d}
                  </button>
                ))}
              </div>
            </div>
            <div className="field full"><label>Availability</label>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option><option value="on_leave">On leave</option>
              </select>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
