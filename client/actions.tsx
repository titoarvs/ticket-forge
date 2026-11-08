'use client';
// Actions (Claude, automation, pull requests, sprints, exports) and the dialogs that go with them.
import { useState, type ReactNode } from 'react';
import {
  S, emit, api, aiBody, readNdjson, toast, withBusy, setBusy, openModal, closeModal, mutate, saveNow, store, pullRemote, loadNotifs,
  P, ticket, epic, isSub, childrenOf, epicTickets, activeSprint, openSprints, tcKey, spSum, isDone, me, can, peopleNames,
  uid, clone, nowIso, dateInput, COLORS, TYPES, PRIORITIES, nextTicketKey, nextEpicKey, newTicket, withIds, applyAi,
  addMember, logEvent, setField, addLink, deleteIssues, type Any,
} from './core';
import { Modal, Confirm, Ico, I, TypeIcon, PriorityIcon, AutoTextarea } from './ui';
import { TF, TA, SF, CB, RB, DateF, PeopleF, MenuItem, opts } from './fields';

export const findTc = (tid: string, tcid: string) => { const t = ticket(tid); return { t, tc: t?.testCases.find((x: Any) => x.id === tcid) }; };
export const openDrawer = (kind: 'issue' | 'epic', id: string) => {
  Object.assign(S, { drawer: { kind, id }, menu: null, subForm: false, linkForm: false, prForm: false, cmtEdit: null });
  emit();
};

export async function loadEngine() {
  try { S.engine = await api('/api/automation/status'); } catch { S.engine = { installed: false, browser: false }; }
  emit();
}
export async function logout() {
  if (P()) await saveNow();
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  Object.assign(S, { user: null, project: null, drawer: null, menu: null, people: [] });
  emit();
  S.nav('/login');
}

