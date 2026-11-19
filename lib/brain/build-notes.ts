import { safeName, FOLDER, tagsOf, clip, MAX_BODY, isSub, wl, related, catOf } from './safe-name';

/**
 * All generated notes of a project: [{ id, type, key, ref, title, status, tags, body, updated }].
 * `id` is the note's path in the vault without ".md"; its last part (the file name) is what
 * [[wikilinks]] point to, so it's unique.
 */
export function buildNotes(p) {
  const notes: any[] = [];
  const taken: Set<any> = new Set();
  const add = (n) => {
    let file = safeName(n.file),
      k = 2;
    while (taken.has(file.toLowerCase())) file = `${safeName(n.file)} ${k++}`;
    taken.add(file.toLowerCase());
    const id = FOLDER[n.type] ? `${FOLDER[n.type]}/${file}` : file;
    const note = {
      id,
      type: n.type,
      key: String(n.key || ''),
      ref: String(n.ref || ''),
      title: String(n.title || file).slice(0, 300),
      status: String(n.status || ''),
      tags: tagsOf([n.type, ...(n.tags || [])]),
      body: clip(n.body, MAX_BODY),
      updated: n.updated || p.updatedAt || null,
    };
    notes.push(note);
    return note;
  };
  const tickets = p.tickets || [];
  const epics = p.epics || [];
  const releases = p.releases || [];
  const top = tickets.filter((t) => !isSub(t));
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const byTitle = new Map(
    tickets.map((t) => [
      String(t.title || '')
        .trim()
        .toLowerCase(),
      t,
    ]),
  );
  const epicById = new Map(epics.map((e) => [e.id, e]));
  // Reserve the file names first, so links can be written before every note exists.
  const fileOf: Map<any, any> = new Map();
  const reserve = (kind, id, file) => fileOf.set(`${kind}:${id}`, file);
  const pKey = String(p.key || 'PRJ');
  reserve('p', 'overview', 'Project Overview');
  epics.forEach((e, i) => reserve('e', e.id, e.key || `${pKey}-E${i + 1}`));
  tickets.forEach((t) => reserve('t', t.id, t.key || `Issue ${t.id}`));
  releases.forEach((r) => reserve('r', r.id, `Release ${r.name}`));
  const link = (kind, id, label) => {
    const f = fileOf.get(`${kind}:${id}`);
    return f ? wl(safeName(f), label) : label || '';
  };
  const tLink = (t, withTitle = true) =>
    link('t', t.id, withTitle ? `${t.key || ''} ${t.title || ''}`.trim() : t.key);
  const eLink = (e) => link('e', e.id, `${e.key || ''} ${e.title || ''}`.trim());
  const rLink = (r) => link('r', r.id, r.name);
  const epicIssues = (e) => top.filter((t) => t.epicId === e.id);
  const questions = [];
  const latest = (list) =>
    list
      .map((t) => t.updatedAt)
      .filter(Boolean)
      .sort()
      .pop() || null;

  (p.openQuestions || []).forEach((text, i) => {
    const s = typeof text === 'string' ? text : text?.text || text?.question || '';
    if (s.trim())
      questions.push({
        file: `Question ${String(i + 1).padStart(2, '0')}`,
        key: `${pKey}-Q${i + 1}`,
        ref: `q:${i}`,
        title: clip(s, 140),
        text: s,
        status: 'Open',
      });
  });
  for (const x of questions) x.issues = related(x.text || x.title, top, 5);
  questions.forEach((x) => reserve('q', x.ref, x.file));
  const questionsOf = (t) => questions.filter((x) => x.issues.includes(t));
  const releasesOf = (t) =>
    (t.fixVersions || []).map((v) => releases.find((r) => r.id === v)).filter(Boolean);
  const list = (items) => items.map((x) => `- ${x}`).join('\n');

  // Index and overview
  const flagged = (arr, fn) => (arr.length ? list(arr.map(fn)) : '- (none)');
  const sources = [
    ...(p.sourceText
      ? [
          {
            id: 'original',
            name: p.sourceName || 'Initial document',
            text: p.sourceText,
            kind: 'requirements',
            addedAt: p.createdAt,
            epicIds: [],
            issueIds: [],
          },
        ]
      : []),
    ...(p.sources || []),
  ];
  sources.forEach((s) =>
    reserve(
      's',
      s.id,
      `Source ${String(s.name || 'document').replace(/\.(md|markdown|txt|pdf|docx?|html?)$/i, '')}`,
    ),
  );
  const ctxNote = p.appContext?.md ? 'App Context' : '';
  const repoNotes = [
    p.dev?.repoProfile?.markdown && ['Repository Profile', p.dev.repoProfile, 'frontend'],
    p.devBackend?.enabled &&
      p.devBackend?.repoProfile?.markdown && [
        'Backend Repository Profile',
        p.devBackend.repoProfile,
        'backend',
      ],
  ].filter(Boolean);
  add({
    type: 'index',
    file: 'Index',
    key: `${pKey}-INDEX`,
    ref: 'index',
    title: `${p.name} brain`,
    body: `# ${p.name} brain

The project's knowledge vault, kept up to date by TicketForge. Start at ${link('p', 'overview', 'Project Overview')}. Notes in *Notes/* are your own; TicketForge never changes them.

## Project
- ${link('p', 'overview', 'Project Overview')}${ctxNote ? `\n- [[App Context]]` : ''}${repoNotes.map(([f]) => `\n- [[${f}]]`).join('')}

## Epics
${flagged(epics, (e) => `${eLink(e)} (${epicIssues(e).length} issues)`)}

## Releases
${flagged(releases, (r) => `${rLink(r)} (${r.status || 'unreleased'})`)}

## Open questions
${flagged(questions, (x) => `${wl(safeName(x.file), x.title)}${x.status ? ` (${x.status})` : ''}`)}

## Source documents
${flagged(sources, (s) => link('s', s.id, s.name))}
${top.filter((t) => !epicById.has(t.epicId)).length ? `\n## Issues without an epic\n${list(top.filter((t) => !epicById.has(t.epicId)).map((t) => tLink(t)))}` : ''}`,
  });
  const done = top.filter((t) => catOf(p, t.status) === 'done').length;
  add({
    type: 'project',
    file: 'Project Overview',
    key: pKey,
    ref: 'overview',
    title: p.name,
    status: `${done}/${top.length} done`,
    tags: ['overview'],
    body: `# ${p.name}

- **Key**: ${pKey}
- **Issues**: ${top.length} (${done} done) in ${epics.length} epics
- **Workflow**: ${(p.workflow || []).map((w) => w.name).join(' → ') || 'To Do → In Progress → Done'}
${p.automation?.baseUrl ? `- **Application URL**: ${p.automation.baseUrl}\n` : ''}${p.dev?.repo ? `- **Repository**: ${p.dev.repo}\n` : ''}
## Summary
${String(p.summary || p.description || '').trim() || '(no summary yet)'}

## Assumptions
${(p.assumptions || []).length ? list(p.assumptions.map((a) => (typeof a === 'string' ? a : a?.text || ''))) : '- (none recorded)'}

## Open questions
${flagged(questions, (x) => wl(safeName(x.file), x.title))}

## Epics
${flagged(epics, (e) => eLink(e))}
${ctxNote || repoNotes.length ? `\n## How the app is built\n${ctxNote ? '- [[App Context]]: what the app is, its users, modules and rules\n' : ''}${repoNotes.map(([f]) => `- [[${f}]]: how the repository is built\n`).join('')}` : ''}
See also [[Index]].`,
  });
  if (ctxNote)
    add({
      type: 'context',
      file: 'App Context',
      key: `${pKey}-CONTEXT`,
      ref: 'appContext',
      title: 'App Context',
      tags: ['app-context'],
      updated: p.appContext.editedAt || p.appContext.at,
      body: `${String(p.appContext.md).trim()}\n\nBack to ${link('p', 'overview', 'Project Overview')}.`,
    });
  for (const [file, prof, side] of repoNotes)
    add({
      type: 'repo',
      file,
      key: `${pKey}-REPO${side === 'backend' ? '-BE' : ''}`,
      ref: `repo:${side}`,
      title: file,
      status: prof.commit ? `at ${String(prof.commit).slice(0, 10)}` : '',
      tags: ['repository', side],
      updated: prof.editedAt || prof.learnedAt,
      body: `${String(prof.markdown).trim()}\n\nLearned from the ${side} repository${prof.commit ? ` at ${prof.commit}` : ''} (Learn from repository). Back to ${link('p', 'overview', 'Project Overview')}.`,
    });

  // Epics
  for (const e of epics) {
    const items = epicIssues(e);
    const nDone = items.filter((t) => catOf(p, t.status) === 'done').length;
    const rels = releases.filter((r) => items.some((t) => (t.fixVersions || []).includes(r.id)));
    add({
      type: 'epic',
      file: fileOf.get(`e:${e.id}`),
      key: e.key,
      ref: e.id,
      title: e.title,
      status: !items.length
        ? 'Empty'
        : nDone === items.length
          ? 'Done'
          : nDone
            ? 'In progress'
            : 'To do',
      tags: [],
      updated: latest(items),
      body: `# ${e.key || ''} ${e.title}

${String(e.description || '').trim() || '(no description)'}

- **Progress**: ${nDone}/${items.length} issues done
- **Project**: ${link('p', 'overview', p.name)}
${rels.length ? `- **Releases**: ${rels.map(rLink).join(', ')}\n` : ''}
## Issues
${flagged(items, (t) => `${tLink(t)} · ${t.status || ''}${t.type ? ` · ${t.type}` : ''}`)}
`,
    });
  }

  // Issues
  for (const t of tickets) {
    const e = epicById.get(t.epicId);
    const parent = t.parentId && byId.get(t.parentId);
    const subs = tickets.filter((x) => x.parentId === t.id);
    const deps = (t.dependencies || []).map((d) => {
      const o =
        byTitle.get(String(d).trim().toLowerCase()) ||
        tickets.find(
          (x) => x.key && String(d).trim().toUpperCase() === String(x.key).toUpperCase(),
        );
      return o && o !== t ? tLink(o) : String(d);
    });
    const links = (t.links || [])
      .map((l) => {
        const o = byId.get(l.targetId);
        return o ? `${l.type} ${tLink(o)}` : null;
      })
      .filter(Boolean);
    const blockedBy = tickets.filter(
      (x) =>
        x !== t &&
        (x.dependencies || []).some(
          (d) => String(d).trim().toLowerCase() === String(t.title).trim().toLowerCase(),
        ),
    );
    const rels = releasesOf(t);
    const sprint = (p.sprints || []).find((s) => s.id === t.sprintId);
    const comments = (t.comments || [])
      .filter((c) => !c.system && String(c.text || '').trim())
      .slice(-5);
    const tcs = t.testCases || [];
    const qs = questionsOf(t);
    add({
      type: 'issue',
      file: fileOf.get(`t:${t.id}`),
      key: t.key,
      ref: t.id,
      title: t.title,
      status: t.status,
      updated: t.updatedAt,
      tags: [t.type, t.priority && `priority-${t.priority}`, t.layer, ...(t.labels || [])].filter(
        Boolean,
      ),
      body: `# ${t.key || ''} ${t.title}

- **Type**: ${t.type || 'Story'}${t.priority ? ` · **Priority**: ${t.priority}` : ''}${t.storyPoints ? ` · **Points**: ${t.storyPoints}` : ''}
- **Status**: ${t.status || ''}${t.assignee ? ` · **Assignee**: ${t.assignee}` : ''}
${e ? `- **Epic**: ${eLink(e)}\n` : ''}${parent ? `- **Parent**: ${tLink(parent)}\n` : ''}${sprint ? `- **Sprint**: ${sprint.name}\n` : ''}${rels.length ? `- **Fix versions**: ${rels.map(rLink).join(', ')}\n` : ''}${t.layer ? `- **Layer**: ${t.layer}\n` : ''}
${t.userStory ? `## User story\n${t.userStory}\n\n` : ''}${String(t.description || '').trim() ? `## Description\n${String(t.description).trim()}\n\n` : ''}${(t.acceptanceCriteria || []).length ? `## Acceptance criteria\n${t.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\n` : ''}${deps.length ? `## Depends on\n${list(deps)}\n\n` : ''}${blockedBy.length ? `## Needed by\n${list(blockedBy.map((x) => tLink(x)))}\n\n` : ''}${links.length ? `## Links\n${list(links)}\n\n` : ''}${subs.length ? `## Sub-tasks\n${list(subs.map((x) => `${tLink(x)} · ${x.status || ''}`))}\n\n` : ''}${qs.length ? `## Open questions\n${list(qs.map((x) => wl(safeName(x.file), x.title)))}\n\n` : ''}${tcs.length ? `## Test cases\n${list(tcs.slice(0, 30).map((c) => `${c.title}${c.status && c.status !== 'Not run' ? ` (${c.status})` : ''}`))}\n\n` : ''}${(t.prs || []).length ? `## Pull requests\n${list(t.prs.map((r) => `${r.title || r.url || 'PR'}${r.status ? ` (${r.status})` : ''}${r.url ? ` ${r.url}` : ''}`))}\n\n` : ''}${comments.length ? `## Recent comments\n${list(comments.map((c) => `${c.author || 'Someone'}: ${clip(String(c.text).replace(/\s+/g, ' '), 400)}`))}\n` : ''}`,
    });
  }

  // Releases
  for (const r of releases) {
    const items = top.filter((t) => (t.fixVersions || []).includes(r.id));
    const rEpics = [...new Set(items.map((t) => epicById.get(t.epicId)).filter(Boolean))];
    add({
      type: 'release',
      file: fileOf.get(`r:${r.id}`),
      key: r.name,
      ref: r.id,
      title: `Release ${r.name}`,
      status: r.status || 'unreleased',
      updated: r.releasedAt || r.createdAt,
      body: `# Release ${r.name}

- **Status**: ${r.status || 'unreleased'}${r.startDate ? ` · **Start**: ${String(r.startDate).slice(0, 10)}` : ''}${r.releaseDate ? ` · **Release date**: ${String(r.releaseDate).slice(0, 10)}` : ''}
${r.description ? `\n${r.description}\n` : ''}
## Epics
${flagged(rEpics, (e) => eLink(e))}

## Issues
${flagged(items, (t) => `${tLink(t)} · ${t.status || ''}`)}`,
    });
  }

  // Source documents
  for (const s of sources) {
    const sEpics = (s.epicIds || []).map((x) => epicById.get(x)).filter(Boolean);
    const sIssues = (s.issueIds || []).map((x) => byId.get(x)).filter(Boolean);
    add({
      type: 'source',
      file: fileOf.get(`s:${s.id}`),
      key: '',
      ref: `source:${s.id}`,
      title: s.name || 'Source document',
      status: s.kind || '',
      tags: [s.kind],
      updated: s.addedAt,
      body: `# ${s.name || 'Source document'}

${s.addedBy ? `Added by ${s.addedBy}. ` : ''}${sEpics.length ? `Epics from it: ${sEpics.map(eLink).join(', ')}. ` : ''}${
        sIssues.length
          ? `Issues from it: ${sIssues
              .slice(0, 40)
              .map((t) => tLink(t, false))
              .join(', ')}.`
          : ''
      }

## Text
${clip(s.text, 30000) || '(no text)'}`,
    });
  }

  // Open questions
  for (const x of questions)
    add({
      type: 'question',
      file: x.file,
      key: x.key,
      ref: x.ref,
      title: x.title,
      status: x.status,
      tags: ['open-question'],
      updated: x.updated,
      body: `# ${x.title}

${x.text && x.text !== x.title ? `${x.text}\n\n` : ''}- **Status**: ${x.status || 'Open'}
- **Project**: ${link('p', 'overview', p.name)}\n${x.issues.length ? `\n## Issues it may affect\n${list(x.issues.map((t) => tLink(t)))}` : ''}`,
    });
  return notes;
}
