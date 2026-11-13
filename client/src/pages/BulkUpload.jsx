import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAuth, useMeta, useToast } from '../context.jsx';

const ACCEPT = '.xlsx,.xls,.csv,.ods';

export default function BulkUpload() {
  const { user } = useAuth();
  const meta = useMeta();
  const toast = useToast();
  const input = useRef();
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState(null);
  // optional: empty = import every row in the file
  const [range, setRange] = useState({ from: '', to: '' });
  const [defaultBu, setDefaultBu] = useState('DSO');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const step = result ? 3 : preview ? 2 : 1;

  const pick = async (f) => {
    if (!f) return;
    setFile(f); setResult(null); setBusy(true);
    const form = new FormData(); form.append('file', f);
    try {
      const p = await api('/edd/preview', { method: 'POST', form });
      setPreview(p);
      setRange({ from: '', to: '' });
    } catch (e) { toast(e.message, 'error'); setFile(null); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true);
    const form = new FormData();
    form.append('file', file); form.append('defaultBu', defaultBu);
    if (range.from) form.append('dateFrom', range.from);
    if (range.to) form.append('dateTo', range.to);
    try { const r = await api('/edd/upload', { method: 'POST', form }); setResult(r); toast(`${r.newCases} new · ${r.resubmitted} resubmitted · ${r.history} history`); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const reset = () => { setFile(null); setPreview(null); setResult(null); if (input.current) input.current.value = ''; };

  const Stat = ({ label, value, accent }) => (
    <div className="card stat" style={accent ? { '--accent': accent } : {}}><div className="label">{label}</div><div className="value">{value}</div></div>
  );

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Enhanced Due Diligence</div><h1>Bulk Upload</h1>
          <p>Upload a Salesforce export from <b>DSO</b>, <b>DAFZ</b> or <b>DCC</b>. The system is detected from the column headings.
            {' '}Each application is assigned to the officer whose duties match its application type and BU.</p></div>
      </div>

      <div className="steps">
        <div className={`step ${step >= 1 ? 'on' : ''}`}><b>1</b>Select export</div>
        <div className={`step ${step >= 2 ? 'on' : ''}`}><b>2</b>Date range (optional)</div>
        <div className={`step ${step >= 3 ? 'on' : ''}`}><b>3</b>Results</div>
      </div>

      {!preview && (
        <div className={`card dropzone ${drag ? 'drag' : ''}`} id="dropzone" onClick={() => input.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}>
          <div className="icon">📄</div>
          <h3>{busy ? 'Reading file…' : 'Drop the export here or click to browse'}</h3>
          <p className="muted">.xlsx, .xls, .csv (max 25MB). Blank rows, columns and title lines in Salesforce exports are handled.</p>
          <input ref={input} id="file-input" type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files[0])} />
        </div>
      )}

      {preview && !result && (
        <div className="grid grid-upload">
          <div className="card grid">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Detected system</div>
              <div className="sys-badge">{preview.system}</div>
              <div className="muted">{file.name} · {preview.total} rows · {fmtDate(preview.minDate)} → {fmtDate(preview.maxDate)}</div>
            </div>
            <div className="field"><label htmlFor="range-from">Created date from <span className="muted">(optional)</span></label>
              <input id="range-from" type="date" className="input" value={range.from} min={preview.minDate || undefined} max={range.to || undefined}
                onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
            <div className="field"><label htmlFor="range-to">Created date to <span className="muted">(optional)</span></label>
              <input id="range-to" type="date" className="input" value={range.to} min={range.from || undefined}
                onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
            <div className="muted" style={{ fontSize: 12, marginTop: -6 }} id="range-note">
              {range.from && range.to && range.from > range.to
                ? <span style={{ color: 'var(--danger)' }}>From date must be before To date.</span>
                : range.from || range.to
                ? <>Only rows created {range.from ? `from ${fmtDate(range.from)}` : ''}{range.from && range.to ? ' ' : ''}{range.to ? `up to ${fmtDate(range.to)}` : ''} are imported.
                  {' '}<a href="#" style={{ color: 'var(--primary-2)' }} onClick={(e) => { e.preventDefault(); setRange({ from: '', to: '' }); }}>Clear dates</a></>
                : <>No dates selected: all {preview.total} rows in the file are imported.</>}
            </div>
            {preview.needsBu && (
              <div className="field"><label>BU for non-IFZA templates</label>
                <select id="default-bu" className="input" value={defaultBu} onChange={(e) => setDefaultBu(e.target.value)}>
                  {meta.dsoGroup.map((b) => <option key={b}>{b}</option>)}
                </select>
                <span className="muted" style={{ fontSize: 12 }}>IFZA_* templates are set to IFZA automatically.</span>
              </div>
            )}
            <div className="row">
              <button className="btn" onClick={reset}>Cancel</button>
              <button id="btn-import" className="btn btn-primary" style={{ flex: 1 }} disabled={busy || (range.from && range.to && range.from > range.to)} onClick={submit}>{busy ? 'Importing…' : 'Filter & Import'}</button>
            </div>
          </div>
          <div className="card grid" style={{ minWidth: 0 }}>
            <div>
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Application types in this file</h3>
              <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>Each Salesforce template is saved under the application type shown.</p>
              <div className="table-wrap" id="preview-types">
                <table>
                  <thead><tr><th>Salesforce template</th><th>Application type</th><th>Rows</th></tr></thead>
                  <tbody>{(preview.types || []).map((t) => (
                    <tr key={t.record_type}>
                      <td><code style={{ fontSize: 12 }}>{t.record_type}</code></td>
                      <td>{t.app_type ? <b>{t.app_type}</b> : <span className="badge leave">Unmapped: not imported</span>}</td>
                      <td>{t.count}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>
              Preview: how rows will be read <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
                · {preview.sample.length < preview.total ? `first ${preview.sample.length} of ${preview.total}` : `all ${preview.total}`} rows</span>
            </h3>
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table>
                <thead><tr><th>Request #</th><th>Company</th><th>Created</th><th>Salesforce template</th><th>Application type</th><th>Owner</th><th>BU</th></tr></thead>
                <tbody>{preview.sample.map((r, i) => (
                  <tr key={i}><td>{r.request_no}</td><td>{r.company}</td><td>{fmtDate(r.created_date)}</td><td><code style={{ fontSize: 12 }}>{r.record_type}</code></td>
                    <td>{r.app_type || <span className="badge leave">Unmapped</span>}</td><td>{r.owner_name || <span className="muted">—</span>}</td>
                    <td>{r.bu}{r.completed && <span className="muted" style={{ fontSize: 11 }}> · completed</span>}</td></tr>
                ))}</tbody>
              </table>
            </div>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>✅ {result.system} import complete</h3>
          <div className="grid stats">
            <Stat label="Rows in file" value={result.total} />
            <Stat label="New applications" value={result.newCases} accent="var(--primary-2)" />
            <Stat label="Resubmitted (back to queue)" value={result.resubmitted} accent="hsl(280 90% 70%)" />
            <Stat label="Completed → history" value={result.history} accent="var(--success)" />
            <Stat label="Outside date range" value={result.outOfRange} accent="var(--warning)" />
            <Stat label="Already open / approved" value={result.alreadyOpen + result.alreadyApproved} />
            {result.dupInFile > 0 && <Stat label="Duplicate rows in file" value={result.dupInFile} />}
            {result.unmapped > 0 && <Stat label="Unmapped template" value={result.unmapped} accent="var(--danger)" />}
            {result.unassigned > 0 && <Stat label="Unassigned" value={result.unassigned} accent="var(--danger)" />}
            {result.noDate > 0 && <Stat label="Invalid date" value={result.noDate} />}
          </div>
          {result.unmapped > 0 && (
            <p className="error-box">Unrecognised templates: {Object.entries(result.unmappedTypes).map(([k, v]) => `${k} (${v})`).join(', ')}</p>
          )}
          <h3 style={{ fontSize: 15, margin: '10px 0 8px' }}>Assigned to officers</h3>
          {Object.entries(result.perUser).map(([k, v]) => <div key={k} className="row" style={{ padding: '6px 0', maxWidth: 400 }}>{k}<b style={{ marginLeft: 'auto' }}>{v}</b></div>)}
          {!Object.keys(result.perUser).length && <span className="muted">—</span>}
          <div className="row" style={{ marginTop: 20 }}>
            <button className="btn" onClick={reset} id="btn-upload-another">Upload another</button>
            {user?.role === 'admin'
              ? <Link className="btn btn-primary" to="/edd/master">Go to Master Data →</Link>
              : <Link className="btn btn-primary" to="/edd/cases">Go to My Work →</Link>}
          </div>
        </div>
      )}
    </>
  );
}
