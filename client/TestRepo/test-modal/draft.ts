'use client';
// The test being edited (a copy; nothing is saved until Save), and saving or deleting it.
import { useState } from 'react';
import { type Any, uid, toast, nowIso, me, closeModal } from '../../core';
import { repo, edit } from '../run-status';
import { CONTENT, wfOf, snapshot, nextKey } from '../TestManagement';

const emptyStep = () => ({ id: uid(), action: '', data: '', expected: '' });

function newTest(folderId: string | null, issueId?: string) {
  return {
    title: '',
    type: 'Manual',
    folderId,
    priority: 'Medium',
    labels: [],
    preconditions: '',
    steps: [emptyStep()],
    issueIds: issueId ? [issueId] : [],
  };
}

/** The editable copy of the test, with helpers for its fields and steps. */
export function useDraft(test: Any | null, folderId: string | null, issueId?: string) {
  const [d, setD] = useState<Any>(() =>
    test ? JSON.parse(JSON.stringify(test)) : newTest(folderId, issueId),
  );
  const set = (k: string, v: Any) => setD({ ...d, [k]: v });
  const setStep = (i: number, k: string, v: string) =>
    set(
      'steps',
      d.steps.map((s: Any, j: number) => (j === i ? { ...s, [k]: v } : s)),
    );
  const moveStep = (i: number, by: number) => {
    const st = [...d.steps];
    const [x] = st.splice(i, 1);
    st.splice(i + by, 0, x);
    set('steps', st);
  };
  const removeStep = (i: number) =>
    set(
      'steps',
      d.steps.filter((_: Any, j: number) => j !== i),
    );
  const addStep = () => set('steps', [...d.steps, emptyStep()]);
  return { d, setD, set, setStep, moveStep, removeStep, addStep };
}
export type Draft = ReturnType<typeof useDraft>;

/** Changing an approved test makes a new Draft version; the approved one is kept in its history. */
function versionBump(old: Any, clean: Any) {
  const changed = CONTENT.some(
    (k) => JSON.stringify(old[k] ?? '') !== JSON.stringify(clean[k] ?? ''),
  );
  if (!changed || wfOf(old) !== 'Approved') return {};
  return {
    version: (old.version || 1) + 1,
    versions: [...(old.versions || []), snapshot(old)].slice(-15),
    status: 'Draft',
  };
}

function savedMessage(test: Any | null) {
  if (!test) return 'Test created as a Draft: submit it for review when it’s ready.';
  const after = repo().tests.find((x: Any) => x.id === test.id);
  if (after && after.version !== test.version)
    return `${test.key} saved as version ${after.version} (Draft): submit it for review to approve it again.`;
  return `${test.key} saved`;
}

/** Saves the draft (steps with no action and no expected result are dropped) and closes the editor. */
export function saveTest(test: Any | null, d: Any) {
  if (!d.title.trim()) {
    toast('Give the test a title.', 'err');
    return;
  }
  const clean = {
    ...d,
    title: d.title.trim(),
    steps: d.steps.filter((s: Any) => s.action.trim() || s.expected.trim()),
  };
  edit((rr, pp) => {
    if (!test) {
      rr.tests.push({
        ...clean,
        id: uid(),
        key: nextKey(rr, pp, 't'),
        createdAt: nowIso(),
        createdBy: me(),
        status: 'Draft',
        version: 1,
      });
      return;
    }
    const i = rr.tests.findIndex((x: Any) => x.id === test.id);
    if (i < 0) return;
    const old = rr.tests[i];
    rr.tests[i] = {
      ...old,
      ...clean,
      ...versionBump(old, clean),
      updatedAt: nowIso(),
      updatedBy: me(),
    };
  });
  closeModal();
  toast(savedMessage(test));
}

/** Removes the test from the repository, its plans and its executions. */
export function deleteTest(test: Any) {
  edit((rr) => {
    rr.tests = rr.tests.filter((x: Any) => x.id !== test.id);
    rr.plans.forEach((pl: Any) => {
      pl.testIds = pl.testIds.filter((x: string) => x !== test.id);
    });
    rr.executions.forEach((e: Any) => {
      e.testIds = e.testIds.filter((x: string) => x !== test.id);
      delete e.runs?.[test.id];
    });
  });
  toast(`${test.key} deleted`);
}
