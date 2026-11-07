import React from 'react';
import { useParams } from 'react-router-dom';
import { MODULES } from '../components/Layout.jsx';

export default function ComingSoon() {
  const { slug } = useParams();
  const m = MODULES.find((x) => x.slug === slug) || { name: 'Module', icon: '🧩' };
  return (
    <div className="card" style={{ textAlign: 'center', padding: 70, marginTop: 40 }}>
      <div style={{ fontSize: 56 }}>{m.icon}</div>
      <h1 style={{ marginTop: 14 }}>{m.name}</h1>
      <p className="muted">This module is planned for a later phase.</p>
    </div>
  );
}
