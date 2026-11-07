import React from 'react';
import CasesTable from '../components/CasesTable.jsx';
import { useAuth } from '../context.jsx';

export default function MyCases() {
  const { user } = useAuth();
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Enhanced Due Diligence</div><h1>My Cases</h1>
          <p>Records assigned to you for: {user.duties.length ? user.duties.join(', ') : 'no duties assigned'}</p></div>
      </div>
      <CasesTable mode="mine" />
    </>
  );
}
