// Central compliance vocabulary. Exposed to the client via GET /api/meta.

export const BUS = ['DSO', 'IFZA', 'DTEC', 'DAFZ', 'DCC'];
export const DSO_GROUP = ['DSO', 'IFZA', 'DTEC'];
export const EDD_STATUSES = ['Requested', 'Approved', 'Returned for reupload'];
export const AWAITING = ['Requested', 'Returned for reupload'];
export const RISK_RATINGS = ['High', 'Medium High'];
export const ROOT_CAUSES = ['Entity', 'Industry', 'Initiation', 'Jurisdiction', 'Nominee Shareholder', 'PEP', 'Suspicious Activities', 'DNFBP', 'Adverse News'];
export const TITLES = ['Assistant Director', 'Assistant Manager', 'Senior AML Officer', 'AML Officer'];

/* ---------- Screening cases ----------
 * Admin creates a case (uncategorised) -> officer reviews -> case is categorised
 * into one of the MODULES (True Match / HM / RF / SAR). */
export const MODULES = [
  { slug: 'true-match', name: 'True Match' },
  { slug: 'heightened-monitoring', name: 'Heightened Monitoring', short: 'HM' },
  { slug: 'red-flag', name: 'Red Flag', short: 'RF' },
  { slug: 'sar', name: 'Suspicious Activity Report', short: 'SAR' },
];
export const MODULE_SLUGS = MODULES.map((m) => m.slug);
export const HM_SLUG = 'heightened-monitoring';
// Inspection team mailbox used by "Notify inspection team" (blank = choose recipient in the mail app).
export const INSPECTION_TEAM_EMAIL = process.env.INSPECTION_TEAM_EMAIL || '';
export const ESCALATE = 'Escalate to Manager';
export const POSSIBLE = 'Possible';
export const CASE_STATUSES = ['Under Review', 'False', POSSIBLE, ESCALATE, 'Requested Further Documents', 'True Match'];
export const ALERT_RESULTS = ['True Match', 'False Match', POSSIBLE, ESCALATE];
// Alert Result is not chosen: it follows the Status. Statuses not listed (Under Review,
// Requested Further Documents) have no result yet, so the Alert Result stays locked.
export const RESULT_FOR_STATUS = { 'True Match': 'True Match', False: 'False Match', [POSSIBLE]: POSSIBLE, [ESCALATE]: ESCALATE };
// "Possible" and "Escalate to Manager" wait for a decision (the application is on hold).
// Possible may be escalated to a manager; an escalation comes back only as True Match or False.
export const PENDING_STATUSES = [POSSIBLE, ESCALATE];
export const DECISION_STATUSES = ['True Match', 'False'];
// Escalation to manager: officer's recommendation when escalating, manager's (mandatory) when deciding.
export const OTHERS = 'Others';
export const INVESTIGATOR_RECS = ['Heightened Monitoring', 'SAR', 'PCC', 'Court Clearance Certificate', OTHERS];
export const AGREED = 'Agreed to officer recommendation';
export const MANAGER_RECS = [AGREED, 'Heightened Monitoring', 'PCC', 'Court Clearance Certificate', 'SAR', OTHERS];
export const NEXT_STATUSES ={ [POSSIBLE]: [...DECISION_STATUSES, ESCALATE], [ESCALATE]: DECISION_STATUSES };
export const ALERT_CATEGORIES = ['PEP', 'Sanctions', 'Law Enforcement', 'Regulatory Enforcement', 'Adverse Media', 'State Owned Enterprise', 'Other'];

export const GLOSSARY = [
  ['HM', 'Heightened Monitoring'],
  ['RF', 'Red Flag'],
  ['1 LOD', 'First Line of Defence'],
  ['SAR', 'Suspicious Activity Report'],
  ['BU', 'Business Units'],
  ['EDD', 'Enhanced Due Diligence'],
];

// Salesforce record -> "Term we require"
const DSO_MAP = {
  IFZA_COMPANY_APPLICATION: 'New License',
  IFZA_SHAREHOLDER_AMENDMENT: 'Shareholder Amendment',
  IFZA_SHA_COA_TEMPLATE: 'Officer and Shareholder Amendment',
  IFZA_LICENSE_RENEWAL: 'License Renewal',
};
export const DSO_TERMS = ['New License', 'Shareholder Amendment', 'Officer and Shareholder Amendment', 'Company Officer Amendment',
  'Direct License', 'UBO Amendment', 'License Renewal', 'DSO Shared Premise', 'Company Application'];

