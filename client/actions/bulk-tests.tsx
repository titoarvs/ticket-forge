'use client';
import { useState } from 'react';
import {
  type Any,
  S,
  ticket,
  toast,
  saveNow,
  withBusy,
  api,
  setBusy,
  aiBody,
  P,
  readNdjson,
  mutate,
  withIds,
  logEvent,
  uid,
  nowIso,
  me,
  dateInput,
  isSub,
  activeSprint,
  spSum,
  closeModal,
  isDone,
  setField,
} from '../core';
import { askFirst } from '../Clarify';
import { doneOnMerge } from '../codeStatus';
import { Modal } from '../ui';
import { TF, SF, MenuItem, DateF, TA } from '../fields';

/**
 * What the AI writes test cases from: when it hasn't changed, writing them again gives the same
 * kind of result.
 */
const testInputHash = (t: Any) => {
  let h = 5381;
  for (const c of JSON.stringify([t.title, t.userStory, t.description, t.acceptanceCriteria]))
    h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(36);
};
/**
 * Writes test cases for the selected issues, 5 issues per AI request. Issues whose summary, story,
 * description and acceptance criteria haven't changed since their test cases were written are
 * skipped (offered as "Write them anyway").
 */
export async function bulkTests(force = false) {
  const all = [...S.checked].filter((id: string) => ticket(id)) as string[];
  if (!all.length) return;
  const unchanged = force
    ? []
    : all.filter((id) => {
        const t = ticket(id);
        return t.testCases?.length && t.aiHash?.tests === testInputHash(t);
      });
  const ids = all.filter((id) => !unchanged.includes(id));
  const sel = [...all];
  if (!ids.length) {
    toast(
      `${unchanged.length === 1 ? 'This issue hasn’t' : `These ${unchanged.length} issues haven’t`} changed since their test cases were written.`,
      'info',
      {
        title: 'Nothing to write',
        action: {
          label: 'Write them anyway',
          onClick: () => {
            S.checked = new Set(sel);
            bulkTests(true);
          },
        },
      },
    );
    return;
  }
  const answers = await askFirst({
    kind: 'bulk-tests',
    subject: `test cases for ${ids.length} issue${ids.length > 1 ? 's' : ''}`,
    ticketIds: ids,
  });
  if (answers === null) return;
  await saveNow(); // the server reads the saved issues
  let written = 0;
  const missed: string[] = [];
  await withBusy(`Claude is writing test cases for ${ids.length} issues…`, async () => {
    // About how much this costs, from the average test-writing request so far (5 issues per
    // request).
    const est = await api('/api/admin/ai/usage?estimate=tests').catch(() => null);
    const calls = Math.ceil(ids.length / 5);
    setBusy(
      `Writing test cases 1 of ${ids.length}${est?.calls ? ` · about ${calls} request${calls === 1 ? '' : 's'}, ~${Math.round((est.tokens * calls) / 1000)}k tokens${est.cost != null ? `, ≈ $${(est.cost * calls).toFixed(2)}` : ''}` : ''}`,
    );
    const res = await api('/api/ai/tests-batch', {
      method: 'POST',
      raw: true,
      body: aiBody({ projectId: P().id, ticketIds: ids, answers }),
    });
    await readNdjson(res, (ev) => {
      if (ev.type === 'batch') {
        if (ev.results.length)
          mutate(() => {
            for (const r of ev.results) {
              const x = ticket(r.ticketId);
              if (!x) continue;
              x.testCases = withIds(r.testCases);
              x.aiHash = { ...(x.aiHash || {}), tests: testInputHash(x) };
              logEvent(x, 'regenerated test cases with Claude');
            }
          });
        written += ev.results.length;
        missed.push(...(ev.missing || []));
        if (ev.error) toast(`Test cases for ${ev.missing.join(', ')}: ${ev.error}`, 'err');
        setBusy(`Writing test cases ${Math.min(ev.done + 1, ev.total)} of ${ev.total}`);
      } else if (ev.type === 'error') throw new Error(ev.error);
    });
  });
  toast(
    `${written} issue${written === 1 ? '' : 's'} now have new test cases.${unchanged.length ? ` ${unchanged.length} skipped: unchanged since their test cases were written.` : ''}${missed.length ? ` No test cases came back for ${missed.slice(0, 5).join(', ')}.` : ''}`,
    missed.length ? 'warn' : 'ok',
    {
      title: 'Test cases written',
      ...(unchanged.length
        ? {
            action: {
              label: 'Write skipped too',
              onClick: () => {
                S.checked = new Set(unchanged);
                bulkTests(true);
              },
            },
          }
        : {}),
    },
  );
}
// ---------------------------------------------------------------- pull requests & comments
export async function linkPr(t: Any, url: string) {
  url = url.trim();
  if (!url) return false;
  if (t.prs.some((r: Any) => r.url === url)) {
    toast('That pull request is already linked.', 'err');
    return false;
  }
  try {
    const info = await api(
      `/api/pr-info?url=${encodeURIComponent(url)}&projectId=${encodeURIComponent(P().id)}`,
    );
    S.prForm = false;
    mutate(() => {
      t.prs.push({ id: uid(), ...info, checkedAt: nowIso() });
      logEvent(t, `linked pull request ${info.title}`);
    });
    toast(`Linked ${info.repo}${info.number ? ` #${info.number}` : ''} (${info.status})`);
    return true;
  } catch (err: Any) {
    toast(err.message, 'err');
    return false;
  }
}
/**
 * Reads the request again from GitHub / GitLab. quiet: no toasts (background refresh); returns
 * whether it was read.
 */
export async function refreshPr(t: Any, prId: string, { quiet = false } = {}) {
  const r = t.prs.find((x: Any) => x.id === prId);
  if (!r) return false;
  try {
    const info = await api(
      `/api/pr-info?url=${encodeURIComponent(r.url)}&projectId=${encodeURIComponent(P().id)}`,
    );
    // Only what was really read from GitHub/GitLab replaces what's saved: a placeholder never
    // overwrites the real title or branch.
    if (!info.fetched) {
      mutate(() => {
        r.checkedAt = nowIso();
      });
      if (!quiet)
        toast(
          `Couldn’t read ${r.provider === 'GitLab' ? 'the merge request from GitLab' : 'the pull request'}${r.provider === 'GitLab' ? ' (save a GitLab token in Project settings → Code & GitHub)' : ''}. Kept what was saved.`,
          'warn',
        );
      return false;
    }
    const nowMerged = info.status === 'Merged' && r.status !== 'Merged';
    mutate(
      () => {
        if (info.status !== r.status)
          logEvent(
            t,
            `${r.provider === 'GitLab' ? 'merge request' : 'pull request'} ${info.repo}${info.number ? ` ${r.provider === 'GitLab' ? '!' : '#'}${info.number}` : ''} is now ${info.status}`,
            'Development',
          );
        Object.assign(r, info, { checkedAt: nowIso() });
      },
      { tag: `pr.${r.id}` },
    );
    if (!quiet) toast(`${info.title}: ${info.status}`);
    // Merged since it was last read: the issue moves to Done once none of its requests is open.
    if (nowMerged) await doneOnMerge(t, { quiet });
    return true;
  } catch (err: Any) {
    if (!quiet) toast(err.message, 'err');
    return false;
  }
}
/**
 * Adds a comment: plain text, or rich text from the comment editor ({ doc, text, attachments }).
 */
export function saveComment(t: Any, v: string | { doc: Any; text: string; attachments: Any[] }) {
  const rich = typeof v === 'string' ? null : v;
  const body = (rich ? rich.text : String(v)).trim();
  if (!body && !rich?.attachments?.length) return;
  mutate(() => {
    t.comments.push({
      id: uid(),
      author: me(),
      authorId: S.user?.id,
      body,
      at: nowIso(),
      ...(rich && { doc: rich.doc, attachments: rich.attachments || [] }),
    });
    t.updatedAt = nowIso();
  });
}
// ---------------------------------------------------------------- sprints
export function SprintModal({ s, mode }: { s: Any; mode: 'start' | 'edit' }) {
  const start0 = s.startDate || dateInput(Date.now());
  const [f, setF] = useState({
    name: s.name,
    dur: '2',
    start: start0,
    end: s.endDate || dateInput(Date.parse(start0) + 14 * 86400000),
    goal: s.goal || '',
  });
  const issues = P().tickets.filter((x: Any) => x.sprintId === s.id && !isSub(x));
  const withDur = (next: Any) =>
    next.dur !== 'custom' && next.start
      ? { ...next, end: dateInput(Date.parse(next.start) + Number(next.dur) * 7 * 86400000) }
      : next;
  const submit = () => {
    if (!f.name.trim()) return;
    if (f.start && f.end && f.end < f.start)
      return toast('The end date must be after the start date.', 'err');
    if (mode === 'start' && activeSprint() && activeSprint().id !== s.id)
      return toast('Complete the active sprint first.', 'err');
    mutate(() => {
      Object.assign(s, {
        name: f.name.trim(),
        startDate: f.start,
        endDate: f.end,
        goal: f.goal.trim(),
      });
      if (mode === 'start') {
        s.state = 'active';
        s.committedPoints = spSum(issues);
        issues.forEach((x: Any) => logEvent(x, `included in ${s.name}`));
      }
    });
    closeModal();
    if (mode === 'start') {
      toast(`${s.name} started`);
      S.nav(`/p/${P().id}/board`);
    }
  };
  return (
    <Modal
      title={mode === 'start' ? `Start ${s.name}` : `Edit ${s.name}`}
      actions={[
        { label: 'Cancel' },
        { label: mode === 'start' ? 'Start' : 'Update', kind: 'primary', onClick: submit },
      ]}
    >
      {mode === 'start' && (
        <p style={{ marginTop: 0 }}>
          <b>{issues.length}</b> issues ({spSum(issues)} story points) will be included in this
          sprint.
        </p>
      )}
      <label className="field">
        <span>
          Sprint name <span className="req">*</span>
        </span>
        <TF value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <label className="field">
          <span>Duration</span>
          <SF value={f.dur} onChange={(e) => setF(withDur({ ...f, dur: e.target.value }))}>
            {[1, 2, 3, 4].map((w) => (
              <MenuItem key={w} value={String(w)}>
                {w} week{w > 1 ? 's' : ''}
              </MenuItem>
            ))}
            <MenuItem value="custom">Custom</MenuItem>
          </SF>
        </label>
        <label className="field">
          <span>Start date</span>
          <DateF value={f.start} onChange={(v) => setF(withDur({ ...f, start: v }))} />
        </label>
        <label className="field">
          <span>End date</span>
          <DateF value={f.end} onChange={(v) => setF({ ...f, end: v, dur: 'custom' })} />
        </label>
      </div>
      <label className="field">
        <span>Sprint goal</span>
        <TA
          value={f.goal}
          onChange={(e) => setF({ ...f, goal: e.target.value })}
          placeholder="What should this sprint achieve?"
        />
      </label>
    </Modal>
  );
}
export function CompleteSprintModal({ s }: { s: Any }) {
  const issues = P().tickets.filter((x: Any) => x.sprintId === s.id && !isSub(x));
  const done = issues.filter(isDone),
    open = issues.filter((x: Any) => !isDone(x));
  const future = P().sprints.filter((x: Any) => x.state === 'future');
  const [to, setTo] = useState('');
  return (
    <Modal
      title={`Complete ${s.name}`}
      actions={[
        { label: 'Cancel' },
        {
          label: 'Complete sprint',
          kind: 'primary',
          onClick: () => {
            let target: string | null = to || null;
            mutate((p) => {
              if (target === '__new') {
                const ns = {
                  id: uid(),
                  name: `${p.key} Sprint ${p.sprints.length + 1}`,
                  goal: '',
                  state: 'future',
                  startDate: '',
                  endDate: '',
                };
                p.sprints.push(ns);
                target = ns.id;
              }
              Object.assign(s, {
                state: 'closed',
                completedAt: nowIso(),
                completedPoints: spSum(done),
              });
              open.forEach((x: Any) => setField(x, 'sprintId', target));
            });
            closeModal();
            toast(`${s.name} completed · ${spSum(done)} points done`);
            S.nav(`/p/${P().id}/reports`);
          },
        },
      ]}
    >
      <p style={{ marginTop: 0 }}>
        This sprint has <b>{done.length}</b> completed issue{done.length === 1 ? '' : 's'} (
        {spSum(done)} points) and <b>{open.length}</b> open issue{open.length === 1 ? '' : 's'}.
      </p>
      {open.length ? (
        <label className="field">
          <span>Move open issues to</span>
          <SF value={to} onChange={(e) => setTo(e.target.value)}>
            <MenuItem value="">Backlog</MenuItem>
            {future.map((x: Any) => (
              <MenuItem key={x.id} value={x.id}>
                {x.name}
              </MenuItem>
            ))}
            <MenuItem value="__new">New sprint</MenuItem>
          </SF>
        </label>
      ) : (
        <p className="muted">All issues are done. Nice work.</p>
      )}
    </Modal>
  );
}
