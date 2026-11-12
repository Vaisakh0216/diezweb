import React from 'react';
import { useMeta } from '../context.jsx';

export default function Glossary() {
  const meta = useMeta();
  return (
    <>
      <div className="page-head"><div><div className="crumb">Reference</div><h1>Compliance Glossary</h1><p>Common abbreviations and terms.</p></div></div>
      <div className="gloss">
        {meta.glossary.map(([k, v]) => <div key={k} className="card"><b>{k}</b><div style={{ marginTop: 6 }}>{v}</div></div>)}
      </div>
      <div className="grid grid-2" style={{ marginTop: 24 }}>
        <div className="card"><h3 style={{ fontSize: 16, marginBottom: 10 }}>DSO / IFZA / DTEC application types</h3>{meta.dsoTerms.map((t) => <span key={t} className="tag">{t}</span>)}</div>
        <div className="card"><h3 style={{ fontSize: 16, marginBottom: 10 }}>DAFZ / DCC application types</h3>{meta.dafzDccTerms.map((t) => <span key={t} className="tag">{t}</span>)}</div>
        <div className="card"><h3 style={{ fontSize: 16, marginBottom: 10 }}>Root causes</h3>{meta.rootCauses.map((t) => <span key={t} className="tag">{t}</span>)}</div>
        <div className="card"><h3 style={{ fontSize: 16, marginBottom: 10 }}>EDD statuses</h3>{meta.eddStatuses.map((t) => <span key={t} className="tag">{t}</span>)}</div>
      </div>
    </>
  );
}
