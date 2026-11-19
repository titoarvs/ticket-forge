'use client';
// The routing settings shown on the canvas (which task runs on which tier, the models per tier) and
// saving them. Every change is saved straight away, except model names, which wait for Save.
import { useState, useEffect } from 'react';
import { type Any, api, toast } from '../core';
import type { FlowActions } from './model';
import { TIER } from './model';
import { type Graph, targetOf } from './graph';

export function useRouting(c: Any, actions: FlowActions, g: Graph) {
  const saved = c.settings?.routing;
  const savedKey = JSON.stringify(saved);
  const [r, setR] = useState<Any>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setR(JSON.parse(savedKey || 'null'));
  }, [savedKey]);

  /** Shows the change at once and puts it back when saving fails. */
  const patchRouting = async (next: Any, msg?: string) => {
    const prev = r;
    setR(next);
    setSaving(true);
    try {
      actions.onSaved(await api('/api/admin/ai', { method: 'PATCH', body: { routing: next } }));
      if (msg) toast(msg);
    } catch (e: Any) {
      setR(prev);
      toast(e.message, 'err');
    } finally {
      setSaving(false);
    }
  };
  /** Any other AI setting (provider order, switches). */
  const patch = async (body: Any) => {
    setSaving(true);
    try {
      actions.onSaved(await api('/api/admin/ai', { method: 'PATCH', body }));
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setSaving(false);
    }
  };
  const setTaskTier = (taskId: string, target: string) => {
    const task = g.tasks.find((t) => t.id === taskId);
    if ((r.tiers?.[taskId] || task?.tier) === target) return;
    const name = /^cfg:/.test(target)
      ? g.configs.find((x) => `cfg:${x.id}` === target)?.name
      : TIER[target]?.label;
    patchRouting(
      { ...r, tiers: { ...r.tiers, [taskId]: target } },
      `${task?.label} now runs on ${name}`,
    );
  };
  /** Back to the task's default tier. */
  const resetTask = (taskId: string) => {
    const task = g.tasks.find((x) => x.id === taskId);
    if (task) setTaskTier(taskId, task.tier);
  };
  const setRouting = (on: boolean) =>
    patchRouting({ ...r, enabled: on }, on ? 'Model routing is on' : 'Model routing is off');

  return {
    r,
    setR,
    savedKey,
    saving,
    on: r?.enabled !== false,
    dirty: Boolean(r) && JSON.stringify(r) !== savedKey,
    patchRouting,
    patch,
    setTaskTier,
    resetTask,
    setRouting,
    runsOn: (task: Any) => targetOf(r, task),
  };
}
export type Routing = ReturnType<typeof useRouting>;
