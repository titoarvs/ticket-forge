import { localReader } from '../codebase';
import { codeInventory } from '../codeinventory';
import { askJson } from '../claude';
import { getRules, getGuide } from '../genrules';
import { systemWith } from '../prompts';
import { readRepo, clip } from './test-case-updates';
import { featureDocs, pageCode } from './page-test-cases';

/**
 * Everything already built, organized by epic, FROM THE CODE: each page's headings, actions, fields
 * and API calls, the API endpoints and data models (also of the backend repository), then the git
 * history. Markdown documents (release notes, feature notes) only help name and group things: a
 * feature counts only when the code shows it, and every feature must cite code. Features that only
 * documents mention are returned apart ("unverified") and never added.
 * Pass 1 outlines epics and features, pass 2 writes each epic's features as small issues from their
 * pages' code.
 * Existing epics and issues are reused (matched). Returns { epics: [...], unverified: [...] } for
 * review; nothing is saved.
 */
export async function builtFeatureMap({
  project,
  dir,
  backendDir = '',
  ai = {},
  emit = (_m) => {},
}: any) {
  const repo = await readRepo(dir, project.automation?.repoSync?.sha || null);
  const reader = localReader(dir);
  const files = await reader.list();
  emit(
    `Reading the code: ${repo.pages.length} pages${backendDir ? ', the endpoints and models of both repositories' : ', the endpoints and data models'}…`,
  );
  const inv = await codeInventory({ root: repo.root, pages: repo.pages, backendDir });
  emit(
    `Found ${inv.counts.pages} pages, ${inv.counts.endpoints} endpoints and ${inv.counts.models} data models${inv.counts.backendError ? ` (backend repository not read: ${inv.counts.backendError})` : ''}. Reading the history and documents as hints…`,
  );
  const docs = await featureDocs(repo.root, files, 20000);
  const rules = await getRules();
  const system = systemWith(rules, ['tickets'], await getGuide());
  const pagesText = inv.pagesText;
  const docsText = docs.map((d) => `### ${d.file}\n${clip(d.text, 1500)}`).join('\n\n');
  const history = repo.log
    .filter((c) => !/^merge branch|^wip\b|^chore|bump|^format/i.test(c.subject))
    .map(
      (c) =>
        `${c.sha} ${c.date} ${c.subject}${c.body && c.body !== c.subject ? ` — ${c.body}` : ''}`,
    )
    .join('\n');
  const backlog = project.tickets
    .filter((t) => !t.parentId)
    .map(
      (t) =>
        `${t.key} [${t.status}]${t.epicId ? ` (${project.epics.find((e) => e.id === t.epicId)?.key || ''})` : ''} ${t.title}`,
    )
    .join('\n');
  const epicsText = project.epics
    .map((e) => `${e.key} ${e.title}${e.description ? ` — ${clip(e.description, 160)}` : ''}`)
    .join('\n');

  // Pass 1: the outline.
  emit('AI is grouping what’s built into epics and features…');
  const outline = await askJson({
    ...ai,
    task: 'repo',
    reasoning: rules.reasoning,
    system,
    prompt: `Map everything this app ALREADY does, FROM ITS CODE.

APP: ${project.name} — repository ${repo.root} (branch ${repo.branch})

=== THE CODE (the source of truth) ===
PAGES — route (name) [files], then what the page's code shows: headings, actions (buttons, links, tabs), form fields,
links & API calls and permission checks:
${clip(pagesText, 55000)}

${clip(inv.endpointsText, 30000) || 'No API endpoints found in the code.'}

${clip(inv.modelsText, 6000) || 'No data models found in the code.'}

=== HINTS ONLY (never proof that something is built) ===
GIT HISTORY (newest first; merged work names features, but the code decides):
${clip(history, 12000)}

MARKDOWN DOCUMENTS (release notes, feature notes; use them ONLY to name and group what the code shows — they may describe
plans, old behaviour or other repositories):
${clip(docsText, 20000) || '(none)'}

EXISTING EPICS:
${epicsText || '(none)'}

EXISTING BACKLOG (key [status] (epic) title):
${clip(backlog, 15000) || '(empty)'}

Group the delivered functionality into EPICS and, inside each, FEATURES. Rules for epics:
- Epics are BROAD product areas (e.g. "Access & Security", "People & Employment", "Leave & Time Off", "Compensation",
  "Performance Reviews", "Platform & Settings"), usually 4–10 for a whole app. An epic holds at least 3 features.
- Never make an epic for a single feature, a single fix or a single page: put it in the closest broad area.
FEATURES are user-facing capabilities (they will be split into small tickets later). Rules:
- Reuse an existing epic when it fits (give its key); otherwise propose a new epic with a short title and one-sentence description.
- A feature already in the backlog: give its key in "existingKey" (it will be marked done if it isn't). Don't duplicate it.
- A feature counts ONLY when the CODE above implements it: a page with its actions and fields, an endpoint, a data model.
  A release note, feature note or commit message alone is NOT enough. When documents and code disagree, the code wins:
  describe the feature as the code has it.
- Describe features by what the code shows (the page's headings, buttons, fields, the endpoints it calls), not by the
  documents' wording.
- Skip chores, refactors and pure styling. Security fixes and hardening count when the code shows the behaviour.
- "code": REQUIRED, the code that proves it: page routes exactly as listed, endpoints ("POST /api/…") and/or file paths.
- "pages": the page routes it lives on. "hints": document files or commit shas that helped name it (optional).
- Things the documents describe that you could NOT find in the code go in "notInCode" (title and the document), never in features.
Return JSON: { "epics": [ { "existingKey": "T2-E1" | null, "title": "…", "description": "…", "features": [ { "title": "…", "existingKey": "T2-12" | null, "pages": ["/path"], "code": ["/path", "POST /api/x", "src/features/x/Form.tsx"], "hints": ["docs/…md", "a1b2c3d"] } ] } ],
  "notInCode": [ { "title": "…", "source": "docs/…md" } ] }`,
  });
  const epicByKey = new Map(project.epics.map((e) => [e.key, e]));
  const ticketByKey = new Map(project.tickets.map((t) => [t.key, t]));
  const doneNames = new Set(
    project.workflow?.length
      ? project.workflow.filter((w) => w.category === 'done').map((w) => w.name)
      : ['Done'],
  ); // no saved workflow: the default one
  let epics = (outline.epics || [])
    .filter((e) => e?.title && Array.isArray(e.features) && e.features.length)
    .slice(0, 25);
  // Every feature must cite code that exists: features backed only by documents or commits are set
  // apart, not added.
  const unverified = (outline.notInCode || [])
    .filter((x) => x?.title)
    .map((x) => ({
      title: clip(x.title, 200),
      source: clip(x.source || '', 200),
      why: 'Described in the documents, not found in the code',
    }));
  for (const e of epics) {
    e.features = e.features.filter((f) => {
      const code = [...(f.code || []), ...(f.pages || [])].map(String);
      f.code = code.filter(inv.isCode);
      f.sources = [...new Set([...f.code, ...(f.hints || []).map(String)])];
      if (f.code.length) return true;
      unverified.push({
        title: clip(f.title, 200),
        source: (f.hints || f.sources || []).join(', ').slice(0, 200),
        why: code.length
          ? `Its code references weren’t found in the repository (${clip(code.join(', '), 120)})`
          : 'No code cited',
      });
      return false;
    });
  }
  epics = epics.filter((e) => e.features.length);
  if (unverified.length)
    emit(
      `${unverified.length} item${unverified.length > 1 ? 's' : ''} only the documents mention: set aside, not added.`,
    );
  // Small epics (one or two features) fold into the closest broad area, so the backlog isn't a long
  // list of tiny epics.
  const tiny = epics.filter((e) => e.features.length < 2);
  if (tiny.length && epics.length > 3) {
    emit(`Folding ${tiny.length} small epic${tiny.length > 1 ? 's' : ''} into broader ones…`);
    try {
      const fold = await askJson({
        ...ai,
        task: 'quick',
        reasoning: 'fast',
        system,
        prompt: `These epics are too small to stand alone. For each, pick the best broader epic to move its features into.

SMALL EPICS:
${tiny.map((e) => `- "${e.title}": ${e.features.map((f) => f.title).join('; ')}`).join('\n')}

BROADER EPICS (choose one of these titles exactly):
${epics
  .filter((e) => !tiny.includes(e))
  .map((e) => `- "${e.title}"${e.description ? `: ${clip(e.description, 140)}` : ''}`)
  .join('\n')}

Return JSON: { "moves": [ { "from": "small epic title", "to": "broader epic title" } ] }`,
      });
      const byTitle = new Map(epics.map((e) => [e.title, e]));
      for (const m of fold.moves || []) {
        const from: any = byTitle.get(String(m.from)),
          to: any = byTitle.get(String(m.to));
        if (from && to && from !== to && tiny.includes(from)) {
          to.features.push(...from.features);
          from.features = [];
        }
      }
      epics = epics.filter((e) => e.features.length);
    } catch {
      /* keep them as they are */
    }
  }

  // Pass 2: small tickets, per epic (in parallel), from the documents and pages behind each
  // feature.
  const scale = rules.tickets?.pointScale?.length ? rules.tickets.pointScale : [1, 2, 3, 5, 8, 13];
  const maxPts = Math.min(5, rules.tickets?.maxPoints || 5);
  const small = scale.filter((x) => x <= Math.min(3, maxPts));
  const acRange = rules.tickets?.acMin
    ? `${rules.tickets.acMin}–${rules.tickets.acMax || rules.tickets.acMin}`
    : '2–4';
  const acMax = rules.tickets?.acMax || 5;
  let done = 0;
  const detailed = new Array(epics.length);
  const queue = epics.map((e, i) => ({ e, i }));
  const docByFile = new Map(docs.map((d) => [d.file, d.text]));
  const worker = async () => {
    while (queue.length) {
      if (ai.signal?.aborted) return;
      const { e, i } = queue.shift();
      emit(`Writing the features of “${e.title}”… ${done}/${epics.length}`);
      const feats = e.features.slice(0, 30);
      // Evidence: the code of the features' pages first (their real labels, fields, rules), then
      // their endpoints; documents last, as hints.
      const pagesOf = [
        ...new Set(feats.flatMap((f) => [...(f.pages || []), ...(f.code || [])]).map(String)),
      ];
      let codeText = '';
      for (const pg of repo.pages.filter((x) => pagesOf.includes(x.path)).slice(0, 6)) {
        if (codeText.length > 36000) break;
        const c = await pageCode(repo.root, pg, Math.min(12000, 40000 - codeText.length));
        codeText += `\n### Page ${pg.path}${c.code}`;
      }
      const epLines = inv.endpointsText
        .split('\n')
        .filter(
          (l) =>
            pagesOf.some((x: any) => (x.includes(' ') ? l.includes(x.split(' ')[1]) : false)) ||
            feats.some((f) =>
              (f.code || []).some((c) =>
                l.includes(String(c).replace(/^(GET|POST|PUT|PATCH|DELETE|ANY)\s+/i, '')),
              ),
            ),
        );
      const evidence = [...new Set(feats.flatMap((f) => f.hints || []))]
        .filter((s) => docByFile.has(s))
        .map((s) => `### ${s}\n${clip(docByFile.get(s), 2500)}`)
        .join('\n\n');
      let res: any = {};
      try {
        res = await askJson({
          ...ai,
          task: 'repo',
          reasoning: rules.reasoning,
          system,
          prompt: `Write these ALREADY DELIVERED features of "${project.name}" as SMALL backlog tickets (they will be marked done).

EPIC: ${e.title}${e.description ? ` — ${e.description}` : ''}

FEATURES:
${feats.map((f, n) => `${n + 1}. ${f.title}${f.existingKey ? ` (existing issue ${f.existingKey}: keep it as ONE ticket, don't split)` : ''} — pages: ${(f.pages || []).join(', ') || 'n/a'}; code: ${(f.code || []).join(', ') || 'n/a'}`).join('\n')}

THE CODE BEHIND THEM (the source of truth):
${clip(codeText, 40000) || '(no page code: use the endpoints)'}
${epLines.length ? `\nENDPOINTS THEY USE:\n${clip(epLines.join('\n'), 6000)}` : ''}

DOCUMENTS (hints for naming only; never describe behaviour the code above doesn't show):
${clip(evidence, 8000) || '(none)'}

Split each feature into small tickets: one independently testable behaviour each (e.g. "Create an evaluation template",
"Assign a template to a team", "Archive a template"), ${small.join(', ')} story points (${maxPts} at most). A feature that is
already that small stays one ticket. Don't make tickets for trivia (a label, one field) — fold those into the ticket they belong to.
Each ticket: a user story, a short description of what exists now, ${acRange} acceptance criteria for the delivered behaviour.
Write the acceptance criteria from the CODE: its real labels, fields, validation rules, permissions, messages and API calls.
Never take behaviour from the documents that the code doesn't show, and never invent behaviour.
Return JSON: { "tickets": [ { "feature": 1, "title": "…", "type": "Story|Task|Bug", "storyPoints": 2, "userStory": "…", "description": "…", "acceptanceCriteria": ["…"] } ] }`,
        });
      } catch (err) {
        res = { error: err.message };
      }
      const ex: any = e.existingKey && epicByKey.get(String(e.existingKey));
      detailed[i] = {
        epicId: ex?.id || null,
        epicKey: ex?.key || null,
        title: ex ? ex.title : clip(e.title, 120),
        description: clip(e.description || '', 400),
        isNew: !ex,
        error: res.error || null,
        // One entry per small ticket; `group` is the feature it came from. Existing issues stay one
        // ticket each.
        features: feats.flatMap((f, n) => {
          const t: any = f.existingKey ? ticketByKey.get(String(f.existingKey)) : null;
          const base = {
            group: clip(f.title, 200),
            pages: (f.pages || []).map(String).slice(0, 8),
            sources: (f.sources || []).map(String).slice(0, 10),
          };
          const mine = (res.tickets || []).filter((x) => Number(x.feature) === n + 1 && x?.title);
          const pts = (v) => {
            const x = Number(v);
            return Number.isFinite(x) && x > 0
              ? scale.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b), scale[0])
              : null;
          };
          const one = (d, title) => ({
            ...base,
            title: clip(title, 200),
            type: ['Story', 'Task', 'Bug'].includes(d.type) ? d.type : 'Story',
            storyPoints: pts(d.storyPoints),
            userStory: clip(d.userStory || '', 600),
            description: clip(d.description || '', 1500),
            acceptanceCriteria: (Array.isArray(d.acceptanceCriteria) ? d.acceptanceCriteria : [])
              .map((a) => clip(a, 400))
              .slice(0, acMax),
          });
          if (t)
            return [
              {
                ...one(mine[0] || {}, t.title),
                existingId: t.id,
                existingKey: t.key,
                existingStatus: t.status,
                alreadyDone: doneNames.has(t.status),
                existingEpicId: t.epicId || null,
                storyPoints: t.storyPoints ?? pts(mine[0]?.storyPoints),
              },
            ];
          if (!mine.length)
            return [
              {
                ...one({}, f.title),
                existingId: null,
                existingKey: null,
                existingStatus: null,
                alreadyDone: false,
                existingEpicId: null,
              },
            ];
          return mine.slice(0, 8).map((d) => ({
            ...one(d, d.title),
            existingId: null,
            existingKey: null,
            existingStatus: null,
            alreadyDone: false,
            existingEpicId: null,
          }));
        }),
      };
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, epics.length) }, worker));
  return {
    repo: { root: repo.root, branch: repo.branch, head: repo.head },
    pages: repo.pages.length,
    docs: docs.map((d) => d.file),
    commits: repo.log.length,
    code: inv.counts,
    basis: 'code',
    epics: detailed.filter(Boolean),
    unverified: unverified.slice(0, 60),
  };
}
