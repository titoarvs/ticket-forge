'use client';
// The model routing settings being edited (one draft shared by every part of the page): editing,
// saving, resetting, one-click changes from the usage report, and the model a tier means now.
import { useState } from 'react';
import { type Any, toast, api, openModal } from '../../core';
import { Confirm } from '../../ui';
import { PRESETS } from '../presets';

const patch = (routing: Any) => api('/api/admin/ai', { method: 'PATCH', body: { routing } });

export function useRoutingDraft(c: Any, onSaved: (st: Any) => void) {
  const saved = c.settings?.routing;
  const [r, setR] = useState<Any>(() => structuredClone(saved));
  const [busy, setBusy] = useState('');
  const tasks: Any[] = c.tasks || [];
  const apis: Any[] = (c.apis || []).filter((x: Any) => x.entryId);

  /** Runs a server change with a busy marker; errors become a message. */
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  /** Takes the saved settings the server answered with. */
  const took = (st: Any, msg: string) => {
    onSaved(st);
    setR(structuredClone(st.settings.routing));
    toast(msg);
  };
  const save = () =>
    run('save', async () =>
      took(await patch(r), 'Model routing saved. New AI work uses it right away.'),
    );
  const reset = () =>
    openModal(
      <Confirm
        title="Reset model routing?"
        label="Reset"
        text="Every task goes back to its default tier, and every tier to its default model."
        onYes={() =>
          run('reset', async () => took(await patch(null), 'Model routing reset to the defaults'))
        }
      />,
    );
  /** One-click changes from the usage report: saved at once, on top of what's saved. */
  const apply = async (change: Any, msg: string) => {
    onSaved(await patch({ ...saved, ...change }));
    setR((x: Any) => ({ ...x, ...change }));
    toast(msg);
  };
  const clearCache = () =>
    run('cclear', async () =>
      onSaved(await api('/api/admin/ai', { method: 'POST', body: { action: 'cache-clear' } })),
    );

  /** The model a tier uses now: Claude Code agents use the Claude account; otherwise the main AI. */
  const modelFor = (tier: string, agent = false) => {
    if (agent) return r.claude[tier] || c.claudeTiers?.[tier];
    if (c.mode === 'account') {
      if (c.localEngine === 'copilot')
        return r.copilot[tier] || c.copilotModel || 'Copilot default';
      return r.claude[tier] || c.claudeTiers?.[tier];
    }
    const a = apis.find((x) => x.active) || apis[0];
    return a ? r.api[a.entryId]?.[tier] || a.model : '';
  };
  /** The preset the current tiers match, if any. */
  const preset = r
    ? PRESETS.find(
        (p) => tasks.every((t) => r.tiers[t.id] === p.tiers(t)) && (!p.escalate || r.escalate),
      )?.key
    : undefined;
  return {
    saved,
    r,
    setR,
    busy,
    tasks,
    apis,
    preset,
    dirty: JSON.stringify(r) !== JSON.stringify(saved),
    off: !r?.enabled,
    save,
    reset,
    apply,
    clearCache,
    modelFor,
    discard: () => setR(structuredClone(saved)),
    setTier: (id: string, v: string) =>
      setR((x: Any) => ({ ...x, tiers: { ...x.tiers, [id]: v } })),
    /** Sets the model of a tier on the Claude account, Copilot, or (with entry) an AI API. */
    setModel: (ai: string, tier: string, v: string, entry?: string) =>
      setR((x: Any) => {
        const n = structuredClone(x);
        if (entry)
          n.api[entry] = { high: '', standard: '', light: '', ...(n.api[entry] || {}), [tier]: v };
        else n[ai][tier] = v;
        return n;
      }),
    pickPreset: (p: (typeof PRESETS)[number]) =>
      setR((x: Any) => ({
        ...x,
        tiers: Object.fromEntries(tasks.map((t) => [t.id, p.tiers(t)])),
        escalate: Boolean(p.escalate),
      })),
  };
}
export type RoutingDraft = ReturnType<typeof useRoutingDraft>;
