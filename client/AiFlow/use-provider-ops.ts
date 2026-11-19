'use client';
// What you can do to an AI provider on the canvas: change the fallback order, turn it on or off,
// test it, and retry one that is cooling down.
import { useState } from 'react';
import { type Any, api, toast } from '../core';
import type { FlowActions } from './model';
import type { Graph } from './graph';

export function useProviderOps(
  actions: FlowActions,
  g: Graph,
  patch: (body: Any) => Promise<void>,
) {
  const [tests, setTests] = useState<Record<string, Any>>({});
  const [busy, setBusy] = useState('');

  /**
   * Makes `toId` the fallback right after `fromId`. Only providers set up in this panel can move:
   * your own AI always goes first and providers from environment variables always come last.
   */
  const setFallback = async (fromId: string, toId: string) => {
    const b = g.byId[toId];
    if (b.kind !== 'provider' || b.data.source !== 'panel') {
      toast(
        b.kind === 'local'
          ? 'Your own AI always goes first.'
          : 'Providers set with environment variables always come after the ones set up here.',
      );
      return;
    }
    const a = g.byId[fromId];
    const panelIds = g.apis.filter((x) => x.source === 'panel').map((x) => x.entryId);
    const ids = panelIds.filter((x) => x !== b.data.entryId);
    let at = 0;
    if (a.kind === 'provider' && a.data.source === 'panel') at = ids.indexOf(a.data.entryId) + 1;
    else if (a.kind === 'provider') at = ids.length;
    ids.splice(at, 0, b.data.entryId);
    await patch({ order: ids });
    toast(`${b.data.label} now follows ${a.kind === 'local' ? 'your own AI' : a.data.label}`);
  };
  const toggleProvider = async (x: Any, on: boolean) => {
    setBusy(`on:${x.entryId}`);
    await patch({ id: x.entryId, enabled: on });
    setBusy('');
  };
  const testNode = async (id: string) => {
    const n = g.byId[id];
    setBusy(`test:${id}`);
    setTests((t) => ({ ...t, [id]: { running: true } }));
    try {
      const res = await api('/api/admin/ai', {
        method: 'POST',
        body: n.kind === 'provider' ? { action: 'test', id: n.data.entryId } : { action: 'test' },
      });
      setTests((t) => ({ ...t, [id]: res }));
      actions.onSaved(await api('/api/admin/ai'));
    } catch (e: Any) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: e.message } }));
    } finally {
      setBusy('');
    }
  };
  const retry = async (x: Any) => {
    setBusy(`retry:${x.entryId}`);
    try {
      actions.onSaved(
        await api('/api/admin/ai', { method: 'POST', body: { action: 'reset', id: x.entryId } }),
      );
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const clearCooldowns = async () => {
    setBusy('reset');
    try {
      actions.onSaved(await api('/api/admin/ai', { method: 'POST', body: { action: 'reset' } }));
    } finally {
      setBusy('');
    }
  };
  return { tests, busy, setFallback, toggleProvider, testNode, retry, clearCooldowns };
}
export type ProviderOps = ReturnType<typeof useProviderOps>;
