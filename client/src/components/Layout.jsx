import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context.jsx";
import { api } from "../api.js";
import Icon from "./Icon.jsx";
import { ORG } from "../org.js";
import { ThemeToggle } from "../theme.jsx";
import LangToggle from "./LangToggle.jsx";

/** Case categories, shown as sub-menus of Cases (slugs match server/terms.js MODULES) */
export const CASE_MODULES = [
  {
    slug: "heightened-monitoring",
    name: "Heightened Monitoring",
    short: "HM",
    icon: "📡",
  },
  { slug: "red-flag", name: "Red Flag", short: "RF", icon: "🚩" },
  { slug: "sar", name: "Suspicious Activity Report", short: "SAR", icon: "🕵️" },
];

/** Report sub-menus (pages in pages/Reports.jsx) */
export const REPORTS = [
  { slug: "wwg", name: "WWG" },
  { slug: "daily-edd", name: "Daily EDD" },
];

export const initials = (n = "") =>
  n
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/* remembered open/closed state of the menu groups (per browser; optional) */
const GROUPS_KEY = "sentinel.nav.groups";
const readGroups = () => {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY)) || {};
  } catch {
    return {};
  }
};
const saveGroups = (g) => {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(g));
  } catch {
    /* storage unavailable */
  }
};

/** Collapsible menu group: label navigates, chevron toggles. The active group is always open. */
function NavGroup({
  id,
  to,
  icon,
  label,
  active,
  badge,
  open,
  onToggle,
  children,
}) {
  const expanded = active || open;
  return (
    <div className={`nav-group ${expanded ? "open" : ""}`}>
      <div className={`nav-item nav-parent ${active ? "active" : ""}`}>
        <NavLink to={to} end className="nav-link" id={id}>
          <Icon name={icon} className="nav-icon" />
          <span className="nav-text">{label}</span>
          {!expanded && badge}
        </NavLink>
        {!active && (
          <button
            type="button"
            className="nav-toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
          >
            <Icon name="chevron" />
          </button>
        )}
      </div>
      {expanded && <div className="nav-sub">{children}</div>}
    </div>
  );
}

const Sub = ({ to, id, children, end }) => (
  <NavLink to={to} end={end} className="nav-item" id={id}>
    {children}
  </NavLink>
);

