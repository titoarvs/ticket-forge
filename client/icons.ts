// @ts-nocheck
// Inline SVG icons (issue types, priorities, UI glyphs).
const box = (fill, inner, title) => `<svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="${title}"><title>${title}</title><rect width="16" height="16" rx="3" fill="${fill}"/>${inner}</svg>`;

export const TYPE_ICON = {
  Story: box('#63ba3c', '<path d="M5 3.5h6v9l-3-2.2-3 2.2z" fill="#fff"/>', 'Story'),
  Task: box('#4bade8', '<path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>', 'Task'),
  Bug: box('#e5493a', '<circle cx="8" cy="8" r="3.2" fill="#fff"/>', 'Bug'),
  Spike: box('#ff991f', '<circle cx="7.2" cy="7.2" r="2.7" stroke="#fff" stroke-width="1.7" fill="none"/><path d="M9.3 9.3l2.4 2.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>', 'Spike'),
  Epic: box('#904ee2', '<path d="M9 2.8L4.6 9h3l-.6 4.2L11.4 7h-3z" fill="#fff"/>', 'Epic'),
  Test: box('#1d9aaa', '<path d="M6.3 3.5h3.4M7 3.5v3.2l-2.6 4.6c-.3.5.1 1.2.7 1.2h5.8c.6 0 1-.7.7-1.2L9 6.7V3.5" stroke="#fff" stroke-width="1.4" fill="none" stroke-linejoin="round"/>', 'Test case'),
};
export const typeIcon = (t) => TYPE_ICON[t] || TYPE_ICON.Task;

