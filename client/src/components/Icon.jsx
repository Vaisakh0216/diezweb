import React from 'react';

/** Minimal stroke icon set (24x24 grid), sized by font-size via 1em. */
const P = {
  shield: <path d="M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3z" />,
  folder: <path d="M3 7.5A2.5 2.5 0 015.5 5H9l2 2h7.5A2.5 2.5 0 0121 9.5v7a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 16.5v-9z" />,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19v-.5A4.5 4.5 0 017.5 14h3a4.5 4.5 0 014.5 4.5v.5" /><path d="M16 4.6a3.2 3.2 0 010 6.3M21 19v-.5a4.5 4.5 0 00-3.2-4.3" /></>,
  book: <><path d="M5 4.5A1.5 1.5 0 016.5 3H19v15H6.5A1.5 1.5 0 005 19.5v-15z" /><path d="M5 19.5A1.5 1.5 0 006.5 21H19" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 16v-5M12 16V7M17 16v-8" /></>,
  logout: <><path d="M15 4h2.5A1.5 1.5 0 0119 5.5v13a1.5 1.5 0 01-1.5 1.5H15" /><path d="M10 16l4-4-4-4M14 12H4" /></>,
};

export default function Icon({ name, className = '', title }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {P[name]}
    </svg>
  );
}