const DAFZ_DCC_MAP = {
  'DAFZ Company Officer Amendment': 'Officer Amendment',
  'DAFZ Shareholder Amendment': 'Shareholder Amendment',
  'DAFZ Company Name Change': 'Company Name Change',
  'DAFZ Activity Amendment': 'Activity Amendment',
  'DAFZ License Renewal': 'License Renewal',
  'DAFZ Company Application': 'Company Application',
  'REGUS Company Application': 'Company Application',
  'Scality Company Application': 'Company Application',
  'Company Application': 'Company Application',
  'DCC Company Name Change': 'Company Name Change',
  'Shareholder Amendment': 'Shareholder Amendment',
  'Company Officer Amendment': 'Officer Amendment',
  'Activity Amendment': 'Activity Amendment',
  'UBO Declaration Service': 'UBO Declaration Service',
  'License Renewal': 'License Renewal', // seen in DCC exports
};
export const DAFZ_DCC_TERMS = [...new Set(Object.values(DAFZ_DCC_MAP))];
export const APP_TYPES = [...new Set([...DSO_TERMS, ...DAFZ_DCC_TERMS])];

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const build = (map, terms) => {
  const m = {};
  for (const [k, v] of Object.entries(map)) m[norm(k)] = v;
  for (const t of terms) m[norm(t)] ??= t;
  return m;
};
const DSO_LOOKUP = build(DSO_MAP, DSO_TERMS);
const DAFZ_DCC_LOOKUP = build(DAFZ_DCC_MAP, DAFZ_DCC_TERMS);

export function mapAppType(system, raw) {
  const k = norm(raw);
  if (!k) return null;
  return (system === 'DSO' ? DSO_LOOKUP : DAFZ_DCC_LOOKUP)[k] || null;
}

/* ---------- Source system templates ---------- */
// cols: logical field -> list of acceptable header names (normalised compare)
export const TEMPLATES = {
  DSO: {
    detect: ['Service Request#', 'Parent Service Template Code'],
    dateOrder: 'MDY',
    cols: {
      request_no: ['Service Request#'],
      company: ['Company Name'],
      created: ['Created Date'],
      record_type: ['Parent Service Template Code'],
      owner_first: ['Owner First Name'],
      owner_last: ['Owner Last Name'],
      step_status: ['Step Status'],
    },
  },
  DAFZ: {
    detect: ['Service Number', 'Request Template: Name'],
    dateOrder: 'MDY',
    cols: {
      request_no: ['Service Number'],
      company: ['Account Name'],
      created: ['Created Date'],
      record_type: ['Request Template: Name'],
      owner: ['Owner name', 'Owner: Full Name'],
      step_status: ['Service Step Status: Status Name', 'Request Status Name'],
      closed: ['Closed Date Time', 'Closed Date'],
    },
  },
  DCC: {
    detect: ['Request Number', 'Request Template: Name'],
    dateOrder: 'DMY',
    cols: {
      request_no: ['Request Number'],
      company: ['Account Name'],
      created: ['Created Date'],
      record_type: ['Request Template: Name'],
      owner: ['Owner: Full Name', 'Owner name'],
      step_status: ['Request Step Status: Status Name'],
      closed: ['Closed Date Time'],
    },
  },
};

// Initial team
export const TEAM = [
  { name: 'Yaser', email: 'yaser@edd.local', title: 'Assistant Director', role: 'admin', duties: APP_TYPES, bus: BUS, aliases: '' },
  { name: 'Raneem', email: 'raneem@edd.local', title: 'Assistant Manager', role: 'admin', duties: APP_TYPES, bus: BUS, aliases: '' },
  { name: 'Aditi Mathur', email: 'aditi@edd.local', title: 'Senior AML Officer', role: 'user', duties: APP_TYPES, bus: ['DAFZ', 'DCC'], aliases: 'Aditi Mathur' },
  { name: 'Firas Essghaier', email: 'firas@edd.local', title: 'AML Officer', role: 'user', duties: APP_TYPES.filter((t) => t !== 'License Renewal'), bus: BUS, aliases: 'Firas Essghaier' },
  { name: 'Susan Jacob', email: 'susan@edd.local', title: 'AML Officer', role: 'user', duties: ['License Renewal'], bus: ['IFZA'], aliases: 'Susan Jacob' },
  { name: 'Matthew', email: 'matthew@edd.local', title: 'AML Officer', role: 'user', duties: APP_TYPES, bus: ['DAFZ', 'DCC'], aliases: 'Mathew Kappil James' },
];
