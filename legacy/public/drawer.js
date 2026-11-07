// Issue and epic detail panels.
import { typeIcon, priorityIcon, I } from './icons.js';
import {
  S, P, esc, ago, TYPES, PRIORITIES, TC_TYPES, TC_STATUS, LINK_TYPES, COLORS, epic, sprint, ticket, isSub, childrenOf, openSprints,
  tcKey, spSum, statusNames, isDone, sCls, tCls, avatar, statusLoz, opts, me, catOf, peopleNames,
} from './core.js';
import { epicProgress, progBar, historyText } from './views.js';

function drawerHead(crumb, menuItems) {
  return `<div class="dr-head"><div class="dr-crumb">${crumb}</div><div class="spacer"></div>
    <div class="menu-wrap"><button class="icon-btn" data-action="menu" data-menu="drawer" title="More actions" aria-label="More actions">${I.more}</button>
      ${S.menu === 'drawer' ? `<div class="menu">${menuItems}</div>` : ''}</div>
    <button class="icon-btn" data-action="toggle-full" title="${S.full ? 'Collapse' : 'Expand'}" aria-label="${S.full ? 'Collapse' : 'Expand'}">${S.full ? I.collapse : I.expand}</button>
    <button class="icon-btn" data-action="close-drawer" title="Close (Esc)" aria-label="Close">${I.close}</button></div>`;
}
const crumbPart = (icon, key, action, id) => `<span class="row" style="gap:4px;flex-wrap:nowrap">${icon}${action ? `<a class="key link" data-action="${action}" data-id="${esc(id)}">${esc(key)}</a>` : `<span class="key">${esc(key)}</span>`}</span>`;
const prStatusCls = (s) => ({ Open: 'pr-open', Merged: 'pr-merged', Declined: 'pr-declined', Draft: 'pr-draft' }[s] || 'pr-open');

