// Keeps using TicketForge while the database moves to another host, and checks nothing failed and nothing was lost.
// Run it before and during `npm run db:migrate-host -- cutover`; see docs/postgres-host-migration.md.
//
//   Sign in, copy the value of the `tf_session` cookie, then:
//   TF_COOKIE=<cookie> PROJECT_ID=<project id> [BASE_URL=http://localhost:5173] [DURATION_S=120] [RATE=5] \
//     npm run db:cutover-load
//     Writes one new issue per tick (and reads the project), for DURATION_S seconds. A request the server refuses because
//     the database just moved (503 "db-moved") is retried like the browser does; anything else counts as failed.
//     Prints the totals and writes a ledger of every issue the app confirmed (data/cutover-load.json).
//
//   TF_COOKIE=<cookie> PROJECT_ID=<project id> BASE_URL=<app on the new host> npm run db:cutover-load -- --check
//     Reads the project from the app on the new host and fails when any confirmed issue is missing.
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const COOKIE = process.env.TF_COOKIE || '';
const PROJECT = process.env.PROJECT_ID || '';
const DURATION_MS = (Number(process.env.DURATION_S) || 120) * 1000;
const RATE = Number(process.env.RATE) || 5;
const LEDGER = process.env.LEDGER || path.join(process.cwd(), 'data', 'cutover-load.json');
if (!COOKIE || !PROJECT) {
  console.error('Set TF_COOKIE (the tf_session cookie value) and PROJECT_ID.');
  process.exit(2);
}

const headers = { 'Content-Type': 'application/json', Cookie: `tf_session=${COOKIE}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `${BASE}/api/projects/${encodeURIComponent(PROJECT)}`;

/** One request; a "database moved" 503 was refused before it ran, so it is asked again (as client/core.ts does). */
async function call(path_, init) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(path_, { ...init, headers });
    if (res.status !== 503 || attempt > 8) return res;
    const moved = await res
      .clone()
      .json()
      .then(
        (b) => b?.code === 'db-moved',
        () => false,
      );
    if (!moved) return res;
    await sleep(500 * attempt);
  }
}

if (process.argv.includes('--check')) {
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const res = await call(url, { method: 'GET' });
  if (!res.ok) {
    console.error(`Could not read the project: ${res.status}`);
    process.exit(1);
  }
  const have = new Set((await res.json()).tickets.map((t) => t.id));
  const missing = ledger.confirmed.filter((id) => !have.has(id));
  console.log(`${ledger.confirmed.length - missing.length} of ${ledger.confirmed.length} confirmed issues found on ${BASE}.`);
  if (missing.length) {
    console.error(`LOST: ${missing.length} issue(s), for example ${missing.slice(0, 5).join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
}

const runId = Date.now().toString(36);
const confirmed = [];
let failed = 0,
  sent = 0,
  reads = 0;
const failures = [];
const end = Date.now() + DURATION_MS;
const fail = (what, detail) => {
  failed++;
  if (failures.length < 10) failures.push(`${what}: ${detail}`);
};

async function writeOne(n) {
  const id = `load-${runId}-${n}`;
  const now = new Date().toISOString();
  const ticket = {
    id,
    key: `LOAD-${n}`,
    epicId: null,
    sprintId: null,
    parentId: null,
    title: `Load test ${runId} #${n}`,
    type: 'Task',
    priority: 'Low',
    storyPoints: null,
    labels: ['cutover-load'],
    userStory: '',
    description: '',
    acceptanceCriteria: [],
    dependencies: [],
    testCases: [],
    status: '',
    assignee: '',
    reporter: '',
    links: [],
    prs: [],
    comments: [],
    history: [],
    createdAt: now,
    updatedAt: now,
  };
  sent++;
  try {
    const res = await call(url, { method: 'PATCH', body: JSON.stringify({ upsert: [ticket] }) });
    if (res.ok) confirmed.push(id);
    else fail(`write #${n}`, `${res.status} ${(await res.text()).slice(0, 120)}`);
  } catch (e) {
    fail(`write #${n}`, e.message);
  }
}
async function readOne() {
  reads++;
  try {
    const res = await call(`${BASE}/api/status`, { method: 'GET' });
    if (!res.ok) fail('read', `${res.status}`);
  } catch (e) {
    fail('read', e.message);
  }
}

const inflight = new Set();
for (let n = 1; Date.now() < end; n++) {
  const p = Promise.all([writeOne(n), readOne()]).finally(() => inflight.delete(p));
  inflight.add(p);
  await sleep(1000 / RATE);
}
await Promise.all(inflight);

fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
fs.writeFileSync(LEDGER, JSON.stringify({ runId, base: BASE, project: PROJECT, confirmed, failed, sent, reads }, null, 2));
console.log(`Writes sent: ${sent}, confirmed: ${confirmed.length}. Reads: ${reads}. Failed requests: ${failed}.`);
for (const f of failures) console.error(`  ${f}`);
console.log(`Ledger: ${LEDGER}. After the move, run with --check against the app on the new host.`);
process.exit(failed ? 1 : 0);
