// The terminal panel: xterm.js connected to a shell in the main process (see desktop/terminal.cjs),
// with a bar that sets up Claude Code so TicketForge can use your Claude subscription.
/* global Terminal, FitAddon, WebLinksAddon */
'use strict';

const api = window.tf;
const isMac = api.platform === 'darwin';
const $ = (id) => document.getElementById(id);

const term = new Terminal({
  fontFamily: 'Menlo, "SF Mono", "Cascadia Mono", Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.15,
  cursorBlink: true,
  scrollback: 5000,
  macOptionIsMeta: true,
  theme: {
    background: '#141414',
    foreground: '#e8e8ea',
    cursor: '#e8e8ea',
    selectionBackground: '#3a4a66',
  },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, url) => api.open(url)));
term.open($('term'));

let started = false;
let exited = false;

function refit() {
  try {
    fit.fit();
  } catch {
    /* hidden: no size yet */
  }
}

async function startShell() {
  if (started) return;
  started = true;
  refit();
  await api.start({ cols: term.cols, rows: term.rows });
}

term.onData((d) => {
  if (exited) {
    if (d === '\r') {
      exited = false;
      api.restart();
    }
    return;
  }
  api.input(d);
});
term.onResize(({ cols, rows }) => api.resize({ cols, rows }));
new ResizeObserver(refit).observe($('term'));

// Copy and paste. On macOS the Edit menu's Cmd+C / Cmd+V already work. On Windows Ctrl+C copies when
// text is selected (otherwise it stops the running command), and Ctrl+V / Ctrl+Shift+V paste.
term.attachCustomKeyEventHandler((ev) => {
  if (ev.type !== 'keydown' || isMac || !ev.ctrlKey) return true;
  const key = ev.key.toLowerCase();
  if (key === 'c' && (ev.shiftKey || term.hasSelection())) {
    ev.preventDefault();
    api.copy(term.getSelection());
    term.clearSelection();
    return false;
  }
  if (key === 'v') {
    ev.preventDefault();
    api.paste().then((t) => t && term.paste(t));
    return false;
  }
  return true;
});
// Right-click copies the selection, or pastes when nothing is selected (like Windows Terminal).
$('term').addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  if (term.hasSelection()) {
    api.copy(term.getSelection());
    term.clearSelection();
  } else api.paste().then((t) => t && term.paste(t));
});

api.on('term:data', (d) => term.write(d));
api.on('term:exit', (code) => {
  exited = true;
  term.write(`\r\n\x1b[2m[The shell ended (${code}). Press Enter to start a new one.]\x1b[0m\r\n`);
});
api.on('term:clear', () => {
  exited = false;
  term.reset();
});
api.on('term:focus', () => term.focus());
api.on('panel:shown', (state) => {
  $('btn-expand').textContent = state?.expanded ? '▾' : '▴';
  $('btn-expand').title = state?.expanded ? 'Make smaller' : 'Make bigger';
  startShell().then(() => {
    refit();
    term.focus();
  });
});

// ------------------------------------------------------------------ Claude Code setup bar

const TEXT = {
  checking: () => 'Checking Claude Code…',
  missing: () => 'Claude Code isn’t installed',
  outdated: (s) => `Claude Code ${s?.version || ''} is too old`,
  'signed-out': () => 'Claude Code: not signed in',
  restarting: (s) => `Connected${s?.email ? ` as ${s.email}` : ''}. Restarting TicketForge…`,
  ready: (s) =>
    `Claude ${s?.plan ? s.plan[0].toUpperCase() + s.plan.slice(1) + ' ' : ''}account${
      s?.email ? `: ${s.email}` : ''
    }`,
};

function showNote(html) {
  $('note').hidden = !html;
  $('note').innerHTML = html || '';
}

api.on('claude:status', ({ state, status, busy }) => {
  $('chip').dataset.state = state;
  $('chip-text').textContent = (TEXT[state] || TEXT.checking)(status);
  $('chip').title = status?.path
    ? `${status.path}${status.version ? ` (${status.version})` : ''}`
    : '';
  $('btn-install').hidden = state !== 'missing' && state !== 'outdated';
  $('btn-install').textContent =
    state === 'outdated' ? 'Update Claude Code' : 'Install Claude Code';
  $('btn-login').hidden = state !== 'signed-out';
  $('btn-check').hidden = state === 'ready' || state === 'checking' || state === 'restarting';
  $('btn-check').textContent = busy ? 'Waiting… check now' : 'Check again';
  let note = '';
  if (state === 'missing')
    note =
      'TicketForge uses your own Claude subscription (Pro or Max) through Claude Code. Click <b>Install Claude Code</b>, wait for it to finish, then <b>Sign in to Claude</b>.';
  else if (state === 'outdated')
    note =
      'TicketForge needs Claude Code 2.1 or newer. Click <b>Update Claude Code</b>, then sign in if asked.';
  else if (state === 'signed-out')
    note =
      'Click <b>Sign in to Claude</b>. Your browser opens: sign in, approve, and come back. If it asks for a code, paste it here.';
  if (status?.needsGit)
    note +=
      ' On Windows, Claude Code also needs <a data-href="https://git-scm.com/downloads/win">Git for Windows</a>.';
  showNote(note.trim());
});

$('note').addEventListener('click', (ev) => {
  const href = ev.target?.dataset?.href;
  if (href) api.open(href);
});
$('btn-install').onclick = () => api.action('install');
$('btn-login').onclick = () => api.action('login');
$('btn-check').onclick = () => api.action('check');
$('btn-restart').onclick = () => api.restart();
$('btn-expand').onclick = () => api.action('expand');
$('btn-hide').onclick = () => api.action('hide');
