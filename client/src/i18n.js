// Interface language: English (default) or Arabic (right-to-left).
// The interface is written in English; in Arabic mode every visible English phrase (text, placeholder,
// title, aria-label) is swapped for its translation from i18n-ar.js as React renders it, and swapped back
// when switching to English. User data (remarks, notes, typed text, form values) is never translated.
import AR from './i18n-ar.js';

const KEY = 'diez.lang';
const ATTRS = ['placeholder', 'title', 'aria-label'];
// content that is never translated: user-entered text, templates, code
const SKIP = 'textarea, script, style, pre, .remark-body, [data-no-i18n]';

export const getLang = () => { try { return localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en'; } catch { return 'en'; } };
let lang = getLang();
export const missing = new Set(); // English phrases without a translation (for maintenance)

/* ---------- translating one string ---------- */
function translateCore(core) {
  if (AR.exact[core] != null) return AR.exact[core];
  // trailing punctuation: "Reason:" / "Loading…" / "Delete?"
  const p = core.match(/^(.*?)\s*([:.…?!*]+)$/);
  if (p && AR.exact[p[1]] != null) return AR.exact[p[1]] + p[2].replace('?', '؟');
  for (const [re, fn] of AR.patterns) {
    const m = core.match(re);
    if (m) { const out = fn(m, (s) => translateCore(s) ?? s); if (out != null) return out; }
  }
  // lists and "a · b" lines: translate the known parts
  for (const [sep, join] of [[' · ', ' · '], [', ', '، ']]) {
    if (!core.includes(sep)) continue;
    const parts = core.split(sep).map((x) => [x, translateCore(x.trim())]);
    if (parts.some(([, t]) => t != null)) return parts.map(([x, t]) => t ?? x).join(join);
  }
  if (/[A-Za-z]{2,}/.test(core)) missing.add(core);
  return null;
}
export function translate(s) {
  if (lang !== 'ar' || !s) return s;
  const m = String(s).match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m[2] || !/[A-Za-z]/.test(m[2])) return s;
  const out = translateCore(m[2]);
  return out == null ? s : m[1] + out + m[3];
}

/* ---------- applying it to the page ---------- */
const textOrig = new WeakMap(); // text node -> English
const textShown = new WeakMap(); // text node -> what we wrote
const attrState = new WeakMap(); // element -> { attr: { orig, shown } }
const pinned = new WeakSet(); // <option>s whose value we set from their English text
const skipped = (el) => !el || (el.closest && el.closest(SKIP));
// attributes (placeholder, title) are translated on text boxes too; only typed/user content is skipped
const SKIP_ATTR = 'script, style, .remark-body, [data-no-i18n]';
const skippedAttr = (el) => !el || (el.closest && el.closest(SKIP_ATTR));

function doText(n) {
  const parent = n.parentElement;
  if (skipped(parent)) return;
  const cur = n.nodeValue;
  if (textShown.get(n) === cur) return; // our own write
  // <option>Text</option> takes its value from its text: pin the English value before translating the label,
  // so forms keep sending the English value
  if (parent && parent.tagName === 'OPTION' && (!parent.hasAttribute('value') || pinned.has(parent))) {
    pinned.add(parent);
    parent.setAttribute('value', cur);
  }
  textOrig.set(n, cur);
  const next = translate(cur);
  if (next !== cur) { textShown.set(n, next); n.nodeValue = next; } else textShown.delete(n);
}
function doAttr(el, a) {
  if (!el.hasAttribute(a) || skippedAttr(el)) return;
  const st = attrState.get(el) || {}; const cur = el.getAttribute(a);
  if (st[a]?.shown === cur) return;
  const next = translate(cur);
  st[a] = { orig: cur, shown: next }; attrState.set(el, st);
  if (next !== cur) el.setAttribute(a, next);
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType === 1 && root.tagName === 'TEXTAREA') { ATTRS.forEach((a) => doAttr(root, a)); return; }
  if (root.nodeType !== 1 || skipped(root)) return;
  for (const a of ATTRS) doAttr(root, a);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  // text boxes are skipped for content, but their placeholder / title are translated
  if (root.querySelectorAll) root.querySelectorAll('textarea').forEach((el) => ATTRS.forEach((a) => doAttr(el, a)));
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) doText(n); else for (const a of ATTRS) doAttr(n, a);
  }
}
/** restore English everywhere (before re-applying the current language) */
function restore(root) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) {
      if (textShown.get(n) === n.nodeValue && textOrig.has(n)) { n.nodeValue = textOrig.get(n); }
      textShown.delete(n);
    } else {
      const st = attrState.get(n);
      if (st) for (const a of Object.keys(st)) { if (n.getAttribute(a) === st[a].shown) n.setAttribute(a, st[a].orig); }
      attrState.delete(n);
    }
  }
}

let titleEn = '';
function applyDocument() {
  const html = document.documentElement;
  html.lang = lang; html.dir = lang === 'ar' ? 'rtl' : 'ltr';
  if (!titleEn) titleEn = document.title;
  document.title = lang === 'ar' ? translate(titleEn) : titleEn;
}

let started = false;
export function startI18n() {
  applyDocument();
  if (started) return;
  started = true;
  walk(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttr(m.target, m.attributeName);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

export function setLang(l) {
  lang = l === 'ar' ? 'ar' : 'en';
  try { lang === 'ar' ? localStorage.setItem(KEY, 'ar') : localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  restore(document.body);
  applyDocument();
  walk(document.body);
  window.dispatchEvent(new Event('lang:changed'));
}
// for maintenance from the browser console: copy(window.__i18nMissing())
window.__i18nMissing = () => [...missing].sort();
