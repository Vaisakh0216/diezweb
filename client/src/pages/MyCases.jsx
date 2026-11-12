import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth } from '../context.jsx';
import WorkTable from '../components/WorkTable.jsx';

export default function MyCases() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [scope, setScope] = useState('mine');
  const [counts, setCounts] = useState(null);
  const [tab, setTab] = useState('work');

  const loadCounts = () => api('/edd/counts' + qs({ scope })).then(setCounts).catch(() => {});
  useEffect(() => { loadCounts(); }, [scope]);

  // every application type in one list: tab counts add License Renewal and the other types
  const c = (k) => (counts ? counts[`${k}_lr`] + counts[`${k}_other`] : '…');

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Enhanced Due Diligence</div>
          <h1>My Work</h1>
          <p>{user.title || 'Officer'} · {user.bus.join(', ') || 'no BU'}</p>
        </div>
        {isAdmin && (
          <div className="seg">
            {[['mine', 'My cases'], ['all', 'All officers'], ['unassigned', 'Unassigned']].map(([k, l]) => (
              <button key={k} id={`scope-${k}`} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>
            ))}
          </div>
        )}
      </div>

      <div className="tabs">
        <button id="tab-work" className={`tab ${tab === 'work' ? 'on' : ''}`} onClick={() => setTab('work')}>Work Queue <span className="count">{c('work')}</span></button>
        <button id="tab-awaiting" className={`tab ${tab === 'awaiting' ? 'on' : ''}`} onClick={() => setTab('awaiting')}>Awaiting Client <span className="count">{c('awaiting')}</span></button>
        <button id="tab-approved" className={`tab ${tab === 'approved' ? 'on' : ''}`} onClick={() => setTab('approved')}>Approved <span className="count">{c('approved')}</span></button>
      </div>

      <WorkTable key={`${tab}-${scope}`} tab={tab} scope={scope} onChanged={loadCounts} />
    </>
  );
}
