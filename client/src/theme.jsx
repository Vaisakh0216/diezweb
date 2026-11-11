import React, { useEffect, useState } from 'react';
import Icon from './components/Icon.jsx';

// Theme preference: 'system' (default, follows the OS) | 'light' | 'dark'. Kept per browser.
const KEY = 'diez.theme';
const MODES = ['system', 'light', 'dark'];
const LABEL = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
const ICON = { system: 'monitor', light: 'sun', dark: 'moon' };
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export const getPref = () => { try { return MODES.includes(localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : 'system'; } catch { return 'system'; } };
export function applyTheme(pref = getPref()) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
// follow OS changes while on "system"
media().addEventListener?.('change', () => getPref() === 'system' && applyTheme());

/** Cycles System → Light → Dark. */
export function ThemeToggle({ className = '' }) {
  const [pref, setPref] = useState(getPref);
  useEffect(() => {
    try { pref === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, pref); } catch { /* storage unavailable */ }
    applyTheme(pref);
  }, [pref]);
  const next = MODES[(MODES.indexOf(pref) + 1) % MODES.length];
  return (
    <button type="button" id="btn-theme" className={`btn btn-sm btn-ghost icon-btn ${className}`} onClick={() => setPref(next)}
      title={`${LABEL[pref]} · switch to ${LABEL[next].toLowerCase()}`} aria-label={`${LABEL[pref]}. Switch to ${LABEL[next].toLowerCase()}`}>
      <Icon name={ICON[pref]} />
    </button>
  );
}
