import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { initials } from "../components/Layout.jsx";
import { api, fmtDate } from "../api.js";
import { useAuth } from "../context.jsx";

export default function EddOverview() {
  const { user } = useAuth();
  const [c, setC] = useState(null);
  const [uploads, setUploads] = useState([]);
  const isAdmin = user.role === "admin";
  const [team, setTeam] = useState(null);
  useEffect(() => {
    // admins see the whole team's numbers; officers their own
    api(`/edd/counts${isAdmin ? "?scope=all" : ""}`)
      .then(setC)
      .catch(() => {});
    if (isAdmin)
      api("/edd/team")
        .then(setTeam)
        .catch(() => setTeam([]));
    api("/edd/uploads")
      .then(setUploads)
      .catch(() => {});
  }, []);
  const v = (x) => (c ? x : "–");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Enhanced Due Diligence</div>
          <h1>Welcome, {user.name.split(" ")[0]} 👋</h1>
          <p>
            {user.title} ·{" "}
            {user.bus.map((b) => (
              <span key={b} className="tag">
                {b}
              </span>
            ))}
          </p>
        </div>
        <div className="row">
          <Link
            to="/edd/upload"
            className="btn btn-primary"
            id="btn-goto-upload"
          >
            ⤒ Bulk Upload
          </Link>
          {isAdmin ? (
            <Link to="/edd/master" className="btn">
              Master Data
            </Link>
          ) : (
            <Link to="/edd/cases" className="btn">
              My Work
            </Link>
          )}
        </div>
      </div>
      {isAdmin && <h3 className="section-h">Team totals</h3>}
      <div className="grid stats">
        <div className="card stat">
          <div className="label">Work queue</div>
          <div className="value">{v(c?.work_lr + c?.work_other)}</div>
        </div>
        <div className="card stat" style={{ "--accent": "var(--primary-2)" }}>
          <div className="label">New applications</div>
          <div className="value">{v(c?.new_apps)}</div>
        </div>
        <div className="card stat" style={{ "--accent": "hsl(280 90% 70%)" }}>
          <div className="label">Resubmitted</div>
          <div className="value">{v(c?.resubmitted)}</div>
        </div>
        <div className="card stat" style={{ "--accent": "var(--warning)" }}>
          <div className="label">Awaiting client</div>
          <div className="value">{v(c?.awaiting_lr + c?.awaiting_other)}</div>
        </div>
        <div className="card stat" style={{ "--accent": "var(--success)" }}>
          <div className="label">Approved</div>
          <div className="value">{v(c?.approved_lr + c?.approved_other)}</div>
        </div>
        {user.role === "admin" && (
          <div className="card stat" style={{ "--accent": "var(--danger)" }}>
            <div className="label">Unassigned</div>
            <div className="value">{v(c?.unassigned)}</div>
          </div>
        )}
      </div>
      {isAdmin && <TeamWorkload team={team} />}
      <div className="card">
        <h3 style={{ fontSize: 17, marginBottom: 14 }}>Recent uploads</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>System</th>
                <th>By</th>
                <th>Date range</th>
                <th>New</th>
                <th>Resubmitted</th>
                <th>History</th>
                <th>Skipped</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => {
                const s = u.stats || {};
                return (
                  <tr key={u.id}>
                    <td>{u.filename}</td>
                    <td>
                      <span className="tag">{u.system}</span>
                    </td>
                    <td>{u.uploaded_by_name}</td>
                    <td>
                      {fmtDate(u.date_from)} → {fmtDate(u.date_to)}
                    </td>
                    <td style={{ color: "var(--primary-2)" }}>
                      {s.newCases ?? 0}
                    </td>
                    <td>{s.resubmitted ?? 0}</td>
                    <td>{s.history ?? 0}</td>
                    <td className="muted">
                      {(s.outOfRange || 0) +
                        (s.unmapped || 0) +
                        (s.dupInFile || 0) +
                        (s.alreadyOpen || 0) +
                        (s.alreadyApproved || 0)}
                    </td>
                    <td className="muted">{u.created_at}</td>
                  </tr>
                );
              })}
              {!uploads.length && (
                <tr>
                  <td colSpan={9} className="empty">
                    No uploads yet.{" "}
                    <Link
                      to="/edd/upload"
                      style={{ color: "var(--primary-2)" }}
                    >
                      Upload an export
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const daysSince = (d) =>
  d
    ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5))
    : null;
