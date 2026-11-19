'use client';
// The dialogs the Agents page opens: an agent's details, hiring it, creating an agent, and the
// built-in agents.
import { type Any, openModal } from '../../core';
import { HireModal, AgentDetails } from '../AgentDetails';
import { CustomAgentModal } from '../CustomAgentModal';
import { BuiltInsModal } from '../BuiltInsModal';
import type { AgentsPage } from './use-agents-tab';

export const hire = (a: Any) => openModal(<HireModal a={a} />);

/** Testing agents and broken ones can't be hired. */
export const hireFor = (a: Any) => (a.runner === 'testing' || a.broken ? undefined : () => hire(a));

export const openDetails = (g: AgentsPage, a: Any) =>
  openModal(
    <AgentDetails a={a} data={g.data} onSave={g.save} onHire={() => hire(a)} onData={g.onData} />,
  );

/** start: '__repo' opens on the Repo-native Builder template. */
export const openCreate = (g: AgentsPage, start?: string) =>
  openModal(<CustomAgentModal onSaved={g.onData} builtIns={g.data.builtIns} start={start} />);

export const openBuiltIns = (g: AgentsPage) =>
  openModal(<BuiltInsModal data={g.data} onData={g.onData} />);
