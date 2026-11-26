// Database setup page (first launch, or TicketForge → Change database…).
'use strict';

const db = window.tfdb;
const $ = (id) => document.getElementById(id);

function show(text, kind = '') {
  $('result').textContent = text;
  $('result').className = `result ${kind}`;
}

function busy(on, label) {
  for (const id of ['test', 'connect', 'local']) $(id).disabled = on;
  if (label) show(label);
}

function describe(r) {
  const data = r.hasTables
    ? `It already has TicketForge data (${r.users} ${r.users === 1 ? 'person' : 'people'}).`
    : 'It is empty: TicketForge will set it up.';
  return `Connected to ${r.version}${r.ssl ? ' (encrypted)' : ''}. ${data}`;
}

$('show').onclick = () => {
  const hidden = $('url').type === 'password';
  $('url').type = hidden ? 'text' : 'password';
  $('show').textContent = hidden ? 'Hide' : 'Show';
};

$('test').onclick = async () => {
  busy(true, 'Connecting…');
  const r = await db.test($('url').value);
  busy(false);
  show(r.ok ? describe(r) : r.error, r.ok ? 'ok' : 'bad');
};

$('form').onsubmit = async (ev) => {
  ev.preventDefault();
  busy(true, 'Connecting…');
  const r = await db.connect($('url').value);
  if (!r.ok) {
    busy(false);
    show(r.error, 'bad');
    return;
  }
  show(`${describe(r)} Starting TicketForge…`, 'ok');
};

$('local').onclick = async () => {
  busy(true, 'Starting TicketForge…');
  await db.useLocal();
};

db.current().then((c) => {
  if (c?.label) $('current').textContent = `Now using: ${c.label}`;
  $('url').focus();
});
