// Generates larger dummy exports with only OPEN (not completed) applications.
// Usage: node server/make-dummy-open.js
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const out = fileURLToPath(new URL('../sample_data/', import.meta.url));
fs.mkdirSync(out, { recursive: true });

let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NAMES = ['ALPINE', 'BEACON', 'CRESCENT', 'DUNE', 'EMERALD', 'FALCON', 'GULF', 'HARBOR', 'IVORY', 'JASMINE', 'KESTREL', 'LOTUS',
  'MERIDIAN', 'NOBLE', 'OASIS', 'PALM', 'QUARTZ', 'ROYAL', 'SAFFRON', 'TITAN', 'UNITY', 'VELVET', 'WAVE', 'ZENITH', 'AZURE', 'BLUE NILE'];
const KINDS = ['TRADING', 'GENERAL TRADING', 'TECHNOLOGIES', 'CONSULTANCY', 'LOGISTICS', 'FOODSTUFF', 'METALS', 'HOLDINGS', 'MEDICAL', 'ELECTRONICS'];
const company = (sfx) => `${pick(NAMES)} ${pick(KINDS)} - ${sfx}`;
// dates between 2026-10-10 and 2026-11-07
const day = () => new Date(2026, 9, 10 + Math.floor(rnd() * 29));
const mdy = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const dmy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function write(name, title, headers, rows) {
  const aoa = [[], ['', '', title], [], ['', '', ...headers], ...rows.map((r) => ['', '', ...r])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  XLSX.writeFile(wb, out + name);
  console.log(`wrote ${name} (${rows.length} rows)`);
}

/* ---- DSO: Susan = IFZA license renewals, Firas = everything else, some blank owners ---- */
const DSO_TYPES = ['IFZA_COMPANY_APPLICATION', 'IFZA_SHAREHOLDER_AMENDMENT', 'IFZA_SHA_COA_TEMPLATE', 'Company Officer Amendment',
  'Direct License', 'UBO Amendment', 'DSO Shared Premise', 'Company Application'];
const dso = [];
for (let i = 0; i < 30; i++) {
  const lr = i % 3 === 0;
  const type = lr ? 'IFZA_LICENSE_RENEWAL' : pick(DSO_TYPES);
  const owner = i % 7 === 6 ? ['', ''] : lr ? ['Susan', 'Jacob'] : ['Firas', 'Essghaier'];
  dso.push([`SR-Ref-${600000 + i * 37}`, `DSO-LIC-${300100 + i}`, company('FZCO'), 'Pending Review', mdy(day()),
    pick(['buser', 'Mzim', 'Gard']), owner[0], owner[1], type]);
}
write('DSO_open_dummy.xlsx', 'DSO System Template (dumping)',
  ['Service Request', 'Service Request#', 'Company Name', 'Step Status', 'Created Date', 'Created By Alias', 'Owner First NameSorted Descending', 'Owner Last Name', 'Parent Service Template Code'], dso);

/* ---- DAFZ: Aditi / Matthew, all pending ---- */
const DAFZ_TYPES = ['DAFZ Company Officer Amendment', 'DAFZ Shareholder Amendment', 'DAFZ Company Name Change', 'DAFZ Activity Amendment',
  'DAFZ License Renewal', 'DAFZ Company Application', 'REGUS Company Application', 'Scality Company Application', 'UBO Declaration Service'];
const dafz = [];
for (let i = 0; i < 20; i++) {
  const owner = i % 2 ? 'Aditi Mathur' : 'Mathew Kappil James';
  dafz.push(['Enhanced Due Diligence', `DAFZ-${1791000 + i}`, company('FZCO'), `SSN-${2460000 + i}`, 'In Progress', 'Compliance',
    pick(DAFZ_TYPES), mdy(day()), '', owner, pick(['Pending', 'Awaiting Review', 'In Progress']), '']);
}
write('DAFZ_open_dummy.xlsx', 'DAFZ System Template (dumping)',
  ['Request Step Template Name', 'Service Number', 'Account Name', 'Service Step Number', 'Request Status Name', 'Stage Owner', 'Request Template: Name', 'Created Date', 'Closed Date', 'Owner name', 'Service Step Status: Status Name', 'Closed Date Time'], dafz);

/* ---- DCC: Aditi / Matthew, all pending, day-first dates ---- */
const DCC_TYPES = ['License Renewal', 'Company Application', 'DCC Company Name Change', 'Shareholder Amendment', 'Company Officer Amendment', 'Activity Amendment', 'UBO Declaration Service'];
const dcc = [];
for (let i = 0; i < 20; i++) {
  const owner = i % 2 ? 'Mathew Kappil James' : 'Aditi Mathur';
  dcc.push([company('FZCO'), `RS-${200100 + i}`, `DCC-${091000 + i}`, dmy(day()), 'Enhanced Due Diligence', pick(DCC_TYPES), owner,
    pick(['Customer', 'Compliance']), `a1EdP00000${String(i).padStart(4, '0')}`, pick(['Pending', 'In Progress']), owner, '']);
}
write('DCC_open_dummy.xlsx', 'DCC System Template (dumping)',
  ['Account Name', 'Step Number', 'Request Number', 'Created Date', 'Request Step Template: Step Template Number', 'Request Template: Name', 'Owner name', 'Stage Owner', 'Request Step ID', 'Request Step Status: Status Name', 'Owner: Full Name', 'Closed Date Time'], dcc);
