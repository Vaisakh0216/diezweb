import React from 'react';
import CasesTable from '../components/CasesTable.jsx';

export default function MasterData() {
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Enhanced Due Diligence</div><h1>Master Data</h1>
          <p>Every EDD record and who is working on it. Read-only for everyone.</p></div>
        <span className="badge">🔒 View only</span>
      </div>
      <CasesTable mode="master" />
    </>
  );
}
