import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

const ACCEPT = '.xlsx,.xls,.csv,.ods';
const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

export default function BulkUpload() {
  const { user } = useAuth();
  const toast = useToast();
  const input = useRef();
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState(null);
  const [range, setRange] = useState({ from: monthAgo, to: today });
  const [cols, setCols] = useState({ duty: '', date: '' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const step = result ? 3 : preview ? 2 : 1;

  const pick = async (f) => {
    if (!f) return;
    setFile(f); setResult(null); setBusy(true);
    const form = new FormData(); form.append('file', f);
    try {
      const p = await api('/edd/preview', { method: 'POST', form });
      setPreview(p); setCols({ duty: p.dutyColumn, date: p.dateColumn });
    } catch (e) { toast(e.message, 'error'); setFile(null); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    form.append('dateFrom', range.from); form.append('dateTo', range.to);
    form.append('dutyColumn', cols.duty); form.append('dateColumn', cols.date);
    try { const r = await api('/edd/upload', { method: 'POST', form }); setResult(r); toast(`${r.matched} record(s) imported`); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const reset = () => { setFile(null); setPreview(null); setResult(null); if (input.current) input.current.value = ''; };

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Enhanced Due Diligence</div><h1>Bulk Upload</h1>
          <p>{user.role === 'admin'
            ? 'Rows are matched to duties and shared out to the users assigned to each duty.'
            : `Only rows matching your duties (${user.duties.join(', ') || 'none'}) will be imported to you.`}</p></div>
      </div>

      <div className="steps">
        <div className={`step ${step >= 1 ? 'on' : ''}`}><b>1</b>Select file</div>
        <div className={`step ${step >= 2 ? 'on' : ''}`}><b>2</b>Date range & mapping</div>
        <div className={`step ${step >= 3 ? 'on' : ''}`}><b>3</b>Results</div>
      </div>

      {!preview && (
        <div className={`card dropzone ${drag ? 'drag' : ''}`} id="dropzone"
          onClick={() => input.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}>
          <div className="icon">📄</div>
          <h3>{busy ? 'Reading file…' : 'Drop your file here or click to browse'}</h3>
          <p className="muted">Supports .xlsx, .xls, .csv, .ods (max 25MB). The first sheet is used.</p>
          <input ref={input} id="file-input" type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files[0])} />
        </div>
      )}

      {preview && !result && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 360px) 1fr', alignItems: 'start' }}>
          <div className="card grid">
            <div><div className="muted" style={{ fontSize: 12 }}>File</div><b>{file.name}</b> <span className="muted">· {preview.total} rows</span></div>
            <div className="field"><label>Date range: from</label><input id="range-from" type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
            <div className="field"><label>Date range: to</label><input id="range-to" type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
            <div className="field"><label>Date column</label>
              <select id="col-date" className="input" value={cols.date} onChange={(e) => setCols({ ...cols, date: e.target.value })}>
                <option value="">Select…</option>{preview.headers.map((h) => <option key={h}>{h}</option>)}
              </select></div>
            <div className="field"><label>Duty column</label>
              <select id="col-duty" className="input" value={cols.duty} onChange={(e) => setCols({ ...cols, duty: e.target.value })}>
                <option value="">Select…</option>{preview.headers.map((h) => <option key={h}>{h}</option>)}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>Values must match: License Renewal, Test1, Test2, Test3, Others</span></div>
            <div className="row">
              <button className="btn" onClick={reset}>Cancel</button>
              <button id="btn-import" className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !cols.duty || !cols.date || !range.from || !range.to} onClick={submit}>
                {busy ? 'Importing…' : 'Filter & Import'}
              </button>
            </div>
          </div>
          <div className="card" style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Preview (first 5 rows)</h3>
            <div className="table-wrap">
              <table>
                <thead><tr>{preview.headers.map((h) => <th key={h} style={h === cols.duty || h === cols.date ? { color: 'var(--primary-2)' } : {}}>{h}</th>)}</tr></thead>
                <tbody>{preview.sample.map((r, i) => <tr key={i}>{preview.headers.map((h) => <td key={h}>{String(r[h])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>✅ Import complete</h3>
          <div className="grid stats">
            <div className="card stat"><div className="label">Rows in file</div><div className="value">{result.total}</div></div>
            <div className="card stat" style={{ '--accent': 'var(--success)' }}><div className="label">Imported</div><div className="value">{result.matched}</div></div>
            <div className="card stat" style={{ '--accent': 'var(--warning)' }}><div className="label">Outside date range</div><div className="value">{result.outOfRange}</div></div>
            <div className="card stat" style={{ '--accent': 'var(--danger)' }}><div className="label">No duty match / not yours</div><div className="value">{result.noDutyMatch + result.notYourDuty}</div></div>
            {result.noDate > 0 && <div className="card stat"><div className="label">Missing / invalid date</div><div className="value">{result.noDate}</div></div>}
            {result.unassigned > 0 && <div className="card stat" style={{ '--accent': 'var(--danger)' }}><div className="label">Unassigned (no user for duty)</div><div className="value">{result.unassigned}</div></div>}
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div><h3 style={{ fontSize: 15, marginBottom: 8 }}>By duty</h3>
              {Object.entries(result.perDuty).map(([k, v]) => <div key={k} className="row" style={{ padding: '6px 0' }}><span className="tag">{k}</span><b style={{ marginLeft: 'auto' }}>{v}</b></div>)}
              {!Object.keys(result.perDuty).length && <span className="muted">—</span>}</div>
            <div><h3 style={{ fontSize: 15, marginBottom: 8 }}>By user</h3>
              {Object.entries(result.perUser).map(([k, v]) => <div key={k} className="row" style={{ padding: '6px 0' }}>{k}<b style={{ marginLeft: 'auto' }}>{v}</b></div>)}
              {!Object.keys(result.perUser).length && <span className="muted">—</span>}</div>
          </div>
          <div className="row" style={{ marginTop: 20 }}>
            <button className="btn" onClick={reset} id="btn-upload-another">Upload another</button>
            <Link className="btn btn-primary" to="/edd/cases">View cases →</Link>
          </div>
        </div>
      )}
    </>
  );
}
