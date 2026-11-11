import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context.jsx";
import { ORG } from "../org.js";
import { ThemeToggle } from "../theme.jsx";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/edd" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      nav("/edd");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <section className="login-hero">
        <div className="orb" />
        <div className="brand">
          <div className="brand-logo">{ORG.initial}</div>
          <div>
            <h2>{ORG.company}</h2>
            <small>{ORG.department}</small>
          </div>
        </div>
        <h1>
          Compliance that
          <br />
          <span>never sleeps.</span>
        </h1>
        {/* <p className="muted" style={{ maxWidth: 460, fontSize: 16 }}>
          A single place for enhanced due diligence, screening, monitoring and suspicious activity reporting.
        </p>
        <div className="module-list">
          <div>🛡️ Enhanced Due Diligence</div><div>🎯 True Match</div>
          <div>📡 Heightened Monitoring</div><div>🚩 Red Flag</div>
          <div style={{ gridColumn: '1/-1' }}>🕵️ Suspicious Activity Report</div>
        </div> */}
      </section>
      <ThemeToggle className="login-theme" />
      <section className="login-panel">
        <form className="card login-card" onSubmit={submit}>
          <h1 style={{ fontSize: 26 }}>Welcome back</h1>
          <p className="muted" style={{ marginTop: 6, marginBottom: 22 }}>
            Sign in to your workspace
          </p>
          <div className="grid">
            {error && <div className="error-box">{error}</div>}
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              id="btn-login"
              className="btn btn-primary"
              disabled={busy}
              style={{ padding: 12 }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <p
              className="muted"
              style={{ fontSize: 12, textAlign: "center", margin: 0 }}
            >
              Admin: admin@edd.local / admin123 · Team: firstname@edd.local /
              Welcome@123
            </p>
          </div>
        </form>
      </section>
    </div>
  );
}
