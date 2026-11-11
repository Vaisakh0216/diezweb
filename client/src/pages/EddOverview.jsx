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

const Num = ({ n, tone }) =>
  n ? (
    <b className={tone ? `num-${tone}` : ""}>{n}</b>
  ) : (
    <span className="muted">0</span>
  );

/** Admin: EDD workload per officer. Click a name to open their applications in Master Data. */
function TeamWorkload({ team }) {
  const [sort, setSort] = useState("load");
  const load = (r) => r.open + r.returned + r.requested;
  const rows = [...(team || [])].sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : load(b) - load(a) || a.name.localeCompare(b.name)
  );
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
        <h3 style={{ fontSize: 17 }}>Team workload</h3>
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
              <th title="Open applications in the work queue">Work queue</th>
              <th title="Returned for reupload">Returned</th>
              <th title="Documents requested, awaiting the client">Awaiting</th>
              <th title="Approved applications">Approved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
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
                        <span className="badge leave" style={{ marginLeft: 6 }}>
                          On leave
                        </span>
                      )}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {r.title || r.role}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <Num n={r.open} />
                </td>
                <td>
                  <Num n={r.returned} tone="danger" />
                </td>
                <td>
                  <Num n={r.requested} tone="warn" />
                </td>
                <td>
                  <Num n={r.approved} tone="ok" />
                </td>
              </tr>
            ))}
            {team && !rows.length && (
              <tr>
                <td colSpan={5} className="empty">
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