const chev = (d, c) => `<path d="${d}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const pri = (inner, title) => `<svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="${title} priority"><title>${title} priority</title>${inner}</svg>`;
export const PRIORITY_ICON = {
  Highest: pri(chev('M3.5 8L8 3.5 12.5 8', '#c9372c') + chev('M3.5 12.5L8 8l4.5 4.5', '#c9372c'), 'Highest'),
  High: pri(chev('M3.5 10.5L8 6l4.5 4.5', '#e2483d'), 'High'),
  Medium: pri('<path d="M3 6h10M3 10h10" stroke="#e06c00" stroke-width="2" stroke-linecap="round"/>', 'Medium'),
  Low: pri(chev('M3.5 5.5L8 10l4.5-4.5', '#1d7afc'), 'Low'),
};
export const priorityIcon = (p) => PRIORITY_ICON[p] || PRIORITY_ICON.Medium;

const s = (d, extra = '') => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const I = {
  search: s('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
  chevron: s('<path d="M4 6l4 4 4-4"/>', 'class="chev"'),
  plus: s('<path d="M8 3v10M3 8h10"/>'),
  close: s('<path d="M4 4l8 8M12 4l-8 8"/>'),
  menu: s('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
  more: s('<circle cx="3.5" cy="8" r=".6" fill="currentColor"/><circle cx="8" cy="8" r=".6" fill="currentColor"/><circle cx="12.5" cy="8" r=".6" fill="currentColor"/>'),
  expand: s('<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"/>'),
  collapse: s('<path d="M13 7H9V3M3 9h4v4M9 7l4.5-4.5M7 9l-4.5 4.5"/>'),
  sparkle: s('<path d="M8 1.8l1.3 3.4 3.4 1.3-3.4 1.3L8 11.2 6.7 7.8 3.3 6.5l3.4-1.3zM12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>'),
  summary: s('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'),
  backlog: s('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
  board: s('<rect x="2" y="2.5" width="3.5" height="11" rx="1"/><rect x="6.25" y="2.5" width="3.5" height="7" rx="1"/><rect x="10.5" y="2.5" width="3.5" height="9" rx="1"/>'),
  epic: s('<path d="M9 1.8L3.8 9h3.6l-.8 5.2L12.2 7H8.6z"/>'),
  test: s('<path d="M6 2h4M6.7 2v4L3.3 12.2c-.4.7.1 1.8 1 1.8h7.4c.9 0 1.4-1.1 1-1.8L9.3 6V2M5 10h6"/>'),
  doc: s('<path d="M9.5 1.8H4.2c-.6 0-1 .4-1 1v10.4c0 .6.4 1 1 1h7.6c.6 0 1-.4 1-1V5.1z"/><path d="M9.5 1.8v3.3h3.3M5.5 8.5h5M5.5 11h3.5"/>'),
  settings: s('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4"/>'),
  undo: s('<path d="M5.5 4L2.5 7l3 3"/><path d="M2.5 7h7a4 4 0 010 8H7"/>'),
  redo: s('<path d="M10.5 4l3 3-3 3"/><path d="M13.5 7h-7a4 4 0 000 8H9"/>'),
  upload: s('<path d="M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 10.5v2.5c0 .6.4 1 1 1h9c.6 0 1-.4 1-1v-2.5"/>'),
  download: s('<path d="M8 2.5V11M4.5 7.5L8 11l3.5-3.5M2.5 10.5v2.5c0 .6.4 1 1 1h9c.6 0 1-.4 1-1v-2.5"/>'),
  trash: s('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/>'),
  copy: s('<rect x="5" y="5" width="8.5" height="8.5" rx="1"/><path d="M11 5V3.5c0-.6-.4-1-1-1H3.5c-.6 0-1 .4-1 1V10c0 .6.4 1 1 1H5"/>'),
  up: s('<path d="M4 10l4-4 4 4"/>'),
  down: s('<path d="M4 6l4 4 4-4"/>'),
  warn: s('<path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5v3M8 11.5v.2"/>'),
  check: s('<path d="M3 8.5l3 3 7-7"/>'),
  grid: s('<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M2 6h12M6 6v8"/>'),
  database: s('<ellipse cx="8" cy="3.6" rx="5.2" ry="1.9"/><path d="M2.8 3.6v8.8c0 1 2.3 1.9 5.2 1.9s5.2-.9 5.2-1.9V3.6"/><path d="M2.8 8c0 1 2.3 1.9 5.2 1.9s5.2-.9 5.2-1.9"/>'),
  folder: s('<path d="M1.8 4.2c0-.6.4-1 1-1h3.4l1.4 1.6h5.6c.6 0 1 .4 1 1v6.9c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z"/>'),
  user: s('<circle cx="8" cy="5.5" r="2.8"/><path d="M2.8 14c.6-2.6 2.7-4.2 5.2-4.2s4.6 1.6 5.2 4.2"/>'),
  logo: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 3.5h10v2.6H9.4V13H6.6V6.1H3z" fill="#fff"/></svg>',
  subtask: s('<rect x="2" y="2" width="6" height="6" rx="1"/><rect x="8" y="8" width="6" height="6" rx="1"/><path d="M5 8v3h3"/>'),
  link: s('<path d="M6.6 9.4l2.8-2.8M7.3 4.7l1.2-1.2a2.6 2.6 0 013.7 3.7l-1.2 1.2M8.7 11.3l-1.2 1.2a2.6 2.6 0 01-3.7-3.7l1.2-1.2"/>'),
  pr: s('<circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="12.5" r="1.6"/><path d="M4 5.1v5.8M12 10.9V6.5a2 2 0 00-2-2H7.5M9 3l-1.5 1.5L9 6"/>'),
  pencil: s('<path d="M10.5 2.5l3 3L6 13H3v-3z"/>'),
  play: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.2v9.6c0 .4.5.7.8.4l7-4.8c.3-.2.3-.6 0-.8l-7-4.8c-.3-.3-.8 0-.8.4z"/></svg>',
  stop: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.2"/></svg>',
  bot: s('<rect x="2.5" y="5" width="11" height="8" rx="2"/><path d="M8 5V2.5M5.5 9h.01M10.5 9h.01M6 11.2h4"/>'),
  clock: s('<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.4"/>'),
  comment: s('<path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/>'),
  brain: s('<circle cx="4" cy="4.5" r="1.7"/><circle cx="12" cy="4" r="1.7"/><circle cx="8" cy="12" r="1.9"/><circle cx="3.6" cy="11" r="1.3"/><path d="M5.6 4.4l4.7-.3M5 5.9l2.2 4.4M11.2 5.5L8.9 10.2M5 11.3l1.1.4"/>'),
  history: s('<path d="M2.5 8a5.5 5.5 0 105.5-5.5c-2 0-3.7 1-4.7 2.6"/><path d="M2.8 2.5v2.8h2.8M8 5.3V8l2 1.3"/>'),
  external: s('<path d="M9.5 2.5h4v4M13.5 2.5L8 8M12 9.5v3c0 .6-.4 1-1 1H3.5c-.6 0-1-.4-1-1V5c0-.6.4-1 1-1h3"/>'),
  refresh: s('<path d="M13.5 3v3.2h-3.2M2.5 13V9.8h3.2"/><path d="M12.9 6.2A5.5 5.5 0 003.2 5M3.1 9.8a5.5 5.5 0 009.7 1.2"/>'),
  calendar: s('<rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4"/>'),
  chart: s('<path d="M2.5 13.5h11"/><rect x="3.5" y="8" width="2" height="4" rx=".5"/><rect x="7" y="5" width="2" height="7" rx=".5"/><rect x="10.5" y="2.5" width="2" height="9.5" rx=".5"/>'),
  people: s('<circle cx="6" cy="5.5" r="2.3"/><path d="M1.8 13c.5-2.2 2.2-3.5 4.2-3.5s3.7 1.3 4.2 3.5"/><path d="M10.5 3.4a2.2 2.2 0 010 4.3M12 9.8c1.2.4 2 1.6 2.2 3.2"/>'),
  sun: s('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>'),
  moon: s('<path d="M13.2 9.6A5.5 5.5 0 016.4 2.8a5.5 5.5 0 106.8 6.8z"/>'),
  bell: s('<path d="M4 11.5V7.2a4 4 0 018 0v4.3l1.3 1.3H2.7z"/><path d="M6.6 13.8a1.5 1.5 0 002.8 0"/>'),
  flag: s('<path d="M3.5 14V2.5M3.5 3h8.5l-1.8 3 1.8 3H3.5"/>'),
};
TYPE_ICON['Sub-task'] = box('#4bade8', '<rect x="3.5" y="3.5" width="5" height="5" rx="1" fill="#fff"/><rect x="7.5" y="7.5" width="5" height="5" rx="1" fill="none" stroke="#fff" stroke-width="1.4"/>', 'Sub-task');