export default function Layout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  // phones / tablets: the menu is a slide-out drawer opened from the top bar
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const k = (e) => e.key === "Escape" && setNavOpen(false);
    document.addEventListener("keydown", k);
    document.body.classList.add("nav-locked");
    return () => {
      document.removeEventListener("keydown", k);
      document.body.classList.remove("nav-locked");
    };
  }, [navOpen]);
  const inEdd = pathname.startsWith("/edd");
  const inCases = pathname.startsWith("/cases");
  const inReports = pathname.startsWith("/reports");
  const isAdmin = user.role === "admin";
  const [groups, setGroups] = useState(readGroups);
  const toggle = (g) =>
    setGroups((s) => {
      const n = { ...s, [g]: !s[g] };
      saveGroups(n);
      return n;
    });

  const [cc, setCc] = useState({});
  useEffect(() => {
    const load = () =>
      api("/cases/counts")
        .then(setCc)
        .catch(() => {});
    load();
    window.addEventListener("cases:changed", load);
    return () => window.removeEventListener("cases:changed", load);
  }, [pathname]);
  // officers: their active cases · admins: unassigned (All Cases) and active cases per category
  const n = (k) =>
    (isAdmin
      ? k === "all"
        ? cc.all?.unassigned
        : cc[k]?.active
      : cc[k]?.mine) || 0;
  const title = (k) =>
    isAdmin
      ? k === "all"
        ? "Unassigned cases"
        : "Active cases"
      : "Active cases assigned to you";
  // escalation managers: cases waiting for their recommendation (orange badge next to All Cases)
  const escBadge = (user.escalation_manager && cc.all?.awaiting_my_rec) || 0;
  const Count = ({ k }) =>
    n(k) > 0 ? (
      <span className="nav-count" title={title(k)}>
        {n(k)}
      </span>
    ) : null;

  return (
    <div className={`shell ${navOpen ? "nav-open" : ""}`}>
      <header className="topbar">
        <button
          type="button"
          className="btn btn-ghost icon-btn topbar-menu"
          id="btn-menu"
          onClick={() => setNavOpen(true)}
          aria-label="Open menu"
          aria-expanded={navOpen}
          aria-controls="sidebar"
        >
          <Icon name="menu" />
        </button>
        <div className="brand topbar-brand">
          <div className="brand-logo">{ORG.initial}</div>
          <div>
            <h2>{ORG.company}</h2>
            <small>{ORG.department}</small>
          </div>
        </div>
      </header>
      <div
        className="nav-backdrop"
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <aside className="sidebar" id="sidebar">
        <button
          type="button"
          className="btn btn-ghost icon-btn sidebar-close"
          id="btn-menu-close"
          onClick={() => setNavOpen(false)}
          aria-label="Close menu"
        >
          <Icon name="close" />
        </button>
        <div className="brand">
          <div className="brand-logo">{ORG.initial}</div>
          <div>
            <h2>{ORG.company}</h2>
            <small>{ORG.department}</small>
          </div>
        </div>

        <nav className="nav-scroll" aria-label="Main">
          <NavLink to="/dashboard" className="nav-item" id="nav-dashboard">
            <Icon name="grid" className="nav-icon" />
            <span className="nav-text">Dashboard</span>
            <span className="nav-soon">Soon</span>
          </NavLink>
          <div className="nav-label">Modules</div>
          <NavGroup
            id="nav-edd"
            to="/edd"
            icon="shield"
            label="Enhanced Due Diligence"
            active={inEdd}
            open={groups.edd}
            onToggle={() => toggle("edd")}
          >
            <Sub to="/edd" end id="nav-edd-overview">
              Overview
            </Sub>
            {!isAdmin && (
              <Sub to="/edd/cases" id="nav-edd-cases">
                My Work
              </Sub>
            )}
            <Sub to="/edd/upload" id="nav-edd-upload">
              Bulk Upload
            </Sub>
            <Sub to="/edd/master" id="nav-edd-master">
              Master Data
            </Sub>
          </NavGroup>
          <NavGroup
            id="nav-cases"
            to="/cases"
            icon="folder"
            label="Cases"
            active={inCases}
            open={groups.cases}
            onToggle={() => toggle("cases")}
            badge={<Count k="all" />}
          >
            <Sub to="/cases" end id="nav-cases-all">
              <span className="nav-text">Master Data</span>
              {!isAdmin && <span className="nav-soon">View</span>}
              {escBadge > 0 && (
                <span
                  className="nav-count warn"
                  title="Escalated to you, waiting for your recommendation"
                >
                  ↑{escBadge}
                </span>
              )}
              {isAdmin && <Count k="all" />}
            </Sub>
            {!isAdmin && (
              <Sub to="/cases/mine" id="nav-cases-mine">
                <span className="nav-text">My Cases</span>
                {cc.all?.mine_working > 0 && (
                  <span className="nav-count" title="Active cases for you to work on">
                    {cc.all.mine_working}
                  </span>
                )}
              </Sub>
            )}
            {CASE_MODULES.map((m) => (
              <Sub key={m.slug} to={`/cases/${m.slug}`} id={`nav-${m.slug}`}>
                <span className="nav-text" title={m.name}>
                  {m.name.length > 22 ? m.short : m.name}
                </span>
                <Count k={m.slug} />
              </Sub>
            ))}
          </NavGroup>
          <NavGroup
            id="nav-reports"
            to="/reports"
            icon="chart"
            label="Reports"
            active={inReports}
            open={groups.reports}
            onToggle={() => toggle("reports")}
          >
            {REPORTS.map((r) => (
              <Sub key={r.slug} to={`/reports/${r.slug}`} id={`nav-report-${r.slug}`}>
                {r.name}
              </Sub>
            ))}
          </NavGroup>

          {isAdmin && (
            <>
              <div className="nav-label">Administration</div>
              <NavLink to="/users" className="nav-item" id="nav-users">
                <Icon name="users" className="nav-icon" />
                <span className="nav-text">Team & Users</span>
              </NavLink>
            </>
          )}
          <div className="nav-label">Reference</div>
          <NavLink to="/glossary" className="nav-item" id="nav-glossary">
            <Icon name="book" className="nav-icon" />
            <span className="nav-text">Glossary</span>
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <div className="avatar">{initials(user.name)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="foot-name">{user.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {user.title || user.role}
            </div>
          </div>
          <LangToggle />
          <ThemeToggle />
          <button
            className="btn btn-sm btn-ghost icon-btn"
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            id="btn-logout"
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
