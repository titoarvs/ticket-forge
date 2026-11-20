'use client';
import { useState } from 'react';
import {
  ticket,
  type Any,
  S,
  emit,
  api,
  P,
  saveNow,
  toast,
  canMove,
  moveError,
  mutate,
  setField,
  isSub,
  newTicket,
  logEvent,
  clone,
  uid,
  nextTicketKey,
  nowIso,
  me,
  childrenOf,
  openModal,
  deleteIssues,
  nextEpicKey,
  COLORS,
  closeModal,
  epicTickets,
} from '../core';
import { Confirm, Modal } from '../ui';
import { SF, MenuItem } from '../fields';

export const findTc = (tid: string, tcid: string) => {
  const t = ticket(tid);
  return { t, tc: t?.testCases.find((x: Any) => x.id === tcid) };
};
export const openDrawer = (kind: 'issue' | 'epic', id: string) => {
  Object.assign(S, {
    drawer: { kind, id },
    menu: null,
    subForm: false,
    linkForm: false,
    prForm: false,
    cmtEdit: null,
  });
  emit();
};
export async function loadEngine() {
  try {
    S.engine = await api('/api/automation/status');
  } catch {
    S.engine = { installed: false, browser: false };
  }
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
    const name =
      res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `export.${fmt}`;
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link);
    link.click();
    link.parentNode?.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Downloaded ${name}`);
  } catch (e: Any) {
    toast(`Export failed: ${e.message}`, 'err');
  }
}
// ---------------------------------------------------------------- issues
export function moveTicket(
  id: string,
  zone: { group?: string; status?: string; epic?: string | null; assignee?: string | null },
  beforeId?: string,
) {
  if (!id) return;
  const to = zone.status || (zone.group?.startsWith('s:') ? zone.group.slice(2) : '');
  const cur = P().tickets.find((x: Any) => x.id === id);
  if (to && cur && !canMove(cur, to)) {
    toast(moveError(cur, to), 'err');
    return;
  }
  mutate((p) => {
    const t = p.tickets.find((x: Any) => x.id === id);
    const g = zone.group;
    if (g?.startsWith('e:')) setField(t, 'epicId', g === 'e:none' ? null : g.slice(2));
    if (g?.startsWith('s:')) setField(t, 'status', g.slice(2));
    if (g?.startsWith('sp:')) setField(t, 'sprintId', g === 'sp:none' ? null : g.slice(3));
    if (zone.status) setField(t, 'status', zone.status);
    if (zone.epic !== undefined && !isSub(t)) setField(t, 'epicId', zone.epic || null);
    if (zone.assignee !== undefined) setField(t, 'assignee', zone.assignee || '');
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
  const st = newTicket({
    title: title.trim(),
    type: 'Sub-task',
    parentId: t.id,
    epicId: t.epicId,
    sprintId: t.sprintId,
    priority: t.priority,
  });
  mutate((p) => {
    p.tickets.push(st);
    logEvent(t, `added sub-task ${st.key}`);
  });
  toast(`Created ${st.key}`);
}
export function duplicateIssue(t: Any) {
  const d = newTicket({
    ...clone(t),
    id: uid(),
    key: nextTicketKey(),
    title: `${t.title} (copy)`,
    comments: [],
    history: [],
    links: [],
    prs: [],
    createdAt: nowIso(),
    reporter: me(),
  });
  d.testCases.forEach((tc: Any) => {
    tc.id = uid();
    tc.lastRun = null;
  });
  mutate((p) => p.tickets.splice(p.tickets.indexOf(t) + 1, 0, d));
  openDrawer('issue', d.id);
  toast(`Created ${d.key}`);
}
export function confirmDeleteIssue(t: Any) {
  const n = childrenOf(t).length;
  openModal(
    <Confirm
      title={`Delete ${t.key}?`}
      label="Delete"
      text={
        <>
          “{t.title}”{n ? ` and its ${n} sub-tasks` : ''} will be deleted. You can undo with ⌘Z.
        </>
      }
      onYes={() => {
        mutate(() => deleteIssues([t.id]));
        S.drawer = null;
        emit();
        toast(`Deleted ${t.key}`);
      }}
    />,
  );
}
export function addEpic() {
  const ne = {
    id: uid(),
    key: nextEpicKey(),
    title: 'New epic',
    description: '',
    color: COLORS[P().epics.length % COLORS.length],
  };
  mutate((p) => p.epics.push(ne));
  openDrawer('epic', ne.id);
}
export function delEpic(ep: Any, withIssues: boolean) {
  mutate((p) => {
    if (withIssues)
      deleteIssues(p.tickets.filter((x: Any) => x.epicId === ep.id).map((x: Any) => x.id));
    else
      p.tickets.forEach((x: Any) => {
        if (x.epicId === ep.id) setField(x, 'epicId', null);
      });
    p.epics = p.epics.filter((x: Any) => x.id !== ep.id);
  });
  S.drawer = null;
  closeModal();
  toast(`Deleted ${ep.key}`);
}
export function DeleteEpicModal({ ep }: { ep: Any }) {
  const n = epicTickets(ep.id).length;
  return (
    <Modal
      title={`Delete ${ep.key}?`}
      actions={[
        { label: 'Cancel' },
        ...(n ? [{ label: 'Delete epic and its issues', onClick: () => delEpic(ep, true) }] : []),
        {
          label: n ? 'Delete epic, keep issues' : 'Delete',
          kind: 'danger' as const,
          onClick: () => delEpic(ep, false),
        },
      ]}
    >
      <p>
        Delete the epic “{ep.title}”?{n ? ` It has ${n} child issues.` : ''}
      </p>
    </Modal>
  );
}
export function ConvertSubModal({ t }: { t: Any }) {
  const parents = P().tickets.filter((x: Any) => !isSub(x) && x.id !== t.id);
  const [pid, setPid] = useState(parents[0]?.id || '');
  return (
    <Modal
      title={`Convert ${t.key} to a sub-task`}
      actions={[
        { label: 'Cancel' },
        {
          label: 'Convert',
          kind: 'primary',
          onClick: () => {
            const par = ticket(pid);
            if (!par) return;
            mutate(() => {
              setField(t, 'type', 'Sub-task');
              setField(t, 'parentId', par.id);
              t.epicId = par.epicId;
              t.sprintId = par.sprintId;
              logEvent(par, `added sub-task ${t.key}`);
            });
            closeModal();
            toast(`${t.key} is now a sub-task of ${par.key}`);
          },
        },
      ]}
    >
      <label className="field">
        <span>Parent issue</span>
        <SF value={pid} onChange={(e) => setPid(e.target.value)}>
          {parents.map((x: Any) => (
            <MenuItem key={x.id} value={x.id}>
              {x.key} — {x.title.slice(0, 60)}
            </MenuItem>
          ))}
        </SF>
      </label>
    </Modal>
  );
}
export function convertToSubtask(t: Any) {
  if (childrenOf(t).length) return toast('Issues with sub-tasks can’t become sub-tasks.', 'err');
  openModal(<ConvertSubModal t={t} />);
}
