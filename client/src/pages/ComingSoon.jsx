import React from "react";

/** Placeholder for a module that is planned but not built yet. */
export default function ComingSoon({ crumb, title, children }) {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">{crumb}</div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="card soon">
        <div className="soon-badge">Coming soon</div>
        <h3>{title} is on its way</h3>
        <p className="muted">{children}</p>
      </div>
    </>
  );
}
