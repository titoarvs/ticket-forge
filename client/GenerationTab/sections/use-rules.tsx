'use client';
// The generation rules being edited: loading them, editing a value by its path, a live preview of
// the prompts, saving, and resetting to the defaults.
import { useState, useRef, useEffect } from 'react';
import { type Any, api, toast, openModal } from '../../core';
import { Confirm } from '../../ui';
import { TM_PRESETS } from '../tm-presets';

const RULES_API = '/api/admin/generation';

/** A value inside the rules by its dotted path, e.g. "tickets.acMin". */
export const getPath = (from: Any, path: string) =>
  path.split('.').reduce((o: Any, k) => o?.[k], from);

function setPath(x: Any, path: string, v: Any) {
  const n = structuredClone(x);
  const keys = path.split('.');
  let o = n;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = v;
  return n;
}

/**
 * Test management: editing a field the chosen corporate standard sets makes the standard the
 * company's own ("custom").
 */
function setTestMgmt(x: Any, k: string, v: Any) {
  const preset = TM_PRESETS[x.testmgmt.standard];
  const leavesPreset = preset && preset[k] !== undefined && preset[k] !== v;
  return {
    ...x,
    testmgmt: { ...x.testmgmt, [k]: v, standard: leavesPreset ? 'custom' : x.testmgmt.standard },
  };
}

export function useGenerationRules() {
  const [data, setData] = useState<Any>(null);
  const [r, setR] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [prompts, setPrompts] = useState<Any>(null);
  const timer = useRef<Any>(null);

  /** Takes what the server answered: the saved rules, the defaults and the prompts. */
  const apply = (d: Any) => {
    setData(d);
    setR(d.rules);
    setPrompts(d.prompts);
  };
  const load = async () => {
    setErr(null);
    try {
      apply(await api(RULES_API));
    } catch (e: Any) {
      setErr(e);
    }
  };
  /** The prompts as the rules being edited would make them (nothing is saved). */
  const refreshPrompts = () => {
    if (!r) return;
    api(RULES_API, { method: 'PUT', body: { rules: r, preview: true } })
      .then((x) => setPrompts(x.prompts))
      .catch(() => {});
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Live preview of what the AI will be told, as you edit.
  useEffect(() => {
    if (!r || !data) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(refreshPrompts, 350);
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy('save');
    try {
      apply(await api(RULES_API, { method: 'PUT', body: { rules: r } }));
      toast('Generation rules saved. New generations follow them.');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const reset = () =>
    openModal(
      <Confirm
        title="Reset to the default rules?"
        label="Reset"
        text="Every generation rule goes back to its default. Tickets and test cases that were already generated don’t change."
        onYes={async () => {
          apply(await api(RULES_API, { method: 'DELETE' }));
          toast('Generation rules reset to the defaults');
        }}
      />,
    );
  return {
    data,
    r,
    err,
    busy,
    prompts,
    load,
    refreshPrompts,
    save,
    reset,
    discard: () => setR(data.rules),
    get: (path: string) => getPath(r, path),
    set: (path: string, v: Any) => setR((x: Any) => setPath(x, path, v)),
    setTm: (k: string, v: Any) => setR((x: Any) => setTestMgmt(x, k, v)),
    /** Picks a corporate standard: its preset values replace the test management fields. */
    pickStandard: (k: string) =>
      setR((x: Any) => ({
        ...x,
        testmgmt: { ...x.testmgmt, ...(TM_PRESETS[k] || {}), standard: k },
      })),
    dirty: Boolean(r && data) && JSON.stringify(r) !== JSON.stringify(data.rules),
    /** Whether any of these top-level rule groups has unsaved changes. */
    changed: (keys: string[]) =>
      keys.some((k) => JSON.stringify(r[k]) !== JSON.stringify(data.rules[k])),
  };
}
export type Rules = ReturnType<typeof useGenerationRules>;
