import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context.jsx';

export const MODULES = [
  { slug: 'true-match', name: 'True Match', icon: '🎯' },
  { slug: 'heightened-monitoring', name: 'Heightened Monitoring', short: 'HM', icon: '📡' },
  { slug: 'red-flag', name: 'Red Flag', short: 'RF', icon: '🚩' },
  { slug: 'sar', name: 'Suspicious Activity Report', short: 'SAR', icon: '🕵️' },
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
            <NavLink to="/edd/cases" className="nav-item" id="nav-edd-cases">My Work</NavLink>
            <NavLink to="/edd/upload" className="nav-item" id="nav-edd-upload">Bulk Upload</NavLink>
            <NavLink to="/edd/master" className="nav-item" id="nav-edd-master">Master Data</NavLink>
          </div>
        )}
        {MODULES.map((m) => (
          <NavLink key={m.slug} to={`/module/${m.slug}`} className="nav-item" id={`nav-${m.slug}`}>
            {m.icon} {m.name.length > 22 ? m.short : m.name} <span className="soon">Soon</span>
          </NavLink>
        ))}

        {user.role === 'admin' && (<>
          <div className="nav-label">Administration</div>
          <NavLink to="/users" className="nav-item" id="nav-users">👥 Team & Users</NavLink>
        </>)}
        <div className="nav-label">Reference</div>
        <NavLink to="/glossary" className="nav-item" id="nav-glossary">📖 Glossary</NavLink>

        <div className="sidebar-foot">
          <div className="avatar">{initials(user.name)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{user.title || user.role}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={logout} title="Sign out" id="btn-logout">⎋</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