export async function exportAs(fmt: string) {
  await saveNow();
  try {
    const res = await api(`/api/export/${fmt}`, { method: 'POST', body: P(), raw: true });
    const blob = await res.blob();
    const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `export.${fmt}`;
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link); link.click(); link.parentNode?.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Downloaded ${name}`);
  } catch (e: Any) { toast(`Export failed: ${e.message}`, 'err'); }
}

// ---------------------------------------------------------------- issues
export function moveTicket(id: string, zone: { group?: string; status?: string; epic?: string | null }, beforeId?: string) {
  if (!id) return;
  mutate((p) => {
    const t = p.tickets.find((x: Any) => x.id === id);
    const g = zone.group;
    if (g?.startsWith('e:')) setField(t, 'epicId', g === 'e:none' ? null : g.slice(2));
    if (g?.startsWith('s:')) setField(t, 'status', g.slice(2));
    if (g?.startsWith('sp:')) setField(t, 'sprintId', g === 'sp:none' ? null : g.slice(3));
    if (zone.status) setField(t, 'status', zone.status);
    if (zone.epic !== undefined && !isSub(t)) setField(t, 'epicId', zone.epic || null);
    if (beforeId && beforeId !== id) {
      const before = p.tickets.find((x: Any) => x.id === beforeId);
      p.tickets.splice(p.tickets.indexOf(t), 1);
      p.tickets.splice(p.tickets.indexOf(before), 0, t);
    }
  });
}
export function inlineCreate(group: string, title: string, type: string) {
  if (!title.trim()) return;
  const fields: Any = { title: title.trim(), type };
  if (group.startsWith('e:')) fields.epicId = group === 'e:none' ? null : group.slice(2);
  if (group.startsWith('s:')) fields.status = group.slice(2);
  if (group.startsWith('sp:')) fields.sprintId = group === 'sp:none' ? null : group.slice(3);
  if (S.filter.epic && S.filter.epic !== 'none' && !fields.epicId) fields.epicId = S.filter.epic;
  const nt = newTicket(fields);
  mutate((p) => p.tickets.push(nt));
  toast(`Created ${nt.key}`);
}
export function createSubtask(t: Any, title: string) {
  if (!title.trim()) return;
  const st = newTicket({ title: title.trim(), type: 'Sub-task', parentId: t.id, epicId: t.epicId, sprintId: t.sprintId, priority: t.priority });
  mutate((p) => { p.tickets.push(st); logEvent(t, `added sub-task ${st.key}`); });
  toast(`Created ${st.key}`);
}
export function duplicateIssue(t: Any) {
  const d = newTicket({ ...clone(t), id: uid(), key: nextTicketKey(), title: `${t.title} (copy)`, comments: [], history: [], links: [], prs: [], createdAt: nowIso(), reporter: me() });
  d.testCases.forEach((tc: Any) => { tc.id = uid(); tc.lastRun = null; });
  mutate((p) => p.tickets.splice(p.tickets.indexOf(t) + 1, 0, d));
  openDrawer('issue', d.id); toast(`Created ${d.key}`);
}
export function confirmDeleteIssue(t: Any) {
  const n = childrenOf(t).length;
  openModal(<Confirm title={`Delete ${t.key}?`} label="Delete" text={<>“{t.title}”{n ? ` and its ${n} sub-tasks` : ''} will be deleted. You can undo with ⌘Z.</>}
    onYes={() => { mutate(() => deleteIssues([t.id])); S.drawer = null; emit(); toast(`Deleted ${t.key}`); }} />);
}
export function addEpic() {
  const ne = { id: uid(), key: nextEpicKey(), title: 'New epic', description: '', color: COLORS[P().epics.length % COLORS.length] };
  mutate((p) => p.epics.push(ne));
  openDrawer('epic', ne.id);
}
export function delEpic(ep: Any, withIssues: boolean) {
  mutate((p) => {
    if (withIssues) deleteIssues(p.tickets.filter((x: Any) => x.epicId === ep.id).map((x: Any) => x.id));
    else p.tickets.forEach((x: Any) => { if (x.epicId === ep.id) setField(x, 'epicId', null); });
    p.epics = p.epics.filter((x: Any) => x.id !== ep.id);
  });
  S.drawer = null; closeModal(); toast(`Deleted ${ep.key}`);
}
export function DeleteEpicModal({ ep }: { ep: Any }) {
  const n = epicTickets(ep.id).length;
  return (
    <Modal title={`Delete ${ep.key}?`} actions={[{ label: 'Cancel' },
      ...(n ? [{ label: 'Delete epic and its issues', onClick: () => delEpic(ep, true) }] : []),
      { label: n ? 'Delete epic, keep issues' : 'Delete', kind: 'danger' as const, onClick: () => delEpic(ep, false) }]}>
      <p>Delete the epic “{ep.title}”?{n ? ` It has ${n} child issues.` : ''}</p>
    </Modal>
  );
}
export function ConvertSubModal({ t }: { t: Any }) {
  const parents = P().tickets.filter((x: Any) => !isSub(x) && x.id !== t.id);
  const [pid, setPid] = useState(parents[0]?.id || '');
  return (
    <Modal title={`Convert ${t.key} to a sub-task`} actions={[{ label: 'Cancel' }, { label: 'Convert', kind: 'primary', onClick: () => {
      const par = ticket(pid);
      if (!par) return;
      mutate(() => { setField(t, 'type', 'Sub-task'); setField(t, 'parentId', par.id); t.epicId = par.epicId; t.sprintId = par.sprintId; logEvent(par, `added sub-task ${t.key}`); });
      closeModal(); toast(`${t.key} is now a sub-task of ${par.key}`);
    } }]}>
      <label className="field"><span>Parent issue</span>
        <SF value={pid} onChange={(e) => setPid(e.target.value)}>{parents.map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.key} — {x.title.slice(0, 60)}</MenuItem>)}</SF></label>
    </Modal>
  );
}
export function convertToSubtask(t: Any) {
  if (childrenOf(t).length) return toast('Issues with sub-tasks can’t become sub-tasks.', 'err');
  openModal(<ConvertSubModal t={t} />);
}

// ---------------------------------------------------------------- create issue
export function CreateIssueModal({ epicId = '' }: { epicId?: string }) {
  const p = P();
  const [f, setF] = useState({ type: 'Story', title: '', description: '', epicId, sprintId: '', priority: 'Medium', storyPoints: '', assignee: '', another: false });
  const set = (k: string) => (e: Any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const isEpic = f.type === 'Epic';
  const create = () => {
    if (!f.title.trim()) return;
    let created: Any;
    if (isEpic) {
      created = { id: uid(), key: nextEpicKey(), title: f.title.trim(), description: f.description.trim(), color: COLORS[P().epics.length % COLORS.length] };
      mutate((pp) => pp.epics.push(created));
    } else {
      created = newTicket({ title: f.title.trim(), type: f.type, description: f.description.trim(), epicId: f.epicId || null, sprintId: f.sprintId || null, priority: f.priority, storyPoints: f.storyPoints === '' ? null : Number(f.storyPoints), assignee: f.assignee.trim() });
      mutate((pp) => { pp.tickets.push(created); addMember(f.assignee); });
    }
    toast(`Created ${created.key}`);
    if (f.another) { setF({ ...f, title: '', description: '' }); return; }
    closeModal();
    openDrawer(isEpic ? 'epic' : 'issue', created.id);
  };
  const withClaude = () => {
    const idea = [f.title.trim(), f.description.trim()].filter(Boolean).join('\n');
    if (!idea) return toast('Write a summary or description for Claude to work from.', 'err');
    closeModal();
    writeWithClaude({ idea, fields: { epicId: f.epicId || null, sprintId: f.sprintId || null, assignee: f.assignee.trim() }, type: f.type === 'Story' ? null : f.type });
  };
  return (
    <Modal title="Create issue" left={<label className="check small"><CB checked={f.another} onChange={set('another')} /> Create another</label>}
      actions={[{ label: 'Cancel' }, { label: '✨ Write with Claude', kind: 'ai', onClick: withClaude, hidden: isEpic || !can('ai.use') }, { label: 'Create', kind: 'primary', onClick: create, disabled: !f.title.trim() }]}>
      <p className="muted small" style={{ marginTop: 0 }}>Required fields are marked with an asterisk <span style={{ color: 'var(--danger)' }}>*</span></p>
      <div className="grid2">
        <label className="field"><span>Project</span><TF value={`${p.name} (${p.key})`} disabled /></label>
        <label className="field"><span>Issue type <span className="req">*</span></span><SF value={f.type} onChange={set('type')}>{opts([...TYPES, ...(can('epic.manage') ? ['Epic'] : [])])}</SF></label>
      </div>
      <label className="field"><span>Summary <span className="req">*</span></span><TF autoFocus value={f.title} onChange={set('title')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} /></label>
      <label className="field"><span>Description</span><TA value={f.description} onChange={set('description')} placeholder="Describe the work. Claude can turn this into a full issue with acceptance criteria and test cases." /></label>
      {!isEpic && <div className="grid2">
        <label className="field"><span>Epic</span><SF value={f.epicId} onChange={set('epicId')}><MenuItem value="">None</MenuItem>{p.epics.map((e: Any) => <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>)}</SF></label>
        <label className="field"><span>Sprint</span><SF value={f.sprintId} onChange={set('sprintId')}><MenuItem value="">Backlog</MenuItem>{openSprints().map((s: Any) => <MenuItem key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</MenuItem>)}</SF></label>
        <label className="field"><span>Priority</span><SF value={f.priority} onChange={set('priority')}>{opts(PRIORITIES)}</SF></label>
        <label className="field"><span>Story points</span><TF type="number" min={0} value={f.storyPoints} onChange={set('storyPoints')} /></label>
        <label className="field"><span>Assignee</span><PeopleF placeholder="Unassigned" value={f.assignee} onChange={(v) => setF({ ...f, assignee: v })} options={peopleNames()} /></label>
        <label className="field"><span>Reporter</span><TF value={me()} disabled /></label>
      </div>}
    </Modal>
  );
}
export function openCreateIssue(epicId?: string) {
  if (!P() || !can('issue.create')) return;
  const cur = epicId || (S.drawer?.kind === 'epic' ? S.drawer.id : '') || (S.filter.epic && S.filter.epic !== 'none' ? S.filter.epic : '') || '';
  openModal(<CreateIssueModal epicId={cur} />);
}

export async function writeWithClaude({ idea, fields = {}, type }: { idea: string; fields?: Any; type?: string | null }) {
  const res = await withBusy('Claude is writing the issue…', () => api('/api/ai/new-ticket', { method: 'POST', body: aiBody({ epicId: fields.epicId, idea, project: P() }) }));
  if (!res) return;
  const nt = applyAi(newTicket({ ...fields }), res.ticket);
  if (type) nt.type = type;
  mutate((p) => { p.tickets.push(nt); addMember(fields.assignee); });
  openDrawer('issue', nt.id);
  toast(`Claude created ${nt.key}`);
}
export function NewWithClaudeModal({ epicId = '' }: { epicId?: string }) {
  const p = P();
  const [ep, setEp] = useState(epicId || p.epics[0]?.id || '');
  const [idea, setIdea] = useState('');
  return (
    <Modal title="Write an issue with Claude" actions={[{ label: 'Cancel' }, { label: '✨ Write issue', kind: 'primary', disabled: !idea.trim(), onClick: () => { closeModal(); writeWithClaude({ idea: idea.trim(), fields: { epicId: ep || null } }); } }]}>
      <label className="field"><span>Epic</span><SF value={ep} onChange={(e) => setEp(e.target.value)}><MenuItem value="">None</MenuItem>{p.epics.map((e: Any) => <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>)}</SF></label>
      <label className="field"><span>What should the issue cover?</span><TA autoFocus style={{ minHeight: 100 }} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. Customers can export their order history as a PDF" /></label>
      <p className="muted small">Claude writes the summary, user story, description, acceptance criteria and test cases.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- Claude on an issue
const AI_LABEL: Record<string, string> = { enhance: 'Claude is enhancing the issue…', ac: 'Claude is improving acceptance criteria…', tests: 'Claude is writing test cases…', split: 'Claude is splitting the issue…', custom: 'Claude is applying your instruction…' };
const AI_DONE: Record<string, string> = { enhance: 'enhanced the issue with Claude', ac: 'improved acceptance criteria with Claude', tests: 'regenerated test cases with Claude', custom: 'updated the issue with Claude' };

export async function runTicketAi(t: Any, op: string, instruction?: string) {
  const res = await withBusy(AI_LABEL[op], () => api('/api/ai/ticket', { method: 'POST', body: aiBody({ action: op, ticket: { ...t, history: [], comments: [] }, project: P(), instruction }) }));
  if (!res) return;
  if (op === 'split') {
    if (!res.tickets?.length) return toast('Claude did not return any issues.', 'err');
    openModal(<ReviewSplit orig={t} parts={res.tickets} />);
    return;
  }
  openModal(<ReviewTicket before={t} after={applyAi(t, res.ticket)} op={op} />);
}

function TicketSummary({ t, other }: { t: Any; other?: Any }) {
  const oldAc = new Set(other?.acceptanceCriteria || []);
  return (
    <>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}><TypeIcon type={t.type} /><PriorityIcon p={t.priority} /><span className="sp">{t.storyPoints ?? '–'}</span>{t.labels?.map((l: string) => <span key={l} className="label-chip">{l}</span>)}</div>
      <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t.title}</p>
      {t.userStory && <p style={{ margin: '0 0 8px', fontStyle: 'italic', color: 'var(--text-subtle)' }}>{t.userStory}</p>}
      <h5>Acceptance criteria ({t.acceptanceCriteria.length})</h5>
      <ol className="small">{t.acceptanceCriteria.map((a: string, i: number) => <li key={i} className={other && !oldAc.has(a) ? 'new' : ''}>{a}</li>)}</ol>
      <h5>Test cases ({(t.testCases || []).length})</h5>
      <ol className="small">{(t.testCases || []).map((tc: Any, i: number) => <li key={i}>{tc.title}</li>)}</ol>
    </>
  );
}
function ReviewTicket({ before, after, op }: { before: Any; after: Any; op: string }) {
  return (
    <Modal title="Review Claude’s suggestion" wide actions={[{ label: 'Discard' }, { label: 'Accept changes', kind: 'primary', onClick: () => {
      mutate((p) => { const i = p.tickets.findIndex((x: Any) => x.id === before.id); p.tickets[i] = after; logEvent(after, AI_DONE[op] || 'updated the issue with Claude'); });
      closeModal(); toast('Changes applied');
    } }]}>
      <div className="cmp"><div><h5>Current</h5><TicketSummary t={before} /></div><div><h5>Suggested</h5><TicketSummary t={after} other={before} /></div></div>
      <p className="small muted" style={{ margin: '12px 0 0' }}>Highlighted criteria are new or reworded. You can keep editing after accepting, and ⌘Z undoes it.</p>
    </Modal>
  );
}
function ReviewSplit({ orig, parts }: { orig: Any; parts: Any[] }) {
  return (
    <Modal title={`Split ${orig.key} into ${parts.length} issues`} wide actions={[{ label: 'Discard' }, { label: 'Replace with these issues', kind: 'primary', onClick: () => {
      mutate((p) => {
        const i = p.tickets.findIndex((x: Any) => x.id === orig.id);
        const first = applyAi(orig, parts[0]);
        logEvent(first, `split into ${parts.length} issues with Claude`);
        p.tickets.splice(i, 1, first);
        parts.slice(1).forEach((pt, k) => {
          const r = applyAi(newTicket({ epicId: orig.epicId, sprintId: orig.sprintId, assignee: orig.assignee }), pt);
          p.tickets.splice(i + 1 + k, 0, r);
          addLink(first, 'relates to', r);
        });
      });
      closeModal(); toast(`Split into ${parts.length} issues`);
    } }]}>
      {parts.map((t, i) => <div key={i} className="card" style={{ marginBottom: 12, padding: 14 }}><TicketSummary t={t} /></div>)}
    </Modal>
  );
}
const ASK_SUGGESTIONS = ['Add security and permission criteria', 'Add accessibility (WCAG) criteria', 'Add performance criteria', 'Make it more technical for developers', 'Rewrite in plain language for stakeholders', 'Add API contract details', 'Re-estimate the story points'];
export function AskModal({ t }: { t: Any }) {
  const [v, setV] = useState('');
  return (
    <Modal title="Ask Claude to change this issue" actions={[{ label: 'Cancel' }, { label: '✨ Apply', kind: 'primary', disabled: !v.trim(), onClick: () => { closeModal(); runTicketAi(t, 'custom', v.trim()); } }]}>
      <label className="field"><span>Instruction</span><TA autoFocus style={{ minHeight: 96 }} value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Add criteria for offline mode and a test case for slow networks" /></label>
      <div className="row">{ASK_SUGGESTIONS.map((s) => <button key={s} className="btn sm" onClick={() => setV(s)}>{s}</button>)}</div>
    </Modal>
  );
}
export function RegroupModal() {
  const [v, setV] = useState('');
  return (
    <Modal title="Re-organize issues into epics" actions={[{ label: 'Cancel' }, { label: '✨ Propose epics', kind: 'primary', onClick: async () => {
      closeModal();
      const proj = { ...P(), tickets: P().tickets.filter((x: Any) => !isSub(x)) };
      const res = await withBusy('Claude is re-organizing epics…', () => api('/api/ai/regroup', { method: 'POST', body: aiBody({ project: proj, instruction: v.trim() }) }));
      if (res) openModal(<ReviewRegroup proposed={res.epics} />);
    } }]}>
      <p style={{ marginTop: 0 }}>Claude proposes a new set of epics and assigns every issue to one. You review the result before anything changes.</p>
      <label className="field"><span>Guidance (optional)</span><TA value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Group by user journey: onboarding, browsing, checkout, admin" /></label>
    </Modal>
  );
}
function ReviewRegroup({ proposed }: { proposed: Any[] }) {
  return (
    <Modal title={`Proposed epics (${proposed.length})`} wide actions={[{ label: 'Discard' }, { label: 'Apply new epics', kind: 'primary', onClick: () => {
      mutate((pp) => {
        const byTitle = new Map(pp.epics.map((e: Any) => [e.title.toLowerCase(), e]));
        const next = proposed.map((pe, i) => {
          const old: Any = byTitle.get(pe.title.toLowerCase());
          return { id: old?.id || uid(), key: `${pp.key}-E${i + 1}`, title: pe.title, description: pe.description || old?.description || '', color: old?.color || COLORS[i % COLORS.length], ticketIds: pe.ticketIds };
        });
        pp.epics = next.map(({ ticketIds, ...e }) => e);
        for (const e of next) for (const id of e.ticketIds) { const t = pp.tickets.find((x: Any) => x.id === id); if (t) setField(t, 'epicId', e.id); }
        pp.tickets.sort((a: Any, b: Any) => pp.epics.findIndex((e: Any) => e.id === a.epicId) - pp.epics.findIndex((e: Any) => e.id === b.epicId));
      });
      S.drawer = null; closeModal(); toast('Epics re-organized — ⌘Z to undo');
    } }]}>
      {proposed.map((e, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <div className="row" style={{ gap: 6 }}><TypeIcon type="Epic" /><b>{e.title}</b><span className="muted small">{e.ticketIds.length} issues</span></div>
          <div className="small muted" style={{ margin: '2px 0 6px 22px' }}>{e.description}</div>
          <div className="rows" style={{ marginLeft: 22 }}>{e.ticketIds.map((id: string) => ticket(id)).filter(Boolean).map((t: Any) => (
            <div key={t.id} className="irow" style={{ cursor: 'default', minHeight: 32 }}><TypeIcon type={t.type} /><span className="key">{t.key}</span><span className="sum">{t.title}</span></div>))}</div>
        </div>
      ))}
    </Modal>
  );
}
export async function bulkTests() {
  const ids = [...S.checked].filter((id: string) => ticket(id));
  if (!ids.length) return;
  let done = 0;
  await withBusy(`Claude is writing test cases for ${ids.length} issues…`, async () => {
    for (const id of ids) {
      const t = ticket(id);
      setBusy(`Writing test cases ${done + 1} of ${ids.length}: ${t.key}`);
      try {
        const res = await api('/api/ai/ticket', { method: 'POST', body: aiBody({ action: 'tests', ticket: { ...t, history: [], comments: [] }, project: P() }) });
        mutate(() => { const x = ticket(id); x.testCases = withIds(res.ticket.testCases.map(({ id: _i, ...tc }: Any) => tc)); logEvent(x, 'regenerated test cases with Claude'); });
      } catch (e: Any) { toast(`${t.key}: ${e.message}`, 'err'); }
      done += 1;
    }
  });
  toast(`Test cases written for ${done} issues`);
}

// ---------------------------------------------------------------- pull requests & comments
export async function linkPr(t: Any, url: string) {
  url = url.trim();
  if (!url) return false;
  if (t.prs.some((r: Any) => r.url === url)) { toast('That pull request is already linked.', 'err'); return false; }
  try {
    const info = await api(`/api/pr-info?url=${encodeURIComponent(url)}`);
    S.prForm = false;
    mutate(() => { t.prs.push({ id: uid(), ...info, checkedAt: nowIso() }); logEvent(t, `linked pull request ${info.title}`); });
    toast(`Linked ${info.repo}${info.number ? ` #${info.number}` : ''} (${info.status})`);
    return true;
  } catch (err: Any) { toast(err.message, 'err'); return false; }
}
export async function refreshPr(t: Any, prId: string) {
  const r = t.prs.find((x: Any) => x.id === prId);
  try {
    const info = await api(`/api/pr-info?url=${encodeURIComponent(r.url)}`);
    mutate(() => {
      if (info.status !== r.status) logEvent(t, `pull request ${info.repo}${info.number ? ` #${info.number}` : ''} is now ${info.status}`, 'Development');
      Object.assign(r, info, { checkedAt: nowIso() });
    });
    toast(`${info.title}: ${info.status}`);
  } catch (err: Any) { toast(err.message, 'err'); }
}
export function saveComment(t: Any, body: string) {
  if (!body.trim()) return;
  mutate(() => { t.comments.push({ id: uid(), author: me(), authorId: S.user?.id, body: body.trim(), at: nowIso() }); t.updatedAt = nowIso(); });
}

// ---------------------------------------------------------------- sprints
export function SprintModal({ s, mode }: { s: Any; mode: 'start' | 'edit' }) {
  const start0 = s.startDate || dateInput(Date.now());
  const [f, setF] = useState({ name: s.name, dur: '2', start: start0, end: s.endDate || dateInput(Date.parse(start0) + 14 * 86400000), goal: s.goal || '' });
  const issues = P().tickets.filter((x: Any) => x.sprintId === s.id && !isSub(x));
  const withDur = (next: Any) => (next.dur !== 'custom' && next.start ? { ...next, end: dateInput(Date.parse(next.start) + Number(next.dur) * 7 * 86400000) } : next);
  const submit = () => {
    if (!f.name.trim()) return;
    if (f.start && f.end && f.end < f.start) return toast('The end date must be after the start date.', 'err');
    if (mode === 'start' && activeSprint() && activeSprint().id !== s.id) return toast('Complete the active sprint first.', 'err');
    mutate(() => {
      Object.assign(s, { name: f.name.trim(), startDate: f.start, endDate: f.end, goal: f.goal.trim() });
      if (mode === 'start') {
        s.state = 'active';
        s.committedPoints = spSum(issues);
        issues.forEach((x: Any) => logEvent(x, `included in ${s.name}`));
      }
    });
    closeModal();
    if (mode === 'start') { toast(`${s.name} started`); S.nav(`/p/${P().id}/board`); }
  };
  return (
    <Modal title={mode === 'start' ? `Start ${s.name}` : `Edit ${s.name}`} actions={[{ label: 'Cancel' }, { label: mode === 'start' ? 'Start' : 'Update', kind: 'primary', onClick: submit }]}>
      {mode === 'start' && <p style={{ marginTop: 0 }}><b>{issues.length}</b> issues ({spSum(issues)} story points) will be included in this sprint.</p>}
      <label className="field"><span>Sprint name <span className="req">*</span></span><TF value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <label className="field"><span>Duration</span><SF value={f.dur} onChange={(e) => setF(withDur({ ...f, dur: e.target.value }))}>{[1, 2, 3, 4].map((w) => <MenuItem key={w} value={String(w)}>{w} week{w > 1 ? 's' : ''}</MenuItem>)}<MenuItem value="custom">Custom</MenuItem></SF></label>
        <label className="field"><span>Start date</span><DateF value={f.start} onChange={(v) => setF(withDur({ ...f, start: v }))} /></label>
        <label className="field"><span>End date</span><DateF value={f.end} onChange={(v) => setF({ ...f, end: v, dur: 'custom' })} /></label>
      </div>
      <label className="field"><span>Sprint goal</span><TA value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="What should this sprint achieve?" /></label>
    </Modal>
  );
}
export function CompleteSprintModal({ s }: { s: Any }) {
  const issues = P().tickets.filter((x: Any) => x.sprintId === s.id && !isSub(x));
  const done = issues.filter(isDone), open = issues.filter((x: Any) => !isDone(x));
  const future = P().sprints.filter((x: Any) => x.state === 'future');
  const [to, setTo] = useState('');
  return (
    <Modal title={`Complete ${s.name}`} actions={[{ label: 'Cancel' }, { label: 'Complete sprint', kind: 'primary', onClick: () => {
      let target: string | null = to || null;
      mutate((p) => {
        if (target === '__new') { const ns = { id: uid(), name: `${p.key} Sprint ${p.sprints.length + 1}`, goal: '', state: 'future', startDate: '', endDate: '' }; p.sprints.push(ns); target = ns.id; }
        Object.assign(s, { state: 'closed', completedAt: nowIso(), completedPoints: spSum(done) });
        open.forEach((x: Any) => setField(x, 'sprintId', target));
      });
      closeModal(); toast(`${s.name} completed · ${spSum(done)} points done`);
      S.nav(`/p/${P().id}/reports`);
    } }]}>
      <p style={{ marginTop: 0 }}>This sprint has <b>{done.length}</b> completed issue{done.length === 1 ? '' : 's'} ({spSum(done)} points) and <b>{open.length}</b> open issue{open.length === 1 ? '' : 's'}.</p>
      {open.length ? <label className="field"><span>Move open issues to</span><SF value={to} onChange={(e) => setTo(e.target.value)}><MenuItem value="">Backlog</MenuItem>{future.map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.name}</MenuItem>)}<MenuItem value="__new">New sprint</MenuItem></SF></label>
        : <p className="muted">All issues are done. Nice work.</p>}
    </Modal>
  );
}
export function createSprint() {
  const n = P().sprints.length + 1;
  mutate((p) => p.sprints.push({ id: uid(), name: `${p.key} Sprint ${n}`, goal: '', state: 'future', startDate: '', endDate: '' }));
  toast(`Created ${P().key} Sprint ${n}`);
}
export function deleteSprint(s: Any) {
  const n = P().tickets.filter((x: Any) => x.sprintId === s.id).length;
  openModal(<Confirm title={`Delete ${s.name}?`} label="Delete sprint" text={`${n ? `Its ${n} issues move back to the backlog. ` : ''}You can undo with ⌘Z.`}
    onYes={() => mutate((p) => { p.tickets.forEach((x: Any) => { if (x.sprintId === s.id) setField(x, 'sprintId', null); }); p.sprints = p.sprints.filter((x: Any) => x.id !== s.id); })} />);
}

// ---------------------------------------------------------------- test automation
function BaseUrlModal({ resolve }: { resolve: (v: string | null) => void }) {
  const [v, setV] = useState(P().automation.baseUrl || '');
  return (
    <Modal title="Where should the tests run?" actions={[{ label: 'Cancel', onClick: () => { closeModal(); resolve(null); } }, { label: 'Save and run', kind: 'primary', onClick: () => {
      if (!/^https?:\/\/\S+$/i.test(v.trim())) return toast('Enter a full URL starting with http:// or https://', 'err');
      mutate((p) => { p.automation.baseUrl = v.trim(); });
      closeModal(); resolve(v.trim());
    } }]}>
      <p style={{ marginTop: 0 }}>Enter the URL of the application under test. Claude writes Playwright scripts against it and they run in a headless browser on this machine.</p>
      <label className="field"><span>Application URL <span className="req">*</span></span><TF autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="http://localhost:3000" /></label>
    </Modal>
  );
}
const askBaseUrl = () => new Promise<string | null>((resolve) => openModal(<BaseUrlModal resolve={resolve} />));

export async function runTests(list: { t: Any; tc: Any }[], { regenerate = false } = {}) {
  if (!list.length) return toast('No test cases to run.', 'err');
  if (S.autoRun?.running) return toast('Tests are already running.', 'err');
  if (!S.engine?.browser) { await loadEngine(); if (!S.engine?.browser) { toast('The test browser isn’t installed yet (Test automation page).', 'err'); S.nav(`/p/${P().id}/automation`); return; } }
  const baseUrl = P().automation.baseUrl || await askBaseUrl();
  if (!baseUrl) return;
  const ctrl = new AbortController();
  const run: Any = { running: true, ctrl, total: list.length, done: 0, pass: 0, fail: 0, current: null, log: [{ message: `Running ${list.length} test${list.length > 1 ? 's' : ''} against ${baseUrl}` }] };
  S.autoRun = run; emit();
  const push = (message: string, level?: string) => { run.log.forEach((l: Any) => { if (!l.level) l.level = 'info'; }); run.log.push({ message, level }); emit(); };
  try {
    const res = await api('/api/automation/run', {
      method: 'POST', raw: true, signal: ctrl.signal,
      body: {
        baseUrl, regenerate, provider: S.settings.provider || undefined, model: S.settings.model || undefined,
        project: { id: P().id, name: P().name, summary: P().summary },
        items: list.map(({ t, tc }) => ({
          ticket: { id: t.id, key: t.key, title: t.title, userStory: t.userStory, acceptanceCriteria: t.acceptanceCriteria },
          tc: { id: tc.id, title: tc.title, steps: tc.steps, expected: tc.expected, preconditions: tc.preconditions, script: regenerate ? '' : tc.script },
        })),
      },
    });
    await readNdjson(res, (ev) => {
      const { t, tc } = ev.ticketId ? findTc(ev.ticketId, ev.tcId) : ({} as Any);
      const label = t && tc ? `${tcKey(t, t.testCases.indexOf(tc))} ${tc.title}` : '';
      if (ev.type === 'phase') push(ev.message, ev.level);
      else if (ev.type === 'error') push(ev.message || ev.error, 'err');
      else if (ev.type === 'script' && tc) mutate(() => { tc.script = ev.code; });
      else if (ev.type === 'start') { run.current = ev.tcId; push(`Running ${label}`); }
      else if (ev.type === 'reported') run.report = ev;
      else if (ev.type === 'result' && tc) {
        run.done += 1; run.current = null;
        if (ev.result.status === 'Pass') run.pass += 1; else run.fail += 1;
        const msg = { message: `${label} — ${ev.result.status}${ev.result.durationMs ? ` (${(ev.result.durationMs / 1000).toFixed(1)}s)` : ''}`, level: ev.result.status === 'Pass' ? 'pass' : 'fail' };
        if (run.log[run.log.length - 1]?.message.startsWith('Running ')) run.log[run.log.length - 1] = msg; else run.log.push(msg);
        mutate(() => { tc.lastRun = ev.result; tc.status = ev.result.status; logEvent(t, `automated test ${tcKey(t, t.testCases.indexOf(tc))}: ${ev.result.status}`, 'Automation'); });
      }
    });
  } catch (e: Any) {
    push(e.name === 'AbortError' ? 'Run stopped' : e.message, e.name === 'AbortError' ? 'warn' : 'err');
  } finally {
    run.running = false; run.current = null; emit();
    toast(`Test run finished · ${run.pass} passed · ${run.fail} failed`, run.fail ? 'err' : 'ok');
    if (run.report) {
      // The server added automated comments: save our results, then pull them in.
      await saveNow();
      await pullRemote({ quiet: true });
      const r = run.report;
      const bits = [r.commented.length && `commented on ${r.commented.join(', ')}`, r.notified.length && `notified ${[...new Set(r.notified)].join(', ')}`, r.emailed.length && `emailed ${r.emailed.length}`].filter(Boolean);
      if (bits.length) { push(`Failure report: ${bits.join(' · ')}`, 'info'); toast(`Failure report: ${bits.join(' · ')}`); }
      if (r.skipped.length) push(`Not notified: ${r.skipped.join(', ')}`, 'warn');
      loadNotifs();
    }
  }
}
export async function installBrowser() {
  await withBusy('Installing Chromium for test automation…', async () => {
    const res = await api('/api/automation/install', { method: 'POST', raw: true, body: {} });
    await readNdjson(res, (ev) => {
      if (ev.type === 'log') setBusy(`Installing Chromium… ${ev.line.slice(0, 60)}`);
      if (ev.type === 'error') throw new Error(ev.message || ev.error);
    });
  });
  await loadEngine();
  if (S.engine?.browser) toast('Chromium installed — ready to run tests');
}
export function ScriptModal({ tid, tcid }: { tid: string; tcid: string }) {
  const { t, tc } = findTc(tid, tcid);
  const [code, setCode] = useState(tc?.script || '');
  if (!tc) return null;
  const save = () => mutate(() => { tc.script = code; });
  const editable = can('test.run') || can('issue.edit');
  return (
    <Modal title={`${tcKey(t, t.testCases.indexOf(tc))} automation script`} wide actions={[{ label: 'Cancel' },
      { label: '✨ Rewrite and run', kind: 'ai', hidden: !can('ai.use') || !can('test.run'), onClick: () => { closeModal(); runTests([{ t, tc }], { regenerate: true }); } },
      { label: 'Save and run', hidden: !can('test.run'), onClick: () => { save(); closeModal(); runTests([{ t, tc }]); } },
      { label: 'Save', kind: 'primary', hidden: !editable, onClick: () => { save(); closeModal(); toast('Script saved'); } }]}>
      <p className="muted small" style={{ marginTop: 0 }}>Body of <code>{'async ({ page, expect, baseURL }) => { … }'}</code> — runs with Playwright against {P().automation.baseUrl || 'your app'}.</p>
      <TA mono spellCheck={false} style={{ minHeight: 280 }} max={480} value={code} disabled={!editable} onChange={(e) => setCode(e.target.value)} />
      {tc.lastRun?.error && <><h5 style={{ margin: '12px 0 4px' }}>Last error</h5><pre className="err-box">{tc.lastRun.error}</pre></>}
    </Modal>
  );
}

// ---------------------------------------------------------------- AI connection
/** Which AI this address uses. On your own computer you can also pick the Claude model. */
export function AiSettingsModal() {
  const st = S.status || {};
  const [model, setModel] = useState(S.settings.model || '');
  const account = st.mode === 'account';
  const models = ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
  const admin = can('users.manage');
  const goAdmin = <a href="/admin/ai" onClick={(e) => { e.preventDefault(); closeModal(); S.nav('/admin/ai'); }}>Administration → AI</a>;
  return (
    <Modal title="AI connection" actions={account
      ? [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: () => { S.settings = { ...S.settings, provider: '', model: model.trim() }; store.set('tf.settings', S.settings); closeModal(); } }]
      : [{ label: 'Close' }]}>
      <div className="row small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', marginBottom: 12 }}>
        <span className={`dot ${st.ready ? 'ok' : 'bad'}`} style={{ marginTop: 5 }} />
        <span>{account
          ? <><b>Your Claude account</b> through Claude Code on this computer{st.account?.subscriptionType ? ` (${st.account.subscriptionType})` : ''}.
              {!st.ready && <><br />{st.account?.cli?.available ? <>Claude Code isn’t signed in: run <code>claude</code> in a terminal and sign in.</> : <>Claude Code isn’t installed: run <code>npm install -g @anthropic-ai/claude-code</code>, then <code>claude</code> to sign in.</>}</>}</>
          : st.api?.configured
            ? <><b>{st.api.label}</b> API, model <code>{st.api.model}</code>.</>
            : <><b>No AI API is set up</b> for this address.{admin ? <> Set it up in {goAdmin}.</> : ' Ask an administrator to set it up.'}</>}
          <br /><span className="muted">{account ? 'Used because you opened TicketForge on this computer (localhost).' : 'Used because TicketForge was opened on a web address. On your own computer it uses your Claude account instead.'}</span></span>
      </div>
      {account
        ? <><label className="field"><span>Claude model — leave blank for the default</span><PeopleF avatars={false} value={model} onChange={setModel} options={models} placeholder={st.model || 'opus'} /></label>
            <p className="small muted" style={{ marginBottom: 0 }}>Aliases like <code>opus</code> or <code>sonnet</code> use the newest model your Claude Code knows (<code>claude update</code> gets the latest).</p></>
        : <p className="small muted" style={{ marginBottom: 0 }}>The provider and model are set with environment variables on the server{admin ? <>; see {goAdmin}</> : ''}.</p>}
    </Modal>
  );
}
/** Older name, kept for existing imports. */
export const ClaudeSettingsModal = AiSettingsModal;

export function BlankProjectModal() {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [touched, setTouched] = useState(false);
  const autoKey = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  return (
    <Modal title="Create a blank project" actions={[{ label: 'Cancel' }, { label: 'Create', kind: 'primary', disabled: !name.trim(), onClick: async () => {
      const k = (key || autoKey(name) || 'PRJ').replace(/[^a-z0-9]/gi, '').toUpperCase();
      const now = nowIso();
      try {
        const p = await api('/api/projects', { method: 'POST', body: { name: name.trim(), key: k, summary: '', assumptions: [], openQuestions: [], sourceName: '', sourceText: '', epics: [], tickets: [], createdAt: now, updatedAt: now } });
        closeModal(); S.nav(`/p/${p.id}/backlog`);
      } catch (e: Any) { toast(e.message, 'err'); }
    } }]}>
      <label className="field"><span>Name <span className="req">*</span></span><TF autoFocus value={name} onChange={(e) => { setName(e.target.value); if (!touched) setKey(autoKey(e.target.value)); }} placeholder="e.g. Mobile app relaunch" /></label>
      <label className="field"><span>Key <span className="req">*</span></span><TF maxLength={8} value={key} onChange={(e) => { setTouched(true); setKey(e.target.value.toUpperCase()); }} placeholder="e.g. MAR" /></label>
    </Modal>
  );
}

export const icoBtn = (svg: string, label: string, onClick: () => void, extra: Any = {}): ReactNode => (
  <button className="icon-btn" title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }} {...extra}><Ico svg={svg} /></button>
);
export { I };
