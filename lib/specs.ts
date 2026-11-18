// Coding specs: the prompt written for each ticket of an epic, and the overlap check that keeps features coded in
// parallel from touching the same files or modules. Pure functions (no database, no AI): lib/store.ts saves the specs,
// lib/specgen.ts asks the AI which files a ticket will touch.
import { tablesMentioned } from './dbschema';

const OVERLAP_MODES = ['block', 'warn'];
const clip = (s, n) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** A repository path in one form (no ./ or leading /, forward slashes, lower case), or '' when it isn't a usable path. */
function normalizePath(p) {
  const s = String(p ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
  if (!s || s.length > 300 || s.split('/').includes('..')) return '';
  return s.toLowerCase();
}

/** The project's settings for coding specs: { overlapMode: 'block' | 'warn', reviewers: [userId] }. Blocking is the default. */
export function specConfig(project) {
  const c = project?.specConfig || {};
  return {
    overlapMode: OVERLAP_MODES.includes(c.overlapMode) ? c.overlapMode : 'block',
    reviewers: Array.isArray(c.reviewers) ? c.reviewers.map(String) : [],
  };
}

/** What the AI said a ticket touches, cleaned: { files: [{ path, action, why }], modules: [string] }. */
export function cleanTouches(raw) {
  const seen = new Set(),
    files = [];
  for (const f of Array.isArray(raw?.files) ? raw.files : []) {
    const path = String(typeof f === 'string' ? f : (f?.path ?? ''))
      .trim()
      .replace(/\\/g, '/')
      .replace(/^(\.\/)+/, '')
      .replace(/^\/+/, '');
    const key = normalizePath(path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    files.push({ path, action: f?.action === 'create' ? 'create' : 'modify', why: clip(f?.why, 200) });
    if (files.length >= 25) break;
  }
  const mods = new Set(),
    modules = [];
  for (const m of Array.isArray(raw?.modules) ? raw.modules : []) {
    const name = String(m ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^(\.\/)+/, '')
      .replace(/\/$/, '');
    const key = normalizePath(name);
    if (!key || mods.has(key)) continue;
    mods.add(key);
    modules.push(name);
    if (modules.length >= 10) break;
  }
  return { files, modules };
}

/**
 * The prompt a developer (or an AI coding agent) works from for one ticket: the goal, the acceptance criteria, the
 * files and modules it may change, and the rules for parallel work. Markdown.
 */
export function specPrompt({ project, epic, ticket, subtasks = [], files = [], modules = [] }: any) {
  const ac = Array.isArray(ticket.acceptanceCriteria) ? ticket.acceptanceCriteria.filter(Boolean) : [];
  // The tables this ticket talks about, from the project's database schema (Project settings → Database).
  const tables = tablesMentioned(
    project,
    [ticket.title, ticket.userStory, ticket.description, ...ac, ...subtasks.map((t) => t.title), epic?.title].filter(Boolean).join('\n'),
  );
  const lines = [
    `# Coding spec: ${ticket.key || ''} ${ticket.title}`.trim(),
    `Project: ${project.name}${epic ? ` · Feature (epic): ${epic.key || ''} ${epic.title}`.trimEnd() : ''}`,
    ticket.userStory && `## User story\n${ticket.userStory}`,
    ticket.description && `## Description\n${ticket.description}`,
    `## Acceptance criteria\n${ac.length ? ac.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'None written yet: derive them from the description and confirm them before coding.'}`,
    subtasks.length && `## Sub-tasks (part of this ticket)\n${subtasks.map((t) => `- ${t.key || ''} ${t.title}`.trim()).join('\n')}`,
    `## Files and modules expected to change\n${files.length ? files.map((f) => `- ${f.path} (${f.action === 'create' ? 'new' : 'change'})${f.why ? `: ${f.why}` : ''}`).join('\n') : 'No files were predicted: find them in the repository first.'}${modules.length ? `\n\nModules: ${modules.join(', ')}` : ''}`,
    tables.length &&
      `## Database tables involved\n${tables.join('\n')}\n\nUse these exact table and column names. If the ticket needs a table or column that isn’t listed, add a migration and say so in your summary.`,
    `## Rules\n- Follow the structure, naming, libraries and tests the repository already uses.\n- Stay inside the files and modules above. If you must touch another file, say so in your summary: other tickets of this feature are coded in parallel and may use it.\n- Meet every acceptance criterion and add tests for them.\n- Your changes are reviewed: they are accepted only after a required reviewer approves them.`,
  ];
  return lines.filter(Boolean).join('\n\n');
}

/**
 * Overlaps between specs: the same file (compared without case, ./ or leading /) or the same module in two specs.
 * Specs of one epic always count. Specs of different epics count only when one of them is ready (being coded now),
 * so two epics still being planned don't warn about each other.
 * Returns [{ kind: 'file' | 'module', target, crossEpic, specs: [{ ticketId, key, title, epicId, status }] }].
 */
export function findOverlaps(specs) {
  const groups: Map<any, any> = new Map();
  const add = (kind, name, spec) => {
    const norm = normalizePath(name);
    if (!norm) return;
    const k = `${kind}:${norm}`;
    if (!groups.has(k))
      groups.set(k, {
        kind,
        target: String(name)
          .trim()
          .replace(/^(\.\/)+/, '')
          .replace(/^\/+/, ''),
        list: new Map(),
      });
    groups.get(k).list.set(spec.ticketId, spec);
  };
  for (const s of specs) {
    for (const f of s.files || []) add('file', f.path, s);
    for (const m of s.modules || []) add('module', m, s);
  }
  const out: any[] = [];
  for (const g of groups.values()) {
    const list = [...g.list.values()];
    const hit: Set<any> = new Set();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i],
          b = list[j];
        if (a.epicId === b.epicId || a.status === 'ready' || b.status === 'ready') {
          hit.add(a);
          hit.add(b);
        }
      }
    }
    if (hit.size < 2) continue;
    const involved = list.filter((s) => hit.has(s));
    out.push({
      kind: g.kind,
      target: g.target,
      crossEpic: new Set(involved.map((s) => s.epicId)).size > 1,
      specs: involved.map((s) => ({ ticketId: s.ticketId, key: s.key, title: s.title, epicId: s.epicId, status: s.status })),
    });
  }
  return out.sort((x, y) => (x.kind === y.kind ? x.target.localeCompare(y.target) : x.kind === 'file' ? -1 : 1));
}

/** One overlap in words: "PR-2 and PR-3 both touch lib/store.ts (file)". */
export function describeOverlap(o) {
  const keys = o.specs.map((s) => s.key || s.ticketId);
  const who = keys.length === 2 ? `${keys[0]} and ${keys[1]} both` : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]} all`;
  return `${who} touch ${o.target} (${o.kind}${o.crossEpic ? ', different epics' : ''})`;
}
