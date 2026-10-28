/**
 * The icons of «Усе на бірці» (direction §4, «Іконки»; spec §5.9), the
 * concept's own set (`.ai/project-memory/redesign/concept-all-on-the-tag/icons.js`):
 * a 24 grid, a 1.75 stroke with round ends, `currentColor`, the eyelet alone
 * filled. Each is the inside of its SVG, which `Icon` draws; nothing here
 * is ever built from what a person typed or the server said (P0-1).
 */
export const icons = {
  "tab-today":
    '<path d="M3 4h18M7 4v4M17 4v4"/><path d="M5.5 8h3l2 2v10h-7V10z"/><path d="M15.5 8h3l2 2v6h-7v-6z"/>',
  "tab-sell": '<path d="M10 3h4l4 4v14H6V7z"/><circle cx="12" cy="8.5" r="2"/>',
  "tab-orders":
    '<rect x="4" y="9" width="16" height="11.5" rx="1.5"/><path d="M12 9v11.5M4 14.5h16"/><path d="M12 9C10.5 6 7 4.5 7 6.75 7 8.25 9.5 9 12 9s5-.75 5-2.25C17 4.5 13.5 6 12 9z"/>',
  "tab-money":
    '<path d="M15 9A6 6 0 1 0 9 15"/><circle cx="15" cy="15" r="6"/><circle cx="15" cy="15" r="2.5"/>',
  "tab-drawer":
    '<path d="M4.5 13.5V5.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5v8"/><path d="M9.5 8.5h5"/><path d="M2.5 13.5h19V19a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19z"/><path d="M10 17h4"/>',
  "tab-more":
    '<circle cx="5" cy="12" r=".875"/><circle cx="12" cy="12" r=".875"/><circle cx="19" cy="12" r=".875"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m15.75 15.75 4.75 4.75"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  "chevron-right": '<path d="m9 5 7 7-7 7"/>',
  "chevron-down": '<path d="m5 8.5 7 7 7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m4.5 12.5 5 5L19.5 7"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  share:
    '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 12.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.75"/><path d="M6 12h.01M18 12h.01"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  transfer:
    '<path d="M4 8h15.5M16 4.5 19.5 8 16 11.5"/><path d="M20 16H4.5M8 12.5 4.5 16 8 19.5"/>',
  cod: '<path d="M17 11V6.5L10 3 3 6.5v8l7 3.5"/><path d="M3 6.5l7 3.5 7-3.5M10 10v8M6.5 4.75l7 3.5"/><circle cx="17" cy="17" r="4.5"/><circle cx="17" cy="17" r="1.5"/>',
  held: '<path d="M8.5 3h7M9.5 3v5.5L6.5 13.5h11l-3-5V3"/><path d="M12 13.5V21"/>',
  parcel:
    '<path d="M12 3l8 4v10l-8 4-8 -4v-10z"/><path d="M4 7l8 4 8 -4M12 11v10"/><path d="M8 5l8 4"/>',
  sent: '<path d="M15 5l6 3v8l-6 3-6 -3v-8z"/><path d="M9 8l6 3 6 -3M15 11v8"/><path d="M12 6.5l6 3"/><path d="M2.5 10H6M4 14h2"/>',
  "post-office":
    '<path d="M3 10 12 3.5l9 6.5"/><path d="M5 8.6V20h14V8.6"/><rect x="8" y="11.5" width="8" height="3.5" rx="1"/>',
  collected:
    '<circle cx="12" cy="12" r="9"/><path d="m8 12.25 2.75 2.75L16 9.75"/>',
  counter:
    '<path d="M3 9 4.5 4h15L21 9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M9 9l1-5M15 9l-1-5"/><path d="M4.5 12.5v8M19.5 12.5v8M3 16h18"/>',
  chat: '<path d="M6.5 3.5h11A2.5 2.5 0 0 1 20 6v8a2.5 2.5 0 0 1-2.5 2.5H11L6.5 20v-3.5A2.5 2.5 0 0 1 4 14V6a2.5 2.5 0 0 1 2.5-2.5z"/>',
  phone:
    '<path d="M5 4h3.5l1.5 4.5-2.25 1.5a11 11 0 0 0 6.25 6.25L15.5 14l4.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4z"/>',
  owed: '<path d="M19 7 8 18M8 11.5V18h6.5"/><path d="M3.5 6h5.5"/>',
  warning:
    '<path d="M10.27 4.5a2 2 0 0 1 3.46 0l7.5 13a2 2 0 0 1-1.73 3H4.5a2 2 0 0 1-1.73-3z"/><path d="M12 9.5V14M12 17h.01"/>',
  danger: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  damaged:
    '<path d="M10 3h4l4 4v11l-2 2-2-2-2 2-2-2-2 2-2-2V7z"/><circle cx="12" cy="8.5" r="2"/>',
  return:
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  arrived:
    '<path d="M5 10.5v7l7 3.5 7-3.5v-7"/><path d="M5 10.5 12 14l7-3.5M12 14v7M5 10.5 7 9.5M19 10.5l-2-1"/><path d="M12 2.5v8M9 7.5l3 3 3-3"/>',
  stocktake:
    '<rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M15 4.25h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6.25a2 2 0 0 1 2-2h2"/><path d="m9 13.5 2 2 4-4"/>',
  catalogue:
    '<path d="M8.5 7.5 12 4h4l3.5 3.5v10H15"/><path d="M7.5 7.5h4l3.5 3.5V21H4V11z"/><circle cx="9.5" cy="12" r="1.75"/>',
  report: '<path d="M6 19v-6M12 19V5M18 19V9"/>',
  supplier:
    '<path d="M3 3.5h2.5v14h15.5"/><circle cx="7.5" cy="19.75" r="1.75"/><path d="M9 17.5V8.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9M9 12.5h11"/>',
  stores:
    '<path d="M2 9 3.5 4h17L22 9"/><path d="M2 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0"/><path d="M7 9l.5-5M12 9V4M17 9l-.5-5"/><path d="M3.5 12v8.5h17V12M12 12v8.5"/>',
  backup:
    '<path d="M17.5 18.5H8.5a6 6 0 1 1 5.8-7.5h3.2a3.75 3.75 0 0 1 0 7.5z"/><path d="m9 13 2 2 4-4"/>',
  settings:
    '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  language:
    '<path d="M2.5 19 7 5l4.5 14M4.1 14h5.8"/><circle cx="16.75" cy="16" r="3"/><path d="M19.75 13v6"/>',
  paper:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  backspace:
    '<path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6.5-7z"/><path d="m11.5 9.5 5 5M16.5 9.5l-5 5"/>',
  person:
    '<circle cx="12" cy="7.5" r="3.75"/><path d="M4.5 20.5v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.75h.01"/>',
  edit: '<path d="M14.5 5 19 9.5 9 19.5H4.5V15z"/><path d="m12.5 7 4.5 4.5"/>',
  want: '<path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1z"/><path d="M12 7.5v5M9.5 10h5"/>',
  "home-screen":
    '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 8.5v5M9.5 11h5M10.5 18.5h3"/>',
  "eyelet-filled": '<circle cx="12" cy="12" r="6" fill="currentColor"/>',
  "eyelet-ring": '<circle cx="12" cy="12" r="6"/>',
  "eyelet-dashed":
    '<circle cx="12" cy="12" r="6" stroke-linecap="butt" stroke-dasharray="3.2 3.083"/>',
  "eyelet-knot":
    '<circle cx="9" cy="12" r="5"/><path d="M14 12c1-3.5 6.5-5 6.5-1.5 0 2.5-3.5 3-6.5 1.5z"/>',
  mark: '<path d="M10 9h4l4 4v8.5H6V13z"/><circle cx="12" cy="13.5" r="1.75"/><path style="stroke:var(--mark-thread,currentColor)" d="M12 11.75C13 7.5 15.5 3 18.5 3.25S21 7 18 8.25 13.5 9.5 12 11.75z"/>',
  "chevron-left": '<path d="M15 5l-7 7 7 7"/>',
  "chevron-up": '<path d="m5 15.5 7-7 7 7"/>',
  "more-horizontal":
    '<circle cx="5" cy="12" r=".875"/><circle cx="12" cy="12" r=".875"/><circle cx="19" cy="12" r=".875"/>',
  drawer:
    '<path d="M4.5 13.5V5.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5v8"/><path d="M9.5 8.5h5"/><path d="M2.5 13.5h19V19a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19z"/><path d="M10 17h4"/>',
  "eyelet-spin": '<path d="M18 12a6 6 0 1 1-6-6"/>',
  "mark-lg":
    '<path stroke-width="1" d="M10 9h4l4.5 4.5v8.5h-13v-8.5z"/><circle stroke-width="1" cx="12" cy="13.5" r="1.5"/><path stroke-width="1" stroke-dasharray="0 1.625" d="M5.5 18.5h13"/><path stroke-width="1.25" style="stroke:var(--mark-thread,currentColor)" d="M12 12C13 7.5 15.75 2.75 18.75 3S21.25 6.75 18.25 8 13.5 9.75 12 12z"/>',
} as const;

export type IconName = keyof typeof icons;
