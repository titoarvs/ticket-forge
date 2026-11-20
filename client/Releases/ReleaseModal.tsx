'use client';
import { useState } from 'react';
import {
  can,
  P,
  type Any,
  isSub,
  catOf,
  releases,
  mutate,
  uid,
  nowIso,
  closeModal,
  toast,
  isDone,
  setField,
  release,
} from '../core';
import { Modal } from '../ui';
import { TF, DateF, TA, SF, MenuItem } from '../fields';

const today = () => new Date().toISOString().slice(0, 10);
const STATUS_LABEL: Record<string, string> = {
  unreleased: 'Unreleased',
  released: 'Released',
  archived: 'Archived',
};
export const canRelease = () => can('sprint.manage') || can('project.settings');
/** Issues (not sub-tasks) with this fix version. */
export const releaseIssues = (id: string) =>
  P().tickets.filter((t: Any) => !isSub(t) && (t.fixVersions || []).includes(id));
export const overdue = (r: Any) =>
  r.status === 'unreleased' && r.releaseDate && r.releaseDate < today();
export function Progress({ items }: { items: Any[] }) {
  const n = items.length || 1;
  const c = (cat: string) => items.filter((t) => catOf(t.status) === cat).length;
  const [done, prog, todo] = [c('done'), c('inprogress'), c('todo')];
  return (
    <div className="rel-prog" title={`${done} done · ${prog} in progress · ${todo} to do`}>
      <div className="prog">
        {done > 0 && <i className="p-done" style={{ width: `${(done / n) * 100}%` }} />}
        {prog > 0 && <i className="p-prog" style={{ width: `${(prog / n) * 100}%` }} />}
      </div>
      <span className="muted small">
        {items.length ? `${done} of ${items.length} done` : 'No issues'}
      </span>
    </div>
  );
}
export const RelLoz = ({ r }: { r: Any }) => (
  <span
    className={`loz ${r.status === 'released' ? 't-pass' : r.status === 'archived' ? '' : overdue(r) ? 't-fail' : 's-inprogress'}`}
  >
    {overdue(r) ? 'Overdue' : STATUS_LABEL[r.status] || r.status}
  </span>
);
/** Create or edit a version. */
export function ReleaseModal({ r }: { r?: Any }) {
  const [f, setF] = useState<Any>(() => ({
    name: r?.name || '',
    description: r?.description || '',
    startDate: r?.startDate || '',
    releaseDate: r?.releaseDate || '',
  }));
  const set = (k: string, v: Any) => setF((x: Any) => ({ ...x, [k]: v }));
  const taken = releases().some(
    (x: Any) => x.id !== r?.id && x.name.trim().toLowerCase() === f.name.trim().toLowerCase(),
  );
  const badDates = f.startDate && f.releaseDate && f.releaseDate < f.startDate;
  const ok = f.name.trim() && !taken && !badDates;
  const save = () => {
    mutate((p) => {
      p.releases ??= [];
      if (r)
        Object.assign(
          p.releases.find((x: Any) => x.id === r.id),
          { ...f, name: f.name.trim() },
        );
      else
        p.releases.push({
          id: uid(),
          ...f,
          name: f.name.trim(),
          status: 'unreleased',
          createdAt: nowIso(),
        });
    });
    closeModal();
    toast(r ? `Saved ${f.name.trim()}` : `Created version ${f.name.trim()}`);
  };
  return (
    <Modal
      title={r ? `Edit ${r.name}` : 'Create version'}
      actions={[
        { label: 'Cancel' },
        { label: r ? 'Save' : 'Create', kind: 'primary', disabled: !ok, onClick: save },
      ]}
    >
      <label className="field">
        <span>Name</span>
        <TF
          autoFocus
          value={f.name}
          placeholder="e.g. 1.4.0 or Payroll Q4"
          onChange={(e) => set('name', e.target.value)}
        />
        {taken && <span className="field-warn">A version with this name already exists.</span>}
      </label>
      <div className="grid2">
        <label className="field">
          <span>Start date</span>
          <DateF value={f.startDate} onChange={(v) => set('startDate', v)} />
        </label>
        <label className="field">
          <span>Release date</span>
          <DateF value={f.releaseDate} onChange={(v) => set('releaseDate', v)} />
        </label>
      </div>
      {badDates && <p className="field-warn">The release date is before the start date.</p>}
      <label className="field">
        <span>Description</span>
        <TA
          rows={3}
          value={f.description}
          placeholder="What this release is about"
          onChange={(e) => set('description', e.target.value)}
        />
      </label>
    </Modal>
  );
}
/** Release a version: when, and where its unfinished issues go. */
export function ReleaseNowModal({ r }: { r: Any }) {
  const open = releaseIssues(r.id).filter((t: Any) => !isDone(t));
  const others = releases().filter((x: Any) => x.id !== r.id && x.status === 'unreleased');
  const [date, setDate] = useState(today());
  const [to, setTo] = useState(others[0]?.id || '');
  const go = () => {
    mutate((p) => {
      for (const t of open) {
        const next = (t.fixVersions || []).filter((v: string) => v !== r.id);
        if (to && !next.includes(to)) next.push(to);
        setField(t, 'fixVersions', next);
      }
      Object.assign(
        p.releases.find((x: Any) => x.id === r.id),
        { status: 'released', releaseDate: date, releasedAt: nowIso() },
      );
    });
    closeModal();
    toast(
      `Released ${r.name}${open.length ? `; ${open.length} unfinished issue${open.length === 1 ? '' : 's'} ${to ? `moved to ${release(to)?.name}` : 'removed from it'}` : ''}`,
    );
  };
  return (
    <Modal
      title={`Release ${r.name}`}
      actions={[{ label: 'Cancel' }, { label: 'Release', kind: 'primary', onClick: go }]}
    >
      <label className="field">
        <span>Release date</span>
        <DateF value={date} onChange={setDate} />
      </label>
      {open.length > 0 ? (
        <>
          <p className="warn-text small">
            {open.length} issue{open.length === 1 ? ' isn’t' : 's aren’t'} done yet.
          </p>
          <label className="field">
            <span>Move unfinished issues to</span>
            <SF value={to} onChange={(e) => setTo(e.target.value)}>
              {others.map((x: Any) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.name}
                </MenuItem>
              ))}
              <MenuItem value="">No version (remove them from {r.name})</MenuItem>
            </SF>
          </label>
        </>
      ) : (
        <p className="muted small">Every issue in this version is done.</p>
      )}
    </Modal>
  );
}
