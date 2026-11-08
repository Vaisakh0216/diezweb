import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth } from '../context.jsx';
import WorkTable from '../components/WorkTable.jsx';

export default function MyCases() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [scope, setScope] = useState('mine');
  const [counts, setCounts] = useState(null);
  const hasLR = user.duties.includes('License Renewal');
  const hasOther = user.duties.some((d) => d !== 'License Renewal');
  const [view, setView] = useState(hasOther || !hasLR ? 'other' : 'lr');
  const [tab, setTab] = useState('work');

  const loadCounts = () => api('/edd/counts' + qs({ scope })).then(setCounts).catch(() => {});
  useEffect(() => { loadCounts(); }, [scope]);

  // show a view if user has the duty, or has cases in it
  const showLR = isAdmin || hasLR || (counts && counts.work_lr + counts.awaiting_lr + counts.approved_lr > 0);
  const showOther = isAdmin || hasOther || (counts && counts.work_other + counts.awaiting_other + counts.approved_other > 0);
  const c = (k) => (counts ? counts[`${k}_${view}`] : '…');

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

      {showLR && showOther && (
        <div className="seg" style={{ marginBottom: 16 }}>
          <button id="view-lr" className={view === 'lr' ? 'on' : ''} onClick={() => setView('lr')}>
            🔁 License Renewal <span className="count">{counts?.work_lr ?? 0}</span></button>
          <button id="view-other" className={view === 'other' ? 'on' : ''} onClick={() => setView('other')}>
            📑 Other Application Types <span className="count">{counts?.work_other ?? 0}</span></button>
        </div>
      )}

      <div className="tabs">
        <button id="tab-work" className={`tab ${tab === 'work' ? 'on' : ''}`} onClick={() => setTab('work')}>Work Queue <span className="count">{c('work')}</span></button>
        <button id="tab-awaiting" className={`tab ${tab === 'awaiting' ? 'on' : ''}`} onClick={() => setTab('awaiting')}>Awaiting Client <span className="count">{c('awaiting')}</span></button>
        <button id="tab-approved" className={`tab ${tab === 'approved' ? 'on' : ''}`} onClick={() => setTab('approved')}>Approved <span className="count">{c('approved')}</span></button>
      </div>

      <WorkTable key={`${view}-${tab}-${scope}`} view={showLR && !showOther ? 'lr' : !showLR ? 'other' : view} tab={tab} scope={scope} onChanged={loadCounts} />
    </>
  );
}
