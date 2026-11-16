// API client for Administration (users, invites, roles, AI connection, email) and the "Your account" password change.
// The requests are exactly the ones the Admin screens used to build inline; the screens only call these functions.
import { api, type Any } from '../core';

/**
 * Everything the Administration page shows. Users and invites are the owner's alone (the server refuses them to other
 * administrators), so they are only asked for when `owner` is true. The AI settings may fail without failing the page.
 */
export async function loadAdminData(owner: boolean) {
  const [users, roles, invites, projects, email, ai] = await Promise.all([
    owner ? api('/api/admin/users') : [], api('/api/admin/roles'), owner ? api('/api/admin/invites') : [], api('/api/admin/projects'), api('/api/admin/email'),
    api('/api/admin/ai').catch(() => null),
  ]);
  return { users, roles, invites, projects, email, ai };
}

// ---------------------------------------------------------------- users
export const updateUser = (id: string, body: Any): Promise<Any> => api(`/api/admin/users/${id}`, { method: 'PATCH', body });
export const resetUserPassword = (id: string): Promise<Any> => api(`/api/admin/users/${id}/reset`, { method: 'POST', body: {} });
export const deleteUser = (id: string): Promise<Any> => api(`/api/admin/users/${id}`, { method: 'DELETE' });

// ---------------------------------------------------------------- invites
export const revokeInvite = (id: string): Promise<Any> => api(`/api/admin/invites/${id}`, { method: 'DELETE' });
export const resendInvite = (id: string): Promise<Any> => api(`/api/admin/invites/${id}/resend`, { method: 'POST', body: {} });
export const createInvites = (body: Any): Promise<Any> => api('/api/admin/invites', { method: 'POST', body });

// ---------------------------------------------------------------- roles
export const updateRole = (id: string, body: Any): Promise<Any> => api(`/api/admin/roles/${id}`, { method: 'PUT', body });
export const createRole = (body: Any): Promise<Any> => api('/api/admin/roles', { method: 'POST', body });
/** `replacement` is the role that takes over the people who had the deleted one. */
export const deleteRole = (id: string, replacement?: string): Promise<Any> => api(`/api/admin/roles/${id}${replacement !== undefined ? `?replacement=${encodeURIComponent(replacement)}` : ''}`, { method: 'DELETE' });

// ---------------------------------------------------------------- AI connection
export const getAiSettings = (fresh?: boolean): Promise<Any> => api(fresh ? '/api/admin/ai?fresh=1' : '/api/admin/ai');
export const saveAiSettings = (draft: Any): Promise<Any> => api('/api/admin/ai', { method: 'PUT', body: draft });
export const patchAiSettings = (body: Any): Promise<Any> => api('/api/admin/ai', { method: 'PATCH', body });
/** Runs an AI settings action: 'models' (list models), 'test' (check a connection) or 'reset'. */
export const aiAction = (body: Any): Promise<Any> => api('/api/admin/ai', { method: 'POST', body });
export const removeAiEntry = (entryId: string): Promise<Any> => api(`/api/admin/ai?id=${encodeURIComponent(entryId)}`, { method: 'DELETE' });

// ---------------------------------------------------------------- email and account
export const sendTestEmail = (): Promise<Any> => api('/api/admin/email/test', { method: 'POST', body: {} });
export const changePassword = (current: string, next: string): Promise<Any> => api('/api/auth/password', { method: 'POST', body: { current, next } });