const ago = (at) => {
  if (!at) return null;
  const d = new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
  const m = Math.floor((Date.now() - d) / 6e4);
  if (m < 60) return m <= 1 ? "just now" : `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};
const Num = ({ n, tone }) =>
  n ? (
    <b className={tone ? `num-${tone}` : ""}>{n}</b>
  ) : (
    <span className="muted">0</span>
  );

/** Admin: workload per officer (EDD applications + screening cases). Click a name to open their cases in Master Data. */
function TeamWorkload({ team }) {
  const [sort, setSort] = useState("load");
  const rows = [...(team || [])].sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : b.open + b.awaiting - (a.open + a.awaiting) ||
        a.name.localeCompare(b.name)
  );
  const max = Math.max(1, ...rows.map((r) => r.open + r.awaiting));
  const officers = rows.filter((r) => r.role === "user");
  const onLeave = officers.filter((r) => r.status !== "active").length;
  const totalOpen = rows.reduce((n, r) => n + r.open + r.awaiting, 0);
  return (
    <div className="card" style={{ marginBottom: 20 }} id="team-workload">
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <h3 style={{ fontSize: 17 }}>Team workload</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {team ? (
              <>
                {officers.length} officers
                {onLeave ? ` · ${onLeave} on leave` : ""} · {totalOpen} EDD
                applications in progress · click a name to see their
                applications
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Sort">
          <button
            className={sort === "load" ? "on" : ""}
            onClick={() => setSort("load")}
          >
            Busiest first
          </button>
          <button
            className={sort === "name" ? "on" : ""}
            onClick={() => setSort("name")}
          >
            A–Z
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th>Officer</th>
              <th>Workload</th>
              <th title="Open applications in the work queue">Work queue</th>
              <th title="Documents requested / returned for reupload">
                Awaiting
              </th>
              <th title="Not approved yet, risk rated High">High risk</th>
              <th title="Oldest open application (days since created)">
                Oldest
              </th>
              <th title="Approved in the app in the last 30 days · all approved">
                Approved
              </th>
              <th title="Screening cases assigned (not False) · on hold as Possible / Escalated">
                Cases
              </th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const load = r.open + r.awaiting;
              const age = daysSince(r.oldest_open);
              return (
                <tr key={r.id}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <div className="avatar">{initials(r.name)}</div>
                      <div style={{ minWidth: 0 }}>
                        <Link
                          className="cell-link"
                          to={`/edd/master?assignee=${r.id}`}
                          id={`team-view-${r.id}`}
                          title={`Open ${r.name}'s applications in Master Data`}
                        >
                          {r.name}
                        </Link>
                        {r.status !== "active" && (
                          <span
                            className="badge leave"
                            style={{ marginLeft: 6 }}
                          >
                            On leave
                          </span>
                        )}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {r.title || r.role}
                        </div>
                        <div className="team-bus">
                          {r.bus.map((b) => (
                            <span key={b} className="tag">
                              {b}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="load-bar" title={`${load} in progress`}>
                      <span style={{ width: `${(load / max) * 100}%` }} />
                    </div>
                    <div className="cell-note">{load} in progress</div>
                  </td>
                  <td>
                    <Num n={r.open} />
                    {r.open > 0 && (
                      <div className="cell-note">
                        {r.new_apps} new · {r.resubmitted} resubmitted
                        {r.open_lr ? ` · ${r.open_lr} LR` : ""}
                      </div>
                    )}
                  </td>
                  <td>
                    <Num n={r.awaiting} tone="warn" />
                  </td>
                  <td>
                    <Num n={r.high_risk} tone="danger" />
                  </td>
                  <td>
                    {age === null ? (
                      <span className="muted">—</span>
                    ) : (
                      <span
                        className={
                          age > 30 ? "num-danger" : age > 14 ? "num-warn" : ""
                        }
                      >
                        {age} days
                      </span>
                    )}
                  </td>
                  <td>
                    <Num n={r.approved_30d} tone="ok" />
                    <div className="cell-note">{r.approved} in total</div>
                  </td>
                  <td>
                    <Num n={r.cases_active} />
                    {r.cases_pending > 0 && (
                      <div className="cell-note warn">
                        {r.cases_pending} on hold
                      </div>
                    )}
                  </td>
                  <td className="muted">{ago(r.last_activity) || "—"}</td>
                </tr>
              );
            })}
            {team && !rows.length && (
              <tr>
                <td colSpan={9} className="empty">
                  No officers yet. Add them under Team &amp; Users.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
