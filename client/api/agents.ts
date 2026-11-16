// API client for the Agents admin tab (/api/admin/agents). The screens only call these functions.
import { api, type Any } from '../core';

export const getAgents = (): Promise<Any> => api('/api/admin/agents');
export const saveAgents = (agents: Any): Promise<Any> => api('/api/admin/agents', { method: 'PUT', body: { agents } });
/** Runs an agents action: 'generate', 'check', 'save', 'copy', 'remove' (built-in ids), 'restore' or 'roles'. */
export const agentsAction = (body: Any): Promise<Any> => api('/api/admin/agents', { method: 'POST', body });
export const deleteAgent = (id: string): Promise<Any> => api(`/api/admin/agents?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
