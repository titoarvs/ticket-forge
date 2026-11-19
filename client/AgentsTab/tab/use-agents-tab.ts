'use client';
// The Agents page's state: loading the agents, saving one (or turning it on / off), the filters,
// the cards / list view (remembered on this device), and the agents to show.
import { useState, useEffect } from 'react';
import { type Any, toast } from '../../core';
import { getAgents, saveAgents } from '../../api/agents';
import { setAgentsCache } from '../../Agents';
import { type AgentFilter, NO_FILTER, agentMatches, isFiltering } from './filter';

const VIEW_KEY = 'tf.agents.view';

function savedView() {
  try {
    return localStorage.getItem(VIEW_KEY) || 'cards';
  } catch {
    return 'cards';
  }
}

function saveView(v: string) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* storage off */
  }
}

/** Every agent's settings as the server takes them, with this one's replaced. */
function settingsWith(agents: Any[], id: string, v: Any) {
  const all: Any = {};
  for (const a of agents)
    all[a.id] = {
      enabled: a.enabled,
      model: a.model,
      effort: a.effort,
      instructions: a.instructions,
    };
  all[id] = v;
  return all;
}

export function useAgentsTab() {
  const [data, setData] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [filter, setFilterState] = useState<AgentFilter>(NO_FILTER);
  const [view, setViewState] = useState<string>(savedView);
  const [busy, setBusy] = useState('');
  const onData = (d: Any) => {
    setData(d);
    setAgentsCache(d);
  };
  const load = async () => {
    setErr(null);
    try {
      onData(await getAgents());
    } catch (e: Any) {
      setErr(e);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const save = async (id: string, v: Any, quiet = false) => {
    try {
      onData(await saveAgents(settingsWith(data.agents, id, v)));
      if (!quiet) toast('Agent saved');
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };
  const toggle = async (a: Any, on: boolean) => {
    setBusy(a.id);
    const v = { enabled: on, model: a.model, effort: a.effort, instructions: a.instructions };
    await save(a.id, v, true);
    setBusy('');
    toast(`${a.name} turned ${on ? 'on' : 'off'}`);
  };
  const setFilter = (patch: Partial<AgentFilter>) => setFilterState({ ...filter, ...patch });
  const setView = (v: string) => {
    setViewState(v);
    saveView(v);
  };
  const all: Any[] = data?.agents || [];
  return {
    data,
    err,
    load,
    onData,
    save,
    toggle,
    busy,
    filter,
    setFilter,
    clearFilter: () => setFilterState(NO_FILTER),
    filtering: isFiltering(filter),
    view,
    setView,
    all,
    list: all.filter((a: Any) => agentMatches(a, filter)),
  };
}

export type AgentsPage = ReturnType<typeof useAgentsTab>;
