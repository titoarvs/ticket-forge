// Page views (each returns HTML for the main column).
import { typeIcon, priorityIcon, I } from './icons.js';
import {
  S, P, esc, ago, fmtDate, TYPES, PRIORITIES, TC_TYPES, TC_STATUS, CATEGORIES, epic, sprint, isSub, childrenOf, epicTickets, noEpic,
  activeSprint, openSprints, tcKey, spSum, statusNames, catOf, isDone, sCls, tCls, avatar, eloz, statusLoz, opts, filtered,
  filtersActive, hashColor, COLORS, me, isBlocked, ticket, peopleNames,
} from './core.js';

export const VIEWS = { summary: 'Summary', backlog: 'Backlog', board: 'Board', epics: 'Epics', tests: 'Test cases', reports: 'Reports', automation: 'Test automation', source: 'Source document', settings: 'Project settings' };

export const header = (title, right = '', sub = '') => `
  <div class="crumbs"><a href="#/">Projects</a><span>/</span><a href="#/p/${esc(P().id)}/summary">${esc(P().name)}</a></div>
  <div class="page-h"><h1>${esc(title)}</h1>${sub}<div class="spacer"></div>${right}</div>`;

export function filterBar({ status = true, group = null } = {}) {
  const p = P();
  const f = S.filter;
  const people = peopleNames();
  return `<div class="toolbar">
    <div class="search"><span>${I.search}</span><input id="fq" placeholder="Search issues" value="${esc(f.q)}"></div>
    ${people.length ? `<div class="avatars" role="group" aria-label="Filter by assignee">${people.slice(0, 6).map((n) => `<button class="av-btn ${f.assignee === n ? 'on' : ''}" data-action="quick-assignee" data-name="${esc(n)}" title="${esc(n)}">${avatar(n, 28)}</button>`).join('')}</div>` : ''}
    <select class="select compact" id="fEpic" aria-label="Epic"><option value="">Epic</option>${p.epics.map((e) => `<option value="${esc(e.id)}" ${f.epic === e.id ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}<option value="none" ${f.epic === 'none' ? 'selected' : ''}>No epic</option></select>
    <select class="select compact" id="fType" aria-label="Type"><option value="">Type</option>${opts([...TYPES, 'Sub-task'], f.type)}</select>
    <select class="select compact" id="fPrio" aria-label="Priority"><option value="">Priority</option>${opts(PRIORITIES, f.priority)}</select>
    ${status ? `<select class="select compact" id="fStatus" aria-label="Status"><option value="">Status</option>${opts(statusNames(), f.status)}</select>` : ''}
    ${filtersActive() ? '<button class="btn subtle" data-action="clear-filters">Clear filters</button>' : ''}
    <div class="spacer"></div>
    ${group ? `<span class="muted small">Group by</span><select class="select compact" id="${group.id}">${group.options.map(([v, l]) => `<option value="${v}" ${group.value === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
  </div>`;
}

const listHtml = (l) => (l?.length ? `<ul class="plain-list">${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>');

export function epicProgress(e) {
  const ts = epicTickets(e.id);
  const c = (cat) => ts.filter((t) => catOf(t.status) === cat).length;
  return { ts, done: c('done'), prog: c('inprogress'), total: ts.length };
}
export function progBar({ done, prog, total }) {
  const w = (v) => `${total ? (v / total) * 100 : 0}%`;
  return `<div class="prog" title="${done} done · ${prog} in progress · ${total - done - prog} to do">${done ? `<i class="p-done" style="width:${w(done)}"></i>` : ''}${prog ? `<i class="p-prog" style="width:${w(prog)}"></i>` : ''}</div>`;
}
const tally = (items) => {
  const c = (cat) => items.filter((t) => catOf(t.status) === cat).length;
  return `<span class="tally" title="To do · In progress · Done"><span class="loz s-todo">${c('todo')}</span><span class="loz s-inprogress">${c('inprogress')}</span><span class="loz s-done">${c('done')}</span></span>`;
};
const daysLeft = (s) => {
  if (!s?.endDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(`${s.endDate}T00:00:00`);
  return Math.round((end - today) / 86400000);
};

// ---------------------------------------------------------------- summary
export function viewSummary() {
  const p = P();
  const ts = p.tickets.filter((t) => !isSub(t));
  const n = ts.length || 1;
  const by = (k, v) => ts.filter((t) => t[k] === v).length;
  const cat = (c) => ts.filter((t) => catOf(t.status) === c).length;
  const done = cat('done');
  const tcs = p.tickets.flatMap((t) => t.testCases);
  const tcBy = (s) => tcs.filter((x) => x.status === s).length;
  const doneSp = spSum(ts.filter(isDone));
  const act = activeSprint();
  const tile = (icon, value, label) => `<div class="tile"><span class="ic">${icon}</span><div><b>${value}</b><span>${label}</span></div></div>`;
  const stack = (parts, total) => `<div class="stack" role="img" aria-label="${parts.map(([l, v]) => `${l}: ${v}`).join(', ')}">${parts.filter(([, v]) => v).map(([l, v, c]) => `<i class="${c}" style="width:${(v / total) * 100}%" title="${esc(l)}: ${v} (${Math.round((v / total) * 100)}%)"></i>`).join('')}</div>
    <div class="legend">${parts.map(([l, v, c]) => `<span><i class="${c}"></i>${esc(l)} <b>${v}</b></span>`).join('')}</div>`;
  const maxP = Math.max(1, ...PRIORITIES.map((x) => by('priority', x)));
  const recent = p.tickets.flatMap((t) => t.history.map((h) => ({ ...h, t }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  return `${header('Summary')}
    <div class="tiles">
      ${tile(I.backlog, ts.length, `issues in ${p.epics.length} epics`)}
      ${tile(I.check, `${done} <span class="muted small">(${Math.round((done / n) * 100)}%)</span>`, 'issues done')}
      ${tile(I.calendar, act ? esc(act.name) : 'No active sprint', act ? `${Math.max(0, daysLeft(act) ?? 0)} days left · ${act.goal ? esc(act.goal) : 'no goal'}` : `${p.sprints.length} sprints planned`)}
      ${tile(I.test, `${tcBy('Pass')} / ${tcs.length}`, `tests passing · ${tcs.filter((x) => x.script).length} automated`)}
    </div>
    <div class="cards">
      <div class="card"><h3>Status overview</h3><p class="sub">Issues by workflow category · ${doneSp} of ${spSum(ts)} story points done.</p>
        ${ts.length ? stack([['To do', cat('todo'), 'c-todo'], ['In progress', cat('inprogress'), 'c-prog'], ['Done', done, 'c-done']], ts.length) : '<p class="muted">No issues yet.</p>'}</div>
      <div class="card"><h3>Test results</h3><p class="sub">Latest result of every test case (manual or automated).</p>
        ${tcs.length ? stack([['Not run', tcBy('Not run'), 'c-todo'], ['Pass', tcBy('Pass'), 'c-done'], ['Fail', tcBy('Fail'), 'c-fail'], ['Blocked', tcBy('Blocked'), 'c-blocked']], tcs.length) : '<p class="muted">No test cases yet.</p>'}</div>
      <div class="card"><h3>Priority breakdown</h3><p class="sub">How many issues sit at each priority.</p>
        ${PRIORITIES.map((x) => `<div class="barrow" title="${x}: ${by('priority', x)}"><span class="lbl">${priorityIcon(x)}${x}</span><div class="bar"><i style="width:${(by('priority', x) / maxP) * 100}%"></i></div><span class="num">${by('priority', x)}</span></div>`).join('')}</div>
      <div class="card"><h3>Recent activity</h3><p class="sub">Latest changes across the project.</p>
        ${recent.length ? recent.map((h) => `<div class="act-mini" data-action="open-issue" data-id="${esc(h.t.id)}">${avatar(h.author, 20)}<span><b>${esc(h.author)}</b> ${esc(historyText(h))} <span class="key">${esc(h.t.key)}</span> <span class="muted small">${ago(h.at)}</span></span></div>`).join('') : '<p class="muted">No activity yet.</p>'}</div>
      <div class="card wide"><h3>Epic progress</h3><p class="sub">Done and in-progress issues per epic.</p>
        ${p.epics.length ? `<table class="tbl"><tbody>${p.epics.map((e) => { const pr = epicProgress(e); return `<tr class="click" data-action="open-epic" data-id="${esc(e.id)}"><td style="width:40%">${eloz(e)}</td><td>${progBar(pr)}</td><td class="num muted" style="width:110px">${pr.done} of ${pr.total} done</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">No epics yet.</p>'}</div>
      <div class="card wide"><h3>About this project</h3><p class="sub">From the source document${p.sourceName ? ` · ${esc(p.sourceName)}` : ''} · <a href="#/p/${esc(p.id)}/settings">Edit</a></p>
        <p style="margin:0 0 16px;white-space:pre-wrap">${esc(p.summary) || '<span class="muted">No summary.</span>'}</p>
        <div class="grid2"><div><h3 style="font-size:14px">Assumptions</h3>${listHtml(p.assumptions)}</div><div><h3 style="font-size:14px">Open questions</h3>${listHtml(p.openQuestions)}</div></div></div>
    </div>`;
}

export function historyText(h) {
  if (h.text) return h.text;
  const label = { title: 'Summary', status: 'Status', priority: 'Priority', assignee: 'Assignee', reporter: 'Reporter', storyPoints: 'Story points', epicId: 'Epic', sprintId: 'Sprint', parentId: 'Parent', type: 'Issue type', labels: 'Labels', description: 'Description', userStory: 'User story', acceptanceCriteria: 'Acceptance criteria', testCases: 'Test cases', dependencies: 'Dependencies' }[h.field] || h.field;
  return h.from !== undefined ? `changed ${label}` : `updated ${label}`;
}

// ---------------------------------------------------------------- backlog
function backlogGroups() {
  const p = P();
  const list = filtered(p.tickets).filter((t) => !isSub(t) || S.filter.type === 'Sub-task');
  if (S.groupBy === 'status') return statusNames().map((s) => ({ id: `s:${s}`, kind: 'status', title: s, items: list.filter((t) => t.status === s) }));
  if (S.groupBy === 'none') return [{ id: 'all', kind: 'none', title: 'All issues', items: list }];
  if (S.groupBy === 'epic') {
    const groups = p.epics.map((e) => ({ id: `e:${e.id}`, kind: 'epic', epic: e, title: e.title, items: list.filter((t) => t.epicId === e.id) }));
    groups.push({ id: 'e:none', kind: 'epic', title: 'Issues without epic', items: list.filter((t) => !epic(t.epicId)) });
    return groups.filter((g) => g.items.length || (!filtersActive() && g.epic));
  }
  const sp = openSprints().sort((a, b) => (a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0));
  const inOpen = (t) => sp.some((s) => s.id === t.sprintId);
  const groups = sp.map((s) => ({ id: `sp:${s.id}`, kind: 'sprint', sprint: s, title: s.name, items: list.filter((t) => t.sprintId === s.id) }));
  groups.push({ id: 'sp:none', kind: 'sprint', title: 'Backlog', items: list.filter((t) => !inOpen(t) && !(sprint(t.sprintId)?.state === 'closed' && isDone(t))) });
  return groups;
}

export function issueRow(t, { showEpic = true, compact = false } = {}) {
  const e = epic(t.epicId);
  const kids = isSub(t) ? [] : childrenOf(t);
  const active = S.drawer?.kind === 'issue' && S.drawer.id === t.id;
  return `<div class="irow ${active ? 'active' : ''}" ${compact ? '' : 'draggable="true"'} data-ticket="${esc(t.id)}" data-action="open-issue" data-id="${esc(t.id)}">
    ${compact ? '' : `<input type="checkbox" class="cb" data-action="check" data-id="${esc(t.id)}" ${S.checked.has(t.id) ? 'checked' : ''} aria-label="Select ${esc(t.key)}">`}
    ${typeIcon(t.type)}<span class="key">${esc(t.key)}</span>
    <span class="sum" title="${esc(t.title)}">${esc(t.title)}</span>
    <span class="right">
      ${isBlocked(t) ? `<span class="flag" title="Blocked by an open issue">${I.flag}Blocked</span>` : ''}
      ${compact ? '' : `<span class="lbls">${t.labels.slice(0, 2).map((l) => `<span class="label-chip">${esc(l)}</span>`).join('')}</span>`}
      ${kids.length ? `<span class="mini" title="${kids.filter(isDone).length} of ${kids.length} sub-tasks done">${I.subtask}${kids.filter(isDone).length}/${kids.length}</span>` : ''}
      ${t.prs.length ? `<span class="mini" title="${t.prs.length} pull request(s)">${I.pr}${t.prs.length}</span>` : ''}
      ${showEpic && e ? eloz(e) : ''}
      ${statusLoz(t.status)}
      ${avatar(t.assignee)}
      <span class="sp" title="Story points">${t.storyPoints ?? '–'}</span>
      ${priorityIcon(t.priority)}
    </span></div>`;
}

export function viewBacklog() {
  const p = P();
  const groups = backlogGroups();
  const checked = [...S.checked].filter((id) => ticket(id));
  const act = activeSprint();
  const sectionHead = (g) => {
    const closed = S.collapsed.has(g.id);
    let title = `<b>${esc(g.title)}</b>`, actions = '', sub = '';
    if (g.kind === 'status') title = statusLoz(g.title);
    if (g.kind === 'epic' && g.epic) {
      title = `${typeIcon('Epic')}<span class="bar-swatch" style="background:${esc(g.epic.color)}"></span><b>${esc(g.title)}</b>`;
      actions = `<button class="btn sm subtle" data-action="open-epic" data-id="${esc(g.epic.id)}">Details</button>`;
    }
    if (g.kind === 'sprint' && g.sprint) {
      const s = g.sprint;
      title = `<b>${esc(s.name)}</b>${s.state === 'active' ? '<span class="loz s-inprogress">Active</span>' : ''}`;
      sub = `${s.startDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : '<a href="#" data-action="sprint-edit" data-id="' + esc(s.id) + '">Add dates</a>'} · `;
      actions = `${s.state === 'active' ? `<button class="btn sm" data-action="sprint-complete" data-id="${esc(s.id)}">Complete sprint</button>`
        : `<button class="btn sm ${act ? '' : 'primary'}" data-action="sprint-start" data-id="${esc(s.id)}" ${act ? 'disabled title="Complete the active sprint first"' : ''}>Start sprint</button>`}
        <button class="icon-btn" data-action="sprint-edit" data-id="${esc(s.id)}" title="Edit sprint" aria-label="Edit sprint">${I.pencil}</button>
        <button class="icon-btn" data-action="sprint-delete" data-id="${esc(s.id)}" title="Delete sprint" aria-label="Delete sprint">${I.trash}</button>`;
    }
    if (g.kind === 'sprint' && !g.sprint) actions = '<button class="btn sm" data-action="sprint-create">Create sprint</button>';
    return `<div class="sec-h ${closed ? 'closed' : ''}" data-action="toggle-sec" data-sec="${esc(g.id)}">
      ${I.chevron}${title}<span class="meta">${sub}${g.items.length} issue${g.items.length === 1 ? '' : 's'} · ${spSum(g.items)} pts</span>
      <span class="sec-actions">${tally(g.items)}${actions}</span></div>
      ${g.sprint?.goal && !closed ? `<div class="sprint-goal">${esc(g.sprint.goal)}</div>` : ''}`;
  };
  const section = (g) => {
    const closed = S.collapsed.has(g.id);
    return `<div class="section ${g.kind === 'sprint' && !g.sprint ? 'backlog-sec' : ''}" data-drop-group="${esc(g.id)}">
      ${sectionHead(g)}
      ${closed ? '' : `
        ${g.items.length ? `<div class="rows">${g.items.map((t) => issueRow(t, { showEpic: g.kind !== 'epic' })).join('')}</div>`
          : `<div class="drop-hint">${g.kind === 'sprint' && g.sprint ? 'Plan this sprint by dragging issues here from the backlog.' : 'No issues. Drag issues here or create one.'}</div>`}
        ${S.inlineCreate === g.id ? `<div class="inline-form"><select id="icType" aria-label="Issue type">${opts(TYPES, 'Story')}</select><input id="icInput" placeholder="What needs to be done?" autocomplete="off"><button class="btn sm primary" data-action="ic-submit">Create</button><button class="btn sm subtle" data-action="ic-cancel">Cancel</button></div>`
          : `<button class="inline-create" data-action="ic-open" data-sec="${esc(g.id)}">${I.plus}Create issue</button>`}`}
    </div>`;
  };
  return `${header('Backlog', `<button class="btn ai" data-action="ai-new">${I.sparkle}Write issue with Claude</button>`)}
    ${filterBar({ group: { id: 'fGroup', value: S.groupBy, options: [['sprint', 'Sprint'], ['epic', 'Epic'], ['status', 'Status'], ['none', 'None']] } })}
    ${checked.length ? `<div class="bulk">${checked.length} selected
      <select class="select compact" id="bulkSprint"><option value="">Move to sprint…</option>${openSprints().map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}<option value="__none">Backlog</option></select>
      <select class="select compact" id="bulkEpic"><option value="">Move to epic…</option>${p.epics.map((e) => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}<option value="__none">No epic</option></select>
      <select class="select compact" id="bulkStatus"><option value="">Set status…</option>${opts(statusNames(), '')}</select>
      <select class="select compact" id="bulkAssignee"><option value="">Assign to…</option>${peopleNames().map((n) => `<option>${esc(n)}</option>`).join('')}<option value="__none">Unassigned</option></select>
      <button class="btn sm ai" data-action="bulk-tests">${I.sparkle}Write test cases</button>
      <button class="btn sm" data-action="bulk-run">${I.play}Run tests</button>
      <button class="btn sm danger-subtle" data-action="bulk-delete">${I.trash}Delete</button>
      <div class="spacer"></div><button class="btn sm subtle" data-action="bulk-clear">Clear selection</button></div>` : ''}
    ${groups.length ? groups.map(section).join('') : '<div class="empty"><h3>No issues match</h3><p>Try clearing your filters.</p></div>'}
    ${S.groupBy === 'epic' && !filtersActive() ? `<button class="inline-create" data-action="add-epic">${I.plus}Create epic</button>` : ''}`;
}

// ---------------------------------------------------------------- board
export function viewBoard() {
  const p = P();
  const act = activeSprint();
  const useSprint = act && !S.boardAll;
  const statuses = statusNames();
  const scope = useSprint ? p.tickets.filter((t) => t.sprintId === act.id) : p.tickets;
  const list = filtered(scope);
  const card = (t, showEpic) => `<div class="bcard ${S.drawer?.id === t.id ? 'active' : ''}" draggable="true" data-ticket="${esc(t.id)}" data-action="open-issue" data-id="${esc(t.id)}">
    ${isSub(t) && ticket(t.parentId) ? `<div class="muted small">${typeIcon(ticket(t.parentId).type)} ${esc(ticket(t.parentId).key)} ${esc(ticket(t.parentId).title).slice(0, 40)}</div>` : ''}
    <div class="t">${esc(t.title)}</div>
    ${showEpic && epic(t.epicId) && !isSub(t) ? `<div>${eloz(epic(t.epicId))}</div>` : ''}
    <div class="foot">${typeIcon(t.type)}<span class="key">${esc(t.key)}</span>${isBlocked(t) ? `<span class="flag" title="Blocked">${I.flag}</span>` : ''}${t.prs.length ? `<span class="mini">${I.pr}${t.prs.length}</span>` : ''}<span class="right"><span class="sp">${t.storyPoints ?? '–'}</span>${priorityIcon(t.priority)}${avatar(t.assignee)}</span></div></div>`;
  const cols = (items, laneEpic, showEpic) => statuses.map((s) => {
    const cs = items.filter((t) => t.status === s);
    return `<div class="col" data-drop-status="${esc(s)}" ${laneEpic !== undefined ? `data-drop-epic="${esc(laneEpic ?? '')}"` : ''}>
      <div class="col-h"><span class="dot-cat ${sCls(s)}"></span>${esc(s)} <span class="muted">${cs.length}</span></div>${cs.map((t) => card(t, showEpic)).join('')}</div>`;
  }).join('');
  let body = '';
  if (S.boardGroup === 'epic') {
    const lanes = [...p.epics.map((e) => ({ e, items: list.filter((t) => t.epicId === e.id) })), { e: null, items: list.filter((t) => !epic(t.epicId)) }].filter((l) => l.items.length);
    body = lanes.map((l) => `<div class="lane-h">${l.e ? typeIcon('Epic') : ''}${esc(l.e?.title || 'Issues without epic')} <span class="muted small">${l.items.length} issues</span></div>${cols(l.items, l.e?.id || null, false)}`).join('');
  } else body = cols(list, undefined, true);
  const left = useSprint ? daysLeft(act) : null;
  const right = `${p.sprints.length ? `<select class="select compact" id="fBoardScope" aria-label="Board scope"><option value="sprint" ${!S.boardAll ? 'selected' : ''}>Active sprint</option><option value="all" ${S.boardAll ? 'selected' : ''}>All issues</option></select>` : ''}
    ${useSprint ? `<span class="muted small row" style="gap:4px">${I.clock}${left === null ? 'No end date' : left >= 0 ? `${left} days remaining` : `${-left} days overdue`}</span><button class="btn" data-action="sprint-complete" data-id="${esc(act.id)}">Complete sprint</button>` : ''}`;
  const noSprint = p.sprints.length && !act && !S.boardAll;
  return `${header(useSprint ? act.name : 'Board', right)}
    ${useSprint && act.goal ? `<p class="muted" style="margin:-8px 0 12px">${I.flag} ${esc(act.goal)}</p>` : ''}
    ${noSprint ? `<div class="empty"><div style="color:var(--brand)">${I.board.replace('width="16" height="16"', 'width="48" height="48"')}</div><h3>No active sprint</h3><p>Start a sprint from the backlog to see its issues here.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" data-action="view" data-view="backlog">Go to backlog</button><button class="btn" data-action="board-all">Show all issues</button></div></div>` : `
    ${filterBar({ status: false, group: { id: 'fBoardGroup', value: S.boardGroup, options: [['none', 'None'], ['epic', 'Epic']] } })}
    <div style="overflow-x:auto"><div class="board" style="grid-template-columns:repeat(${statuses.length}, minmax(220px, 1fr))">${body}</div></div>
    ${!list.length ? '<div class="empty"><h3>No issues to show</h3><p>Create issues in the backlog or clear your filters.</p></div>' : ''}`}`;
}

// ---------------------------------------------------------------- epics
export function viewEpics() {
  const p = P();
  return `${header('Epics', `<button class="btn ai" data-action="regroup">${I.sparkle}Re-organize with Claude</button><button class="btn primary" data-action="add-epic">${I.plus}Create epic</button>`)}
    ${p.epics.length ? `<table class="tbl"><thead><tr><th>Epic</th><th>Progress</th><th class="num">Done</th><th class="num">Issues</th><th class="num">Story points</th><th class="num">Test cases</th></tr></thead><tbody>
      ${p.epics.map((e) => {
        const pr = epicProgress(e);
        return `<tr class="click" data-action="open-epic" data-id="${esc(e.id)}">
          <td><span class="row" style="flex-wrap:nowrap">${typeIcon('Epic')}<span class="key">${esc(e.key)}</span><span class="bar-swatch" style="background:${esc(e.color)}"></span><b style="font-weight:500">${esc(e.title)}</b></span>
            ${e.description ? `<div class="muted small" style="margin:2px 0 0 24px;max-width:560px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.description)}</div>` : ''}</td>
          <td style="width:200px">${progBar(pr)}</td>
          <td class="num">${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%</td>
          <td class="num">${pr.total}</td><td class="num">${spSum(pr.ts)}</td><td class="num">${pr.ts.reduce((s, t) => s + t.testCases.length, 0)}</td></tr>`;
      }).join('')}</tbody></table>
      ${noEpic().length ? `<p class="muted small" style="margin-top:12px">${noEpic().length} issues have no epic. <a href="#" data-action="filter-noepic">View them in the backlog</a></p>` : ''}`
    : `<div class="empty"><div style="color:#904ee2">${I.epic.replace('width="16" height="16"', 'width="48" height="48"')}</div><h3>No epics yet</h3><p>Epics group related issues into larger pieces of work.</p><button class="btn primary" data-action="add-epic">Create epic</button></div>`}`;
}

// ---------------------------------------------------------------- test cases
export function testRows() {
  const p = P();
  const f = S.tcFilter;
  const qq = f.q.trim().toLowerCase();
  const rows = [];
  for (const t of p.tickets.filter((x) => !S.filter.epic || x.epicId === S.filter.epic)) {
    t.testCases.forEach((tc, i) => {
      if (f.status && tc.status !== f.status) return;
      if (f.type && tc.type !== f.type) return;
      if (qq && ![tc.title, tc.expected, tcKey(t, i), t.key, t.title].join(' ').toLowerCase().includes(qq)) return;
      rows.push({ t, tc, i });
    });
  }
  return rows;
}
const runLoz = (tc) => (tc.lastRun ? `<span class="loz ${tCls(tc.lastRun.status)}" title="Automated run ${ago(tc.lastRun.at)} · ${(tc.lastRun.durationMs / 1000).toFixed(1)}s">${I.bot} ${esc(tc.lastRun.status)}</span>` : '');

export function viewTests() {
  const p = P();
  const f = S.tcFilter;
  const rows = testRows();
  const all = p.tickets.flatMap((t) => t.testCases);
  const c = (s) => all.filter((x) => x.status === s).length;
  return `${header('Test cases', `<button class="btn" data-action="run-filtered" ${rows.length ? '' : 'disabled'}>${I.play}Run ${rows.length} automated</button>`)}
    <div class="tiles">
      <div class="tile"><span class="ic">${I.test}</span><div><b>${all.length}</b><span>test cases · ${all.filter((x) => x.script).length} automated</span></div></div>
      <div class="tile"><span class="ic" style="color:#22a06b">${I.check}</span><div><b>${c('Pass')}</b><span>passed</span></div></div>
      <div class="tile"><span class="ic" style="color:var(--danger)">${I.close}</span><div><b>${c('Fail')}</b><span>failed</span></div></div>
      <div class="tile"><span class="ic">${I.backlog}</span><div><b>${c('Not run') + c('Blocked')}</b><span>not run or blocked</span></div></div>
    </div>
    <div class="toolbar">
      <div class="search"><span>${I.search}</span><input id="tq" placeholder="Search test cases" value="${esc(f.q)}"></div>
      <select class="select compact" id="fEpic" aria-label="Epic"><option value="">Epic</option>${p.epics.map((e) => `<option value="${esc(e.id)}" ${S.filter.epic === e.id ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select>
      <select class="select compact" id="tStatus" aria-label="Result"><option value="">Result</option>${opts(TC_STATUS, f.status)}</select>
      <select class="select compact" id="tType" aria-label="Test type"><option value="">Test type</option>${opts(TC_TYPES, f.type)}</select>
      <div class="spacer"></div><span class="muted small">${rows.length} shown</span>
    </div>
    ${rows.length ? `<table class="tbl"><thead><tr><th>Key</th><th>Test case</th><th>Issue</th><th>Type</th><th>Covers</th><th>Automation</th><th>Result</th></tr></thead><tbody>
      ${rows.map(({ t, tc, i }) => `<tr class="click" data-action="open-test" data-id="${esc(t.id)}" data-tc="${esc(tc.id)}">
        <td class="key">${esc(tcKey(t, i))}</td><td>${esc(tc.title)}</td>
        <td><span class="row" style="flex-wrap:nowrap">${typeIcon(t.type)}<span class="key">${esc(t.key)}</span></span></td>
        <td class="muted">${esc(tc.type)}</td>
        <td class="muted">${(tc.acRef || []).map((n) => `AC${n}`).join(', ') || '–'}</td>
        <td>${runLoz(tc) || (tc.script ? `<span class="muted small">${I.bot} Script ready</span>` : '<span class="muted small">Manual</span>')}</td>
        <td><select class="tc-status loz ${tCls(tc.status)}" data-tcstatus="${esc(t.id)}:${esc(tc.id)}" aria-label="Result">${opts(TC_STATUS, tc.status)}</select></td></tr>`).join('')}
    </tbody></table>` : `<div class="empty"><h3>No test cases found</h3><p>${all.length ? 'Try changing the filters.' : 'Open an issue and use “Regenerate test cases”, or select issues in the backlog and choose “Write test cases”.'}</p></div>`}`;
}

// ---------------------------------------------------------------- reports
function velocityChart(sprints) {
  if (!sprints.length) return '<p class="muted">Complete a sprint to see velocity.</p>';
  const W = 640, H = 240, L = 40, B = 36, T = 12;
  const max = Math.max(1, ...sprints.flatMap((s) => [s.committedPoints || 0, s.completedPoints || 0]));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const gw = (W - L - 8) / sprints.length;
  const bw = Math.min(28, gw / 3);
  const grid = [0, 1, 2, 3, 4].map((i) => `<line x1="${L}" x2="${W - 4}" y1="${y(i * step)}" y2="${y(i * step)}" class="gridline"/><text x="${L - 6}" y="${y(i * step) + 4}" text-anchor="end" class="axis">${i * step}</text>`).join('');
  const bars = sprints.map((s, i) => {
    const cx = L + gw * i + gw / 2;
    const bar = (v, x, cls, label) => `<path d="M${x},${y(0)} V${y(v) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${y(0)} Z" class="${cls}"><title>${esc(s.name)} · ${label}: ${v} points</title></path>`;
    return `${bar(s.committedPoints || 0, cx - bw - 1, 'series-1', 'Commitment')}${bar(s.completedPoints || 0, cx + 1, 'series-2', 'Completed')}
      <rect x="${cx - bw - 4}" y="${T}" width="${bw * 2 + 8}" height="${H - T - B}" fill="transparent"><title>${esc(s.name)}: committed ${s.committedPoints || 0}, completed ${s.completedPoints || 0}</title></rect>
      <text x="${cx}" y="${H - B + 18}" text-anchor="middle" class="axis">${esc(s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Velocity: commitment versus completed story points per sprint">${grid}${bars}</svg>
    <div class="legend"><span><i class="series-1-bg"></i>Commitment</span><span><i class="series-2-bg"></i>Completed</span></div>`;
}

function burndown(s) {
  if (!s?.startDate || !s?.endDate) return '<p class="muted">Start a sprint with start and end dates to see its burndown.</p>';
  const issues = P().tickets.filter((t) => t.sprintId === s.id && !isSub(t));
  const total = s.committedPoints ?? spSum(issues);
  const doneAt = (t) => {
    if (!isDone(t)) return null;
    const h = [...t.history].reverse().find((x) => x.field === 'status' && catOf(x.to) === 'done');
    return Date.parse(h?.at || t.updatedAt);
  };
  const start = new Date(s.startDate); start.setHours(0, 0, 0, 0);
  const end = new Date(s.endDate); end.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.round((end - start) / 86400000));
  const stopAt = Math.min(Date.now(), s.completedAt ? Date.parse(s.completedAt) : Infinity);
  const pts = [];
  for (let d = 0; d <= days; d++) {
    const dayEnd = start.getTime() + (d + 1) * 86400000 - 1;
    if (start.getTime() + d * 86400000 > stopAt) break;
    pts.push({ d, v: total - spSum(issues.filter((t) => { const a = doneAt(t); return a && a <= dayEnd; })) });
  }
  const W = 640, H = 240, L = 40, B = 36, T = 12;
  const top = Math.max(4, Math.ceil(total / 4) * 4);
  const x = (d) => L + (W - L - 12) * (d / days);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const grid = [0, 1, 2, 3, 4].map((i) => `<line x1="${L}" x2="${W - 4}" y1="${y((top / 4) * i)}" y2="${y((top / 4) * i)}" class="gridline"/><text x="${L - 6}" y="${y((top / 4) * i) + 4}" text-anchor="end" class="axis">${(top / 4) * i}</text>`).join('');
  const ticks = Array.from({ length: days + 1 }, (_, d) => d).filter((d) => d === 0 || d === days || d % Math.ceil(days / 6) === 0)
    .map((d) => `<text x="${x(d)}" y="${H - B + 18}" text-anchor="middle" class="axis">${fmtDate(start.getTime() + d * 86400000)}</text>`).join('');
  const line = pts.map((p2, i) => `${i ? 'L' : 'M'}${x(p2.d)},${y(p2.v)}`).join(' ');
  const dots = pts.map((p2) => `<circle cx="${x(p2.d)}" cy="${y(p2.v)}" r="4" class="series-1 ring"><title>${fmtDate(start.getTime() + p2.d * 86400000)}: ${p2.v} points remaining</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Burndown for ${esc(s.name)}">${grid}${ticks}
      <line x1="${x(0)}" y1="${y(total)}" x2="${x(days)}" y2="${y(0)}" class="guide"/>
      <path d="${line}" class="series-1-line"/>${dots}</svg>
    <div class="legend"><span><i class="series-1-bg"></i>Remaining story points</span><span><i class="guide-key"></i>Guideline</span></div>`;
}

export function viewReports() {
  const p = P();
  const closed = p.sprints.filter((s) => s.state === 'closed').slice(-7);
  const target = activeSprint() || closed[closed.length - 1];
  const avg = closed.length ? Math.round(closed.reduce((s, x) => s + (x.completedPoints || 0), 0) / closed.length) : 0;
  return `${header('Reports')}
    <div class="cards">
      <div class="card wide"><h3>Velocity</h3><p class="sub">Story points committed at sprint start versus completed, for the last ${closed.length || 0} completed sprints${closed.length ? ` · average ${avg} points` : ''}.</p>${velocityChart(closed)}</div>
      <div class="card wide"><h3>Burndown${target ? ` · ${esc(target.name)}` : ''}</h3><p class="sub">Story points remaining each day of the sprint against an even guideline.</p>${burndown(target)}</div>
      <div class="card wide"><h3>Sprint report</h3><p class="sub">Every sprint in this project.</p>
        ${p.sprints.length ? `<table class="tbl"><thead><tr><th>Sprint</th><th>State</th><th>Dates</th><th class="num">Issues</th><th class="num">Committed</th><th class="num">Completed</th></tr></thead><tbody>
          ${p.sprints.map((s) => `<tr><td><b style="font-weight:500">${esc(s.name)}</b>${s.goal ? `<div class="muted small">${esc(s.goal)}</div>` : ''}</td><td><span class="loz ${s.state === 'active' ? 's-inprogress' : s.state === 'closed' ? 's-done' : 's-todo'}">${esc(s.state === 'future' ? 'Planned' : s.state)}</span></td>
            <td class="muted">${s.startDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : '–'}</td><td class="num">${p.tickets.filter((t) => t.sprintId === s.id && !isSub(t)).length}</td>
            <td class="num">${s.committedPoints ?? '–'}</td><td class="num">${s.completedPoints ?? '–'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sprints yet. Create one from the backlog.</p>'}</div>
    </div>`;
}

// ---------------------------------------------------------------- test automation
export function automationItems(scope) {
  const p = P();
  const act = activeSprint();
  const out = [];
  for (const t of p.tickets) {
    if (scope === 'sprint' && (!act || t.sprintId !== act.id)) continue;
    if (scope.startsWith('epic:') && t.epicId !== scope.slice(5)) continue;
    t.testCases.forEach((tc, i) => {
      if (scope === 'failed' && tc.lastRun?.status !== 'Fail') return;
      if (scope === 'notrun' && tc.lastRun) return;
      if (scope === 'automated' && !tc.script) return;
      out.push({ t, tc, i });
    });
  }
  return out;
}

export function viewAutomation() {
  const p = P();
  const eng = S.engine;
  const run = S.autoRun;
  const act = activeSprint();
  const items = automationItems(S.autoScope);
  const all = p.tickets.flatMap((t) => t.testCases);
  const ran = all.filter((x) => x.lastRun);
  const right = run?.running ? `<button class="btn danger" data-action="auto-stop">${I.stop}Stop</button>`
    : `<button class="btn primary" data-action="auto-run" ${items.length && eng?.browser ? '' : 'disabled'}>${I.play}Run ${items.length} test${items.length === 1 ? '' : 's'}</button>`;
  return `${header('Test automation', right)}
    <div class="tiles">
      <div class="tile"><span class="ic">${I.bot}</span><div><b>${all.filter((x) => x.script).length} / ${all.length}</b><span>test cases automated</span></div></div>
      <div class="tile"><span class="ic" style="color:#22a06b">${I.check}</span><div><b>${ran.filter((x) => x.lastRun.status === 'Pass').length}</b><span>passed last run</span></div></div>
      <div class="tile"><span class="ic" style="color:var(--danger)">${I.close}</span><div><b>${ran.filter((x) => x.lastRun.status === 'Fail').length}</b><span>failed last run</span></div></div>
      <div class="tile"><span class="ic">${I.clock}</span><div><b>${ran.length ? ago(ran.map((x) => x.lastRun.at).sort().pop()) : 'Never'}</b><span>last automated run</span></div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="grid2" style="align-items:end">
        <label class="field" style="margin:0"><span>Application URL — where the tests run</span><input class="input" data-bind="auto.baseUrl" value="${esc(p.automation.baseUrl || '')}" placeholder="e.g. http://localhost:3000 or https://staging.example.com"></label>
        <div class="small">${eng ? (eng.browser ? `<span class="row" style="gap:6px"><span class="dot ok"></span>Playwright ${esc(eng.version)} with Chromium is ready.</span>`
          : `<span class="row" style="gap:6px"><span class="dot bad"></span>${eng.installed ? 'Chromium is not installed yet.' : 'Playwright is not installed. Run <code>npm install</code>.'}</span>${eng.installed ? '<button class="btn sm" data-action="install-browser" style="margin-top:6px">Install Chromium</button>' : ''}`) : '<span class="muted">Checking test engine…</span>'}</div>
      </div>
      <p class="muted small" style="margin:12px 0 0">Claude writes a Playwright script for each test case from its steps, the issue's acceptance criteria and a snapshot of the page. Scripts run on this machine in a headless Chromium; you can read and edit every script. Results update each test case.</p>
    </div>
    <div class="toolbar">
      <span class="muted small">Run</span>
      <select class="select compact" id="arScope" aria-label="Which tests">
        <option value="all" ${S.autoScope === 'all' ? 'selected' : ''}>All test cases</option>
        <option value="automated" ${S.autoScope === 'automated' ? 'selected' : ''}>Tests with scripts</option>
        <option value="notrun" ${S.autoScope === 'notrun' ? 'selected' : ''}>Never run</option>
        <option value="failed" ${S.autoScope === 'failed' ? 'selected' : ''}>Failed last run</option>
        ${act ? `<option value="sprint" ${S.autoScope === 'sprint' ? 'selected' : ''}>Active sprint (${esc(act.name)})</option>` : ''}
        ${p.epics.map((e) => `<option value="epic:${esc(e.id)}" ${S.autoScope === `epic:${e.id}` ? 'selected' : ''}>Epic: ${esc(e.title)}</option>`).join('')}
      </select>
      <label class="check small"><input type="checkbox" class="cb" id="arRegen" ${S.autoRegen ? 'checked' : ''}> Rewrite existing scripts with Claude</label>
    </div>
    ${run ? `<div class="progress-box" style="margin:0 0 16px">${run.running ? '<div class="pbar"><i></i></div>' : ''}
      <div class="row small" style="margin-bottom:6px"><b>${run.running ? 'Running' : 'Finished'}</b><span class="muted">${run.done} of ${run.total} run · ${run.pass} passed · ${run.fail} failed</span></div>
      <ul class="log">${run.log.slice(-8).map((l) => `<li class="${l.level || ''}">${l.level === 'err' || l.level === 'warn' ? I.warn : l.level === 'pass' ? `<span class="ok">${I.check}</span>` : l.level === 'fail' ? `<span style="color:var(--danger)">${I.close}</span>` : l.level === 'info' || !run.running ? `<span class="muted">${I.check}</span>` : '<span class="spinner" style="color:var(--brand)"></span>'}<span>${esc(l.message)}</span></li>`).join('')}</ul></div>` : ''}
    ${items.length ? `<table class="tbl"><thead><tr><th>Key</th><th>Test case</th><th>Issue</th><th>Script</th><th>Last run</th><th class="num">Duration</th><th></th></tr></thead><tbody>
      ${items.map(({ t, tc, i }) => {
        const running = run?.running && run.current === tc.id;
        return `<tr class="click" data-action="open-test" data-id="${esc(t.id)}" data-tc="${esc(tc.id)}">
          <td class="key">${esc(tcKey(t, i))}</td><td>${esc(tc.title)}</td>
          <td><span class="row" style="flex-wrap:nowrap">${typeIcon(t.type)}<span class="key">${esc(t.key)}</span></span></td>
          <td>${tc.script ? `<button class="btn sm subtle" data-action="script-view" data-id="${esc(t.id)}" data-tc="${esc(tc.id)}">${I.bot}View</button>` : '<span class="muted small">Not written</span>'}</td>
          <td>${running ? '<span class="row small" style="gap:6px"><span class="spinner" style="color:var(--brand)"></span>Running</span>' : tc.lastRun ? `${runLoz(tc)} <span class="muted small">${ago(tc.lastRun.at)}</span>` : '<span class="muted small">Never</span>'}</td>
          <td class="num muted">${tc.lastRun ? `${(tc.lastRun.durationMs / 1000).toFixed(1)}s` : '–'}</td>
          <td style="text-align:right"><button class="icon-btn" data-action="run-tc" data-id="${esc(t.id)}" data-tc="${esc(tc.id)}" title="Run this test" ${run?.running ? 'disabled' : ''}>${I.play}</button></td></tr>
          ${tc.lastRun?.status === 'Fail' ? `<tr class="err-row"><td></td><td colspan="6"><div class="err-box">${esc(tc.lastRun.error.split('\n').slice(0, 4).join('\n'))}</div>${tc.lastRun.screenshot ? `<a href="${esc(tc.lastRun.screenshot)}" target="_blank" rel="noopener" class="small">${I.external} Screenshot</a>` : ''}</td></tr>` : ''}`;
      }).join('')}</tbody></table>` : '<div class="empty"><h3>No test cases in this selection</h3><p>Pick a different set above, or add test cases to your issues.</p></div>'}`;
}

// ---------------------------------------------------------------- source & settings
export function viewSource() {
  const p = P();
  return `${header('Source document')}
    ${p.sourceText ? `<p class="muted" style="margin-top:-8px">${I.doc} ${esc(p.sourceName)} · ${p.sourceText.split(/\s+/).length.toLocaleString()} words</p><div class="source">${esc(p.sourceText)}</div>`
      : '<div class="empty"><h3>No source document</h3><p>This project was created without a document.</p></div>'}`;
}

export function viewSettings() {
  const p = P();
  const counts = (name) => p.tickets.filter((t) => t.status === name).length;
  const assigned = (name) => p.tickets.filter((t) => t.assignee === name).length;
  return `${header('Project settings')}
    <div style="max-width:820px">
      <h2 class="set-h">Details</h2>
      <div class="grid2">
        <label class="field"><span>Name</span><input class="input" data-bind="p.name" value="${esc(p.name)}"></label>
        <label class="field"><span>Key — prefix for issue keys</span><input class="input" data-bind="p.key" data-type="key" value="${esc(p.key)}"></label>
      </div>
      <label class="field"><span>Summary</span><textarea class="textarea" data-bind="p.summary">${esc(p.summary)}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Assumptions — one per line</span><textarea class="textarea" data-bind="p.assumptions" data-type="lines">${esc((p.assumptions || []).join('\n'))}</textarea></label>
        <label class="field"><span>Open questions — one per line</span><textarea class="textarea" data-bind="p.openQuestions" data-type="lines">${esc((p.openQuestions || []).join('\n'))}</textarea></label>
      </div>

      <h2 class="set-h">${I.people} People</h2>
      <p class="muted small">Users with access to this project come from Administration (invites, roles and project access). You can also add people without an account so they can be assigned issues.</p>
      <table class="tbl"><thead><tr><th></th><th>Name</th><th>Email</th><th>Role</th><th class="num">Assigned</th><th></th></tr></thead><tbody>
        ${S.people.map((u) => `<tr><td style="width:36px">${avatar(u.name)}</td><td>${esc(u.name)}${u.id === S.user?.id ? ' <span class="muted small">(you)</span>' : ''}</td><td class="muted">${esc(u.email)}</td><td><span class="label-chip">${esc(u.role)}</span></td><td class="num">${assigned(u.name)}</td><td></td></tr>`).join('')}
        ${p.members.filter((m) => !S.people.some((u) => u.name === m.name)).map((m) => `<tr><td style="width:36px">${avatar(m.name)}</td>
          <td><input class="input" data-member="${esc(m.id)}" data-mf="name" value="${esc(m.name)}" aria-label="Name"></td>
          <td><input class="input" data-member="${esc(m.id)}" data-mf="email" value="${esc(m.email || '')}" placeholder="No account" aria-label="Email"></td>
          <td><input class="input" data-member="${esc(m.id)}" data-mf="role" value="${esc(m.role || '')}" placeholder="e.g. Contractor" aria-label="Role"></td>
          <td class="num">${assigned(m.name)}</td>
          <td style="text-align:right"><button class="icon-btn" data-action="member-del" data-id="${esc(m.id)}" title="Remove">${I.trash}</button></td></tr>`).join('')}
      </tbody></table>
      <div class="row" style="margin-top:4px"><button class="inline-create" data-action="member-add" style="width:auto">${I.plus}Add person without an account</button>
        ${S.user && (S.user.isOwner || S.user.permissions.includes('users.manage')) ? `<button class="btn sm" data-action="go" data-to="#/admin/invites">${I.people}Invite users</button>` : ''}</div>

      <h2 class="set-h">${I.board} Workflow</h2>
      <p class="muted small">The statuses issues move through, in board order. The category sets the colour and what counts as done for progress, sprints and reports.</p>
      <table class="tbl"><thead><tr><th>Status</th><th>Category</th><th class="num">Issues</th><th></th></tr></thead><tbody>
        ${p.workflow.map((w, i) => `<tr><td><input class="input" data-wf="${i}" data-wff="name" value="${esc(w.name)}" aria-label="Status name"></td>
          <td><select class="select" data-wf="${i}" data-wff="category" aria-label="Category">${CATEGORIES.map(([v, l]) => `<option value="${v}" ${w.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td class="num">${counts(w.name)}</td>
          <td style="text-align:right;white-space:nowrap"><button class="icon-btn" data-action="wf-move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Move up">${I.up}</button><button class="icon-btn" data-action="wf-move" data-i="${i}" data-d="1" ${i === p.workflow.length - 1 ? 'disabled' : ''} title="Move down">${I.down}</button><button class="icon-btn" data-action="wf-del" data-i="${i}" ${p.workflow.length < 2 ? 'disabled' : ''} title="Delete status">${I.trash}</button></td></tr>`).join('')}
      </tbody></table>
      <button class="inline-create" data-action="wf-add" style="width:auto">${I.plus}Add status</button>

      <div class="danger-zone"><h3 style="margin:0 0 4px;font-size:16px">Delete project</h3><p class="muted" style="margin:0 0 12px">Permanently removes this project and all of its epics, issues, sprints and test cases.</p>
        <button class="btn danger" data-action="delete-project" data-id="${esc(p.id)}">Delete project</button></div>
    </div>`;
}

export { hashColor, COLORS };