export function issueDrawer(t) {
  const p = P();
  const parent = isSub(t) ? ticket(t.parentId) : null;
  const e = epic((parent || t).epicId);
  const kids = isSub(t) ? [] : childrenOf(t);
  const uncovered = t.acceptanceCriteria.map((_, i) => i + 1).filter((n) => !t.testCases.some((tc) => (tc.acRef || []).includes(n)));
  const crumb = [
    e ? crumbPart(typeIcon('Epic'), e.key, 'open-epic', e.id) : '',
    parent ? crumbPart(typeIcon(parent.type), parent.key, 'open-issue', parent.id) : '',
    crumbPart(typeIcon(t.type), t.key),
  ].filter(Boolean).join('<span class="sep">/</span>');
  const menu = `<button data-action="dup-issue">${I.copy}Duplicate</button><button data-action="copy-key">${I.copy}Copy key</button>
    ${isSub(t) ? '' : `<button data-action="convert-sub">${I.subtask}Convert to sub-task…</button>`}<hr><button data-action="del-issue" style="color:var(--danger)">${I.trash}Delete</button>`;
  const sprints = p.sprints.filter((s) => s.state !== 'closed' || s.id === t.sprintId);
  const automated = t.testCases.filter((x) => x.script).length;
  const passing = t.testCases.filter((x) => x.status === 'Pass').length;
  const linkGroups = Object.keys(LINK_TYPES).map((type) => ({ type, items: t.links.filter((l) => l.type === type && ticket(l.targetId)) })).filter((g) => g.items.length);
  const others = p.tickets.filter((x) => x.id !== t.id);
  const comments = [...t.comments].sort((a, b) => b.at.localeCompare(a.at));
  const history = [...t.history].sort((a, b) => b.at.localeCompare(a.at));
  const activity = S.actTab === 'history' ? history.map((h) => ({ kind: 'h', at: h.at, h }))
    : S.actTab === 'all' ? [...comments.map((c) => ({ kind: 'c', at: c.at, c })), ...history.map((h) => ({ kind: 'h', at: h.at, h }))].sort((a, b) => b.at.localeCompare(a.at))
      : comments.map((c) => ({ kind: 'c', at: c.at, c }));

  return `${drawerHead(crumb, menu)}
  <div class="dr-scroll">
    <textarea class="summary-input" data-bind="t.title" rows="1" aria-label="Summary">${esc(t.title)}</textarea>
    <div class="dr-actions">
      <select class="status-select ${sCls(t.status)}" data-bind="t.status" aria-label="Status">${opts(statusNames(), t.status)}</select>
      <button class="btn ai" data-action="ai" data-op="enhance" title="Improve the whole issue">${I.sparkle}Enhance</button>
      <div class="menu-wrap"><button class="btn ai" data-action="menu" data-menu="ai">${I.sparkle}More Claude actions${I.chevron}</button>
        ${S.menu === 'ai' ? `<div class="menu left"><div class="mh">Claude</div>
          <button data-action="ai" data-op="ac">Improve acceptance criteria</button>
          <button data-action="ai" data-op="tests">Regenerate test cases</button>
          ${isSub(t) ? '' : '<button data-action="ai" data-op="split">Split into smaller issues</button>'}<hr>
          <button data-action="ai-ask">Ask Claude to change this issue…</button></div>` : ''}</div>
      ${t.testCases.length ? `<button class="btn" data-action="run-issue-tests" ${S.autoRun?.running ? 'disabled' : ''} title="Run this issue's test cases in a browser">${I.play}Run tests</button>` : ''}
    </div>
    <div class="dr-cols">
      <div class="dr-main">
        <div class="sec"><div class="sec-title"><h3>Description</h3></div>
          <textarea class="textarea ghost-area" data-bind="t.description" placeholder="Add a description…">${esc(t.description)}</textarea></div>
        <div class="sec"><div class="sec-title"><h3>User story</h3></div>
          <textarea class="textarea ghost-area" data-bind="t.userStory" placeholder="As a …, I want …, so that …">${esc(t.userStory)}</textarea></div>
        <div class="sec"><div class="sec-title"><h3>Acceptance criteria</h3><span class="count">${t.acceptanceCriteria.length}</span>
          <div class="tools"><button class="btn sm subtle" data-action="ac-add">${I.plus}Add</button><button class="btn sm subtle" data-action="ac-add-gwt">${I.plus}Given / When / Then</button></div></div>
          ${t.acceptanceCriteria.map((a, i) => `<div class="ac"><span class="ac-n">AC${i + 1}</span>
            <textarea class="textarea ghost-area" data-bind="ac.${i}" rows="1" style="min-height:32px">${esc(a)}</textarea>
            <span class="ops"><button class="icon-btn" data-action="ac-move" data-i="${i}" data-d="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>${I.up}</button><button class="icon-btn" data-action="ac-move" data-i="${i}" data-d="1" title="Move down" ${i === t.acceptanceCriteria.length - 1 ? 'disabled' : ''}>${I.down}</button><button class="icon-btn" data-action="ac-del" data-i="${i}" title="Remove">${I.trash}</button></span></div>`).join('') || '<p class="muted small">No acceptance criteria yet.</p>'}</div>

        ${isSub(t) ? '' : `<div class="sec"><div class="sec-title">${I.subtask}<h3>Child issues</h3><span class="count">${kids.length}</span>
          <div class="tools"><button class="btn sm subtle" data-action="sub-open">${I.plus}Add child issue</button></div></div>
          ${kids.length ? `<div class="row small muted" style="margin-bottom:6px;flex-wrap:nowrap">${progBar({ done: kids.filter(isDone).length, prog: kids.filter((k) => catOf(k.status) === 'inprogress').length, total: kids.length })}<span style="white-space:nowrap">${Math.round((kids.filter(isDone).length / kids.length) * 100)}% done</span></div>
            <div class="rows">${kids.map((k) => `<div class="irow" data-action="open-issue" data-id="${esc(k.id)}">${typeIcon(k.type)}<span class="key">${esc(k.key)}</span><span class="sum">${esc(k.title)}</span><span class="right">${avatar(k.assignee)}${statusLoz(k.status)}</span></div>`).join('')}</div>` : ''}
          ${S.subForm ? `<div class="inline-form"><span style="padding:0 4px">${typeIcon('Sub-task')}</span><input id="subInput" placeholder="What needs to be done?" autocomplete="off"><button class="btn sm primary" data-action="sub-submit">Create</button><button class="btn sm subtle" data-action="sub-cancel">Cancel</button></div>` : ''}
          ${!kids.length && !S.subForm ? '<p class="muted small">Break this issue into smaller pieces of work.</p>' : ''}</div>`}

        <div class="sec"><div class="sec-title">${I.link}<h3>Linked issues</h3><span class="count">${t.links.length}</span>
          <div class="tools"><button class="btn sm subtle" data-action="link-open">${I.plus}Link issue</button></div></div>
          ${linkGroups.map((g) => `<div class="link-type">${esc(g.type)}</div><div class="rows">${g.items.map((l) => { const o = ticket(l.targetId); return `<div class="irow" data-action="open-issue" data-id="${esc(o.id)}">${typeIcon(o.type)}<span class="key">${esc(o.key)}</span><span class="sum">${esc(o.title)}</span><span class="right">${statusLoz(o.status)}${priorityIcon(o.priority)}<button class="icon-btn" data-action="link-del" data-link="${esc(l.id)}" title="Remove link">${I.close}</button></span></div>`; }).join('')}</div>`).join('')}
          ${S.linkForm ? `<div class="inline-form" style="flex-wrap:wrap"><select id="lkType" aria-label="Link type">${Object.keys(LINK_TYPES).map((k) => `<option>${esc(k)}</option>`).join('')}</select>
            <select id="lkTarget" aria-label="Issue" style="flex:1;min-width:200px"><option value="">Choose an issue…</option>${others.map((o) => `<option value="${esc(o.id)}">${esc(o.key)} — ${esc(o.title.slice(0, 70))}</option>`).join('')}</select>
            <button class="btn sm primary" data-action="link-submit">Link</button><button class="btn sm subtle" data-action="link-cancel">Cancel</button></div>` : ''}
          ${!t.links.length && !S.linkForm ? '<p class="muted small">Show which issues block, duplicate or relate to this one.</p>' : ''}</div>

        <div class="sec"><div class="sec-title">${typeIcon('Test')}<h3>Test cases</h3><span class="count">${t.testCases.length}</span>
          <div class="tools"><button class="btn sm subtle" data-action="tc-add">${I.plus}Add</button><button class="btn sm subtle" data-action="tc-all" data-open="1">Expand all</button><button class="btn sm subtle" data-action="tc-all" data-open="0">Collapse all</button></div></div>
          ${uncovered.length && t.testCases.length ? `<div class="warn-banner">${I.warn}<span>Not covered by any test case: ${uncovered.map((n) => `AC${n}`).join(', ')}</span></div>` : ''}
          ${t.testCases.map((tc, i) => testCaseHtml(t, tc, i)).join('') || '<p class="muted small">No test cases yet. Use “Regenerate test cases” to let Claude write them.</p>'}</div>

        <div class="sec"><div class="sec-title">${I.pr}<h3>Development</h3><span class="count">${t.prs.length}</span>
          <div class="tools"><button class="btn sm subtle" data-action="pr-open">${I.plus}Link pull request</button></div></div>
          ${t.prs.map((r) => `<div class="pr-row">${I.pr}<div class="pr-main"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
            <div class="muted small">${esc(r.provider)} · ${esc(r.repo)}${r.number ? ` #${r.number}` : ''}${r.branch ? ` · ${esc(r.branch)} → ${esc(r.base || '')}` : ''}${r.author ? ` · ${esc(r.author)}` : ''}${r.checkedAt ? ` · checked ${ago(r.checkedAt)}` : ''}</div></div>
            <span class="loz ${prStatusCls(r.status)}">${esc(r.status)}</span>
            <button class="icon-btn" data-action="pr-refresh" data-pr="${esc(r.id)}" title="Refresh status">${I.refresh}</button>
            <button class="icon-btn" data-action="pr-del" data-pr="${esc(r.id)}" title="Unlink">${I.close}</button></div>`).join('')}
          ${S.prForm ? `<div class="inline-form"><input id="prUrl" placeholder="Paste a GitHub, GitLab or Bitbucket pull request URL" autocomplete="off"><button class="btn sm primary" data-action="pr-submit">Link</button><button class="btn sm subtle" data-action="pr-cancel">Cancel</button></div>` : ''}
          ${!t.prs.length && !S.prForm ? '<p class="muted small">Link the pull requests that implement this issue to track their status here.</p>' : ''}</div>

        <div class="sec"><div class="sec-title"><h3>Dependency notes</h3></div>
          <textarea class="textarea ghost-area" data-bind="t.dependencies" data-type="lines" placeholder="One per line">${esc(t.dependencies.join('\n'))}</textarea></div>

        <div class="sec"><div class="sec-title"><h3>Activity</h3></div>
          <div class="seg">${[['comments', 'Comments'], ['history', 'History'], ['all', 'All']].map(([v, l]) => `<button class="${S.actTab === v ? 'on' : ''}" data-action="act-tab" data-tab="${v}">${l}</button>`).join('')}</div>
          ${S.actTab !== 'history' ? `<div class="composer">${avatar(me(), 32)}<div style="flex:1"><textarea class="textarea" id="cmtText" placeholder="Add a comment…  (⌘↩ to save)" rows="2"></textarea>
            <div class="row" style="margin-top:6px"><button class="btn sm primary" data-action="cmt-save">Save</button><span class="muted small">Commenting as ${esc(me())}</span></div></div></div>` : ''}
          ${activity.map((a) => (a.kind === 'c' ? commentHtml(a.c) : `<div class="hist">${avatar(a.h.author, 24)}<div><b>${esc(a.h.author)}</b> ${esc(historyText(a.h))} <span class="muted small">${ago(a.h.at)}</span>
            ${a.h.from !== undefined ? `<div class="hist-change"><span>${esc(a.h.from)}</span> → <span>${esc(a.h.to)}</span></div>` : ''}</div></div>`)).join('') || `<p class="muted small">${S.actTab === 'history' ? 'No changes yet.' : 'No comments yet.'}</p>`}
        </div>
      </div>
      <div class="dr-side">
        <details class="details" ${S.detailsOpen ? 'open' : ''}><summary>Details ${I.chevron}</summary>
          <div class="dgrid">
            <span class="label">Assignee</span><div><span class="with-icon">${avatar(t.assignee)}<input class="input" data-bind="t.assignee" list="memberList" value="${esc(t.assignee || '')}" placeholder="Unassigned"></span>
              ${t.assignee !== me() ? '<a href="#" class="small" data-action="assign-me" style="margin-left:34px">Assign to me</a>' : ''}</div>
            <span class="label">Reporter</span><span class="with-icon">${avatar(t.reporter)}<input class="input" data-bind="t.reporter" list="memberList" value="${esc(t.reporter || '')}" placeholder="None"></span>
            <span class="label">Labels</span><input class="input" data-bind="t.labels" data-type="csv" value="${esc(t.labels.join(', '))}" placeholder="None">
            <span class="label">Priority</span><span class="with-icon">${priorityIcon(t.priority)}<select class="select" data-bind="t.priority">${opts(PRIORITIES, t.priority)}</select></span>
            <span class="label">Story points</span><input class="input" type="number" min="0" data-bind="t.storyPoints" data-type="number" value="${esc(t.storyPoints ?? '')}" placeholder="None">
            <span class="label">Sprint</span>${isSub(t) ? `<span class="muted" style="padding:6px 8px">${esc(sprint(t.sprintId)?.name || 'None')} <span class="small">(from parent)</span></span>` : `<select class="select" data-bind="t.sprintId"><option value="">None</option>${sprints.map((s) => `<option value="${esc(s.id)}" ${s.id === t.sprintId ? 'selected' : ''}>${esc(s.name)}${s.state === 'active' ? ' (active)' : s.state === 'closed' ? ' (closed)' : ''}</option>`).join('')}</select>`}
            ${isSub(t) ? `<span class="label">Parent</span><select class="select" data-bind="t.parentId">${p.tickets.filter((x) => !isSub(x)).map((x) => `<option value="${esc(x.id)}" ${x.id === t.parentId ? 'selected' : ''}>${esc(x.key)} — ${esc(x.title.slice(0, 40))}</option>`).join('')}</select>`
              : `<span class="label">Epic</span><span class="with-icon">${e ? `<span class="bar-swatch" style="background:${esc(e.color)};margin-left:4px"></span>` : ''}<select class="select" data-bind="t.epicId"><option value="">None</option>${p.epics.map((x) => `<option value="${esc(x.id)}" ${x.id === t.epicId ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></span>
              <span class="label">Issue type</span><span class="with-icon">${typeIcon(t.type)}<select class="select" data-bind="t.type">${opts(TYPES, t.type)}</select></span>`}
            <span class="label">Development</span><span class="dev-sum">${t.prs.length ? `${I.pr} ${t.prs.length} pull request${t.prs.length > 1 ? 's' : ''} ${[...new Set(t.prs.map((r) => r.status))].map((s2) => `<span class="loz ${prStatusCls(s2)}">${esc(s2)}</span>`).join(' ')}` : '<a href="#" data-action="pr-open" class="small">Link pull request</a>'}</span>
            <span class="label">Tests</span><span class="dev-sum">${t.testCases.length ? `${passing}/${t.testCases.length} passing · ${automated} automated` : '<span class="muted">None</span>'}</span>
          </div>
          <div class="dfoot muted small">Created ${ago(t.createdAt)} · Updated ${ago(t.updatedAt)}</div></details>
      </div>
    </div>
    <datalist id="memberList">${peopleNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
  </div>`;
}

function commentHtml(c) {
  const editing = S.cmtEdit === c.id;
  return `<div class="comment">${avatar(c.author, 32)}<div style="flex:1;min-width:0">
    <div><b>${esc(c.author)}</b> <span class="muted small">${ago(c.at)}${c.editedAt ? ' · edited' : ''}</span></div>
    ${editing ? `<textarea class="textarea" id="cmtEditText" rows="2">${esc(c.body)}</textarea><div class="row" style="margin-top:6px"><button class="btn sm primary" data-action="cmt-update" data-id="${esc(c.id)}">Save</button><button class="btn sm subtle" data-action="cmt-cancel">Cancel</button></div>`
      : `<div class="cbody">${esc(c.body)}</div>${(c.authorId ? c.authorId === S.user?.id : c.author === me()) ? `<div class="row small" style="gap:10px;margin-top:2px"><a href="#" data-action="cmt-edit" data-id="${esc(c.id)}">Edit</a><a href="#" data-action="cmt-del" data-id="${esc(c.id)}">Delete</a></div>` : ''}`}
  </div></div>`;
}

export function testCaseHtml(t, tc, i) {
  const open = S.openTc.has(tc.id);
  const running = S.autoRun?.running && S.autoRun.current === tc.id;
  const r = tc.lastRun;
  return `<div class="tc" id="tc-${esc(tc.id)}">
    <div class="tc-h ${open ? '' : 'closed'}" data-action="tc-toggle" data-id="${esc(tc.id)}">
      ${I.chevron}<span class="key">${esc(tcKey(t, i))}</span>
      <input class="input" data-bind="tc.${i}.title" value="${esc(tc.title)}" aria-label="Test case title">
      ${running ? '<span class="spinner" style="color:var(--brand)" title="Running"></span>' : tc.script ? `<span class="muted" title="Automated">${I.bot}</span>` : ''}
      <button class="icon-btn" data-action="run-tc" data-id="${esc(t.id)}" data-tc="${esc(tc.id)}" title="Run automated test" ${S.autoRun?.running ? 'disabled' : ''}>${I.play}</button>
      <select class="tc-status loz ${tCls(tc.status)}" data-bind="tc.${i}.status" aria-label="Result">${opts(TC_STATUS, tc.status)}</select>
    </div>
    ${open ? `<div class="tc-b">
      <div class="grid2" style="grid-template-columns:1fr 1fr 1fr">
        <label class="field"><span>Type</span><select class="select" data-bind="tc.${i}.type">${opts(TC_TYPES.includes(tc.type) ? TC_TYPES : [tc.type, ...TC_TYPES], tc.type)}</select></label>
        <label class="field"><span>Priority</span><select class="select" data-bind="tc.${i}.priority">${opts(['High', 'Medium', 'Low'], tc.priority)}</select></label>
        <label class="field"><span>Covers AC #</span><input class="input" data-bind="tc.${i}.acRef" data-type="nums" value="${esc((tc.acRef || []).join(', '))}" placeholder="e.g. 1, 3"></label>
      </div>
      <label class="field"><span>Preconditions</span><textarea class="textarea" data-bind="tc.${i}.preconditions" style="min-height:32px">${esc(tc.preconditions)}</textarea></label>
      <label class="field"><span>Steps — one per line</span><textarea class="textarea" data-bind="tc.${i}.steps" data-type="lines">${esc((tc.steps || []).join('\n'))}</textarea></label>
      <label class="field"><span>Expected result</span><textarea class="textarea" data-bind="tc.${i}.expected" style="min-height:32px">${esc(tc.expected)}</textarea></label>
      ${r ? `<div class="run-box ${tCls(r.status)}"><div class="row small"><span class="loz ${tCls(r.status)}">${I.bot} ${esc(r.status)}</span><span class="muted">Automated run ${ago(r.at)} · ${(r.durationMs / 1000).toFixed(1)}s</span>
          ${r.screenshot ? `<a href="${esc(r.screenshot)}" target="_blank" rel="noopener">${I.external} Screenshot</a>` : ''}</div>
          ${r.error ? `<pre class="err-box">${esc(r.error)}</pre>` : ''}
          ${r.logs?.length ? `<details><summary class="small muted">Browser console (${r.logs.length})</summary><pre class="code small">${esc(r.logs.join('\n'))}</pre></details>` : ''}</div>` : ''}
      <details class="script-box" ${tc.script ? '' : ''}><summary class="small">${I.bot} Automation script ${tc.script ? '' : '<span class="muted">(written by Claude on first run)</span>'}</summary>
        <textarea class="textarea code" data-bind="tc.${i}.script" spellcheck="false" placeholder="// Body of async ({ page, expect, baseURL }) => { … }">${esc(tc.script || '')}</textarea>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-action="run-tc" data-id="${esc(t.id)}" data-tc="${esc(tc.id)}" data-regen="1">${I.sparkle}Rewrite with Claude and run</button></div></details>
      <div class="row" style="justify-content:flex-end;margin:8px 0"><button class="btn sm subtle" data-action="tc-dup" data-i="${i}">${I.copy}Duplicate</button><button class="btn sm danger-subtle" data-action="tc-del" data-i="${i}">${I.trash}Remove</button></div>
    </div>` : ''}
  </div>`;
}

export function epicDrawer(e) {
  const pr = epicProgress(e);
  const crumb = crumbPart(typeIcon('Epic'), e.key);
  return `${drawerHead(crumb, `<button data-action="del-epic" style="color:var(--danger)">${I.trash}Delete epic</button>`)}
  <div class="dr-scroll">
    <textarea class="summary-input" data-bind="e.title" rows="1" aria-label="Epic name">${esc(e.title)}</textarea>
    <div class="dr-actions">
      <button class="btn" data-action="create" data-epic="${esc(e.id)}">${I.plus}Create issue</button>
      <button class="btn ai" data-action="ai-new" data-epic="${esc(e.id)}">${I.sparkle}Write issue with Claude</button>
    </div>
    <div class="sec"><div class="sec-title"><h3>Description</h3></div>
      <textarea class="textarea ghost-area" data-bind="e.description" placeholder="Describe the goal of this epic…">${esc(e.description)}</textarea></div>
    <div class="sec"><div class="sec-title"><h3>Colour</h3></div>
      <div class="row">${COLORS.map((c) => `<button class="icon-btn" data-action="epic-color" data-c="${c}" aria-label="Colour ${c}" style="width:24px;height:24px;border-radius:4px;background:${c};box-shadow:${c === e.color ? '0 0 0 2px var(--bg), 0 0 0 4px var(--border-focus)' : 'none'}"></button>`).join('')}</div></div>
    <div class="sec"><div class="sec-title"><h3>Progress</h3><span class="muted small" style="margin-left:auto">${pr.done} of ${pr.total} done · ${spSum(pr.ts)} story points</span></div>${progBar(pr)}</div>
    <div class="sec"><div class="sec-title"><h3>Child issues</h3><span class="count">${pr.total}</span></div>
      ${pr.total ? `<div class="rows">${pr.ts.map((t) => `<div class="irow" data-action="open-issue" data-id="${esc(t.id)}">${typeIcon(t.type)}<span class="key">${esc(t.key)}</span><span class="sum">${esc(t.title)}</span><span class="right">${avatar(t.assignee)}${statusLoz(t.status)}${priorityIcon(t.priority)}</span></div>`).join('')}</div>` : '<p class="muted small">No issues in this epic yet.</p>'}</div>
  </div>`;
}
