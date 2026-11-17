// Normalises Claude output into the project data model and assigns keys.
import { randomUUID } from 'node:crypto';

const TYPES = ['Story', 'Task', 'Spike', 'Bug'];
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low'];
const EPIC_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#f97316'];

export const uid = () => randomUUID().slice(0, 8);
const str = (v) => (v == null ? '' : String(v)).trim();
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(str).filter(Boolean);
const pick = (v, list, dflt) => list.find((x) => x.toLowerCase() === str(v).toLowerCase()) || dflt;

export function normTestCase(tc: any = {}) {
  return {
    id: tc.id || uid(),
    title: str(tc.title) || 'Untitled test',
    type: str(tc.type) || 'Functional',
    priority: pick(tc.priority, ['High', 'Medium', 'Low'], 'Medium'),
    preconditions: str(tc.preconditions),
    steps: arr(tc.steps),
    expected: str(tc.expected),
    acRef: (Array.isArray(tc.acRef) ? tc.acRef : []).map(Number).filter((n) => n > 0),
    status: tc.status || 'Not run',
  };
}

export function normTicket(t: any = {}, epicId) {
  const sp = Number(t.storyPoints);
  return {
    id: t.id || uid(),
    key: t.key || '',
    epicId: epicId ?? t.epicId ?? null,
    title: str(t.title) || 'Untitled ticket',
    type: pick(t.type, TYPES, 'Story'),
    priority: pick(t.priority, PRIORITIES, 'Medium'),
    storyPoints: Number.isFinite(sp) && sp > 0 ? sp : null,
    labels: arr(t.labels),
    userStory: str(t.userStory),
    description: str(t.description),
    acceptanceCriteria: arr(t.acceptanceCriteria),
    dependencies: arr(t.dependencies),
    testCases: (t.testCases || []).map(normTestCase),
    status: t.status || 'To Do',
    assignee: str(t.assignee),
    ...(['frontend', 'backend', 'both'].includes(t.layer) ? { layer: t.layer } : {}),
  };
}

export function buildProject(raw, { key, sourceName, sourceText }: any) {
  const epics: any[] = [];
  const tickets: any[] = [];
  (raw.epics || []).forEach((e, i) => {
    const epic = { id: uid(), key: '', title: str(e.title) || `Epic ${i + 1}`, description: str(e.description), color: EPIC_COLORS[i % EPIC_COLORS.length] };
    epics.push(epic);
    (e.tickets || []).forEach((t) => tickets.push(normTicket(t, epic.id)));
  });
  const now = new Date().toISOString();
  return assignKeys({
    id: uid(),
    name: str(raw.projectName) || sourceName || 'New project',
    key: (key || deriveKey(raw.projectName || sourceName)).toUpperCase(),
    summary: str(raw.summary),
    assumptions: arr(raw.assumptions),
    openQuestions: arr(raw.openQuestions),
    sourceName: sourceName || '',
    sourceText: sourceText || '',
    epics,
    tickets,
    createdAt: now,
    updatedAt: now,
  });
}

export function deriveKey(name) {
  const words = str(name).replace(/[^a-z0-9 ]/gi, ' ').split(/\s+/).filter(Boolean);
  const k = words.length > 1 ? words.slice(0, 4).map((w) => w[0]).join('') : (words[0] || 'PRJ').slice(0, 4);
  return k.toUpperCase() || 'PRJ';
}

/** Give every epic/ticket/test case a stable human key, filling gaps only. */
export function assignKeys(p) {
  const used = new Set(p.tickets.map((t) => t.key).filter(Boolean));
  let n = 0;
  const next = () => { do { n += 1; } while (used.has(`${p.key}-${n}`)); used.add(`${p.key}-${n}`); return `${p.key}-${n}`; };
  p.epics.forEach((e, i) => { if (!e.key) e.key = `${p.key}-E${i + 1}`; if (!e.color) e.color = EPIC_COLORS[i % EPIC_COLORS.length]; });
  for (const e of p.epics) for (const t of p.tickets.filter((x) => x.epicId === e.id)) if (!t.key) t.key = next();
  for (const t of p.tickets) if (!t.key) t.key = next();
  for (const t of p.tickets) t.testCases.forEach((tc, i) => { tc.key = `TC-${t.key}-${String(i + 1).padStart(2, '0')}`; });
  return p;
}
