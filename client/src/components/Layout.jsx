import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context.jsx';

export const MODULES = [
  { slug: 'true-match', name: 'True Match', icon: '🎯' },
  { slug: 'hyper-monitoring', name: 'Hyper Monitoring', icon: '📡' },
  { slug: 'red-flag', name: 'Red Flag', icon: '🚩' },
  { slug: 'sar', name: 'Suspicious Activity Reported', icon: '🕵️' },
];

export const initials = (n = '') => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export default function Layout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const inEdd = pathname.startsWith('/edd');

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">S</div>
          <div><h2>Sentinel</h2><small>Due Diligence & Compliance</small></div>
        </div>

        <div className="nav-label">Modules</div>
        <NavLink to="/edd" end className={() => `nav-item ${inEdd ? 'active' : ''}`} id="nav-edd">🛡️ Enhanced Due Diligence</NavLink>
        {inEdd && (
          <div className="nav-sub">
            <NavLink to="/edd" end className="nav-item" id="nav-edd-overview">Overview</NavLink>
            <NavLink to="/edd/cases" className="nav-item" id="nav-edd-cases">My Cases</NavLink>
            <NavLink to="/edd/upload" className="nav-item" id="nav-edd-upload">Bulk Upload</NavLink>
            <NavLink to="/edd/master" className="nav-item" id="nav-edd-master">Master Data</NavLink>
          </div>
        )}
        {MODULES.map((m) => (
          <NavLink key={m.slug} to={`/module/${m.slug}`} className="nav-item" id={`nav-${m.slug}`}>
            {m.icon} {m.name.length > 18 ? 'SAR' : m.name} <span className="soon">Soon</span>
          </NavLink>
        ))}

        {user.role === 'admin' && (<>
          <div className="nav-label">Administration</div>
          <NavLink to="/users" className="nav-item" id="nav-users">👥 User Management</NavLink>
        </>)}

        <div className="sidebar-foot">
          <div className="avatar">{initials(user.name)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
            <div className="muted" style={{ fontSize: 12, textTransform: 'capitalize' }}>{user.role}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={logout} title="Sign out" id="btn-logout">⎋</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
