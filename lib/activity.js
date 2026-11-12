// Readable timeline entries for changes to a project's sections (sprints, epics, releases, workflow, settings,
// test management…), worked out on the server from what a save changes. Issue changes aren't here: each issue keeps
// its own history, and the Activity page shows both.

/** Same JSON regardless of key order (the database stores object keys in its own order). */
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x);
const J = (x) => JSON.stringify(canon(x ?? null));
const isIdList = (x) => Array.isArray(x) && x.every((v) => v && typeof v === 'object' && typeof v.id === 'string');
const q = (s) => `“${String(s ?? '').slice(0, 80)}”`;
const FIELD = { name: 'name', title: 'title', description: 'description', goal: 'goal', startDate: 'start date', endDate: 'end date', releaseDate: 'release date',
  color: 'colour', state: 'state', status: 'status', category: 'category', next: 'transitions', wip: 'column limit', steps: 'steps', expected: 'expected result', email: 'email', role: 'role' };

// Section → [kind, noun, label of an item]
const LISTS = {
  epics: ['epic', 'epic', (x) => x.title || x.key],
  sprints: ['sprint', 'sprint', (x) => x.name],
  releases: ['release', 'version', (x) => x.name],
  members: ['settings', 'member', (x) => x.name],
  workflow: ['settings', 'status', (x) => x.name],
  sources: ['settings', 'source document', (x) => x.name || x.title],
};
const TEST_LISTS = { tests: ['test', (x) => x.title || x.key], plans: ['test plan', (x) => x.name || x.title], executions: ['test execution', (x) => x.name || x.title], folders: ['folder', (x) => x.name] };
const SETTINGS = { name: 'the project name', key: 'the project key', summary: 'the project summary', description: 'the project description', assumptions: 'the assumptions',
  openQuestions: 'the open questions', automation: 'the test automation settings', appContext: 'the app context', flowMode: 'the workflow mode', sourceText: 'the source document' };

/** Special wording for state changes (start / complete a sprint, release a version, approve a test…). */
function stateText(noun, label, a, b) {
  if (noun === 'sprint' && a.state !== b.state) return b.state === 'active' ? `started sprint ${q(label)}` : b.state === 'closed' ? `completed sprint ${q(label)}` : null;
  if (noun === 'version' && a.status !== b.status) return b.status === 'released' ? `released version ${q(label)}` : b.status === 'archived' ? `archived version ${q(label)}` : `moved version ${q(label)} back to unreleased`;
  if (noun === 'test' && a.status !== b.status && b.status) return `set test ${q(label)} to ${b.status}`;
  return null;
}

function diffList(kind, noun, label, before, after) {
  const B = new Map((before || []).map((x) => [x.id, x])), A = new Map((after || []).map((x) => [x.id, x]));
  const out = [];
  for (const [id, x] of A) {
    const o = B.get(id);
    if (!o) { out.push({ kind, text: `created ${noun} ${q(label(x))}`, target: label(x) || '' }); continue; }
    if (J(o) === J(x)) continue;
    const special = stateText(noun, label(x), o, x);
    if (special) { out.push({ kind, text: special, target: label(x) || '' }); continue; }
    if (label(o) !== label(x)) { out.push({ kind, text: `renamed ${noun} ${q(label(o))} to ${q(label(x))}`, target: label(x) || '' }); continue; }
    const keys = [...new Set([...Object.keys(o), ...Object.keys(x)])].filter((k) => J(o[k]) !== J(x[k]) && !/At$|^id$/.test(k));
    if (!keys.length) continue; // only timestamps changed
    const names = keys.map((k) => FIELD[k] || k).slice(0, 3);
    out.push({ kind, text: `updated ${noun} ${q(label(x))}${names.length ? ` (${names.join(', ')}${keys.length > 3 ? '…' : ''})` : ''}`, target: label(x) || '' });
  }
  for (const [id, o] of B) if (!A.has(id)) out.push({ kind, text: `deleted ${noun} ${q(label(o))}`, target: label(o) || '' });
  return out;
}

/** Timeline entries for one changed section: [{ kind, text, target }]. */
export function describeSection(key, before, after) {
  if (LISTS[key] && (isIdList(before || []) && isIdList(after || []))) {
    const [kind, noun, label] = LISTS[key];
    const out = diffList(kind, noun, label, before, after);
    if (key === 'workflow' && !out.length) out.push({ kind, text: 'reordered the workflow statuses', target: '' });
    return out;
  }
  if (key === 'testRepo') {
    const out = [];
    for (const [k, [noun, label]] of Object.entries(TEST_LISTS)) {
      const a = before?.[k], b = after?.[k];
      if ((a || b) && isIdList(a || []) && isIdList(b || [])) out.push(...diffList('test', noun, label, a, b));
    }
    if (!out.length) out.push({ kind: 'test', text: 'updated the test management settings', target: '' });
    return out;
  }
  if (key === 'name' && before && after) return [{ kind: 'settings', text: `renamed the project from ${q(before)} to ${q(after)}`, target: '' }];
  if (SETTINGS[key]) return [{ kind: 'settings', text: `updated ${SETTINGS[key]}`, target: '' }];
  return [{ kind: 'settings', text: `updated the project’s ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`, target: '' }];
}
