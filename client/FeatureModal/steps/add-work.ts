'use client';
// Adding the chosen work to the project: the new epics, the issues, and the source document (or
// description) linked to what it produced. One undo step.
import {
  type Any,
  toast,
  uid,
  mutate,
  nextEpicKey,
  COLORS,
  newTicket,
  withIds,
  nowIso,
  me,
  uploadOriginal,
} from '../../core';
import type { Source } from './plan-request';

export type AddInput = {
  projectId: string;
  result: Any;
  chosen: Any[];
  newEpics: Any[];
  canEpic: boolean;
  source: Source | null;
  kind: 'document' | 'description';
  /** The source document the work was planned from ('original', an added one, or none). */
  sourceId?: string;
};
type Created = { keys: string[]; issueIds: string[]; epicIds: Set<string> };

function addEpics(pp: Any, newEpics: Any[]) {
  for (const e of newEpics)
    pp.epics.push({
      id: e.id,
      key: nextEpicKey(),
      title: e.title,
      description: e.description,
      color: COLORS[pp.epics.length % COLORS.length],
    });
}

/** The chosen issues; without permission to create epics, issues of new epics get none. */
function addIssues(pp: Any, x: AddInput): Created {
  const out: Created = { keys: [], issueIds: [], epicIds: new Set() };
  for (const t of x.chosen) {
    const lostEpic = !x.canEpic && x.newEpics.some((e: Any) => e.id === t.epicId);
    const nt = newTicket({
      title: t.title,
      type: t.type,
      priority: t.priority,
      storyPoints: t.storyPoints,
      labels: t.labels,
      userStory: t.userStory,
      description: t.description,
      acceptanceCriteria: t.acceptanceCriteria,
      dependencies: t.dependencies,
      testCases: withIds(t.testCases),
      epicId: lostEpic ? null : t.epicId,
    });
    nt.history[0].text = `created the issue with AI (Add feature: ${x.source?.filename || 'description'})`;
    pp.tickets.push(nt);
    out.keys.push(nt.key);
    out.issueIds.push(nt.id);
    if (nt.epicId) out.epicIds.add(nt.epicId);
  }
  return out;
}

const union = (a: string[] = [], b: Iterable<string>) => [...new Set([...a, ...b])];

/** Links the work to its source: the original document, an added one, or a new source entry. */
function recordSource(pp: Any, x: AddInput, c: Created, newSourceId: string) {
  pp.sources ??= [];
  if (x.sourceId === 'original') {
    pp.sourceIssueIds = union(pp.sourceIssueIds, c.issueIds);
    pp.sourceEpicIds = union(pp.sourceEpicIds, c.epicIds);
    return;
  }
  const run = {
    at: nowIso(),
    by: me(),
    summary: x.result.summary || '',
    openQuestions: x.result.openQuestions || [],
    issueIds: c.issueIds,
    epicIds: [...c.epicIds],
  };
  const prev = x.sourceId && pp.sources.find((s: Any) => s.id === x.sourceId);
  if (prev) {
    prev.runs = [...(prev.runs || []), run];
    prev.summary ||= run.summary;
    prev.openQuestions = union(prev.openQuestions, run.openQuestions);
    prev.issueIds = union(prev.issueIds, c.issueIds);
    prev.epicIds = union(prev.epicIds, c.epicIds);
    return;
  }
  pp.sources.push({
    id: newSourceId,
    name: x.source?.filename || 'Feature description',
    kind: x.kind,
    text: x.source?.text || '',
    addedAt: run.at,
    addedBy: run.by,
    summary: run.summary,
    openQuestions: run.openQuestions,
    issueIds: c.issueIds,
    epicIds: [...c.epicIds],
    runs: [run],
  });
}

/** Keeps the original PDF or Word file with the new source entry (in the background). */
function keepOriginalFile(projectId: string, file: File, sourceId: string) {
  uploadOriginal(projectId, file)
    .then((meta: Any) =>
      mutate((pp) => {
        const d = (pp.sources || []).find((s: Any) => s.id === sourceId);
        if (d) d.file = meta;
      }),
    )
    .catch(() =>
      toast(
        'The issues were added, but the original file couldn’t be kept. You can attach it on the Source documents page.',
        'err',
      ),
    );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Added 3 issues (PAY-12–PAY-14) and 1 new epic to the backlog" */
function addedMessage(keys: string[], newEpicCount: number) {
  const range = `${keys[0]}${keys.length > 1 ? `–${keys[keys.length - 1]}` : ''}`;
  const epics = newEpicCount ? ` and ${plural(newEpicCount, 'new epic')}` : '';
  return `Added ${plural(keys.length, 'issue')} (${range})${epics} to the backlog`;
}

export function addWork(x: AddInput) {
  const newSourceId = uid();
  let created: Created = { keys: [], issueIds: [], epicIds: new Set() };
  mutate((pp) => {
    if (x.canEpic) addEpics(pp, x.newEpics);
    created = addIssues(pp, x);
    recordSource(pp, x, created, newSourceId);
  });
  const file = x.kind === 'document' && !x.sourceId ? x.source?.file : null;
  if (file) keepOriginalFile(x.projectId, file, newSourceId);
  toast(addedMessage(created.keys, x.canEpic ? x.newEpics.length : 0));
}
