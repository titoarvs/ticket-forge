import { api, perm, body, HttpError } from '@/lib/server/http';
import { providerStatus, accountStatus, testConnection, listModels, clearCooldown, PROVIDERS } from '@/lib/claude.js';
import { saveAiProvider, removeAiProvider, reorderAiProviders, setAiOptions } from '@/lib/settings.js';

// AI for administrators: status, the list of AI APIs (in priority order), tests, model lists and cooldowns.

/** Checks a provider / model / endpoint / key typed in the panel. `id` = the saved provider being edited. */
function draft(b: any) {
  const provider = String(b?.provider || '');
  if (!(PROVIDERS as any)[provider]) throw new HttpError(400, 'Pick a provider.');
  const model = String(b?.model || '').trim();
  const baseUrl = String(b?.baseUrl || '').trim();
  const apiKey = String(b?.apiKey || '').trim();
  if (model.length > 200) throw new HttpError(400, 'That model name is too long.');
  if (apiKey.length > 1000) throw new HttpError(400, 'That API key is too long.');
  if (baseUrl) {
    let u: URL;
    try { u = new URL(baseUrl); } catch { throw new HttpError(400, 'The endpoint must be a full URL, like https://api.example.com/v1'); }
    if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'The endpoint must start with https:// (or http:// for a local server).');
  }
  return { id: b?.id ? String(b.id) : undefined, provider, model, baseUrl, apiKey };
}
const status = () => providerStatus({ details: true });

export const GET = api(async (req) => {
  await perm('users.manage');
  if (new URL(req.url).searchParams.get('fresh')) await accountStatus({ fresh: true });
  return status();
});

// { action: 'test' | 'models', id?: saved provider, draft?: unsaved settings } · { action: 'reset', id? } clears a cooldown.
export const POST = api(async (req) => {
  await perm('users.manage');
  const b = await body(req);
  const target = b.draft ? { draft: draft(b.draft) } : b.id ? { id: String(b.id) } : undefined;
  if (b.action === 'models') return { models: await listModels(target) };
  if (b.action === 'reset') { clearCooldown(b.id ? String(b.id) : undefined); return status(); }
  return testConnection(target);
});

// Adds a provider (no id) or updates one. A blank apiKey keeps the saved key (same provider and endpoint only).
export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  const d = draft(b);
  await saveAiProvider(user, { ...d, enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined });
  if (d.id) clearCooldown(d.id);
  return status();
});

// { order: [ids] } · { id, enabled } · { accountFallback }
export const PATCH = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  if (Array.isArray(b.order)) await reorderAiProviders(user, b.order.map(String));
  if (b.id || typeof b.accountFallback === 'boolean' || b.localEngine || typeof b.copilotModel === 'string' || typeof b.copilotBackup === 'boolean') await setAiOptions(user, { id: b.id ? String(b.id) : undefined, enabled: b.enabled, accountFallback: b.accountFallback, localEngine: b.localEngine, copilotModel: b.copilotModel, copilotBackup: b.copilotBackup });
  return status();
});

export const DELETE = api(async (req) => {
  const user = await perm('users.manage');
  const id = new URL(req.url).searchParams.get('id');
  if (!id) throw new HttpError(400, 'Which provider?');
  await removeAiProvider(user, id);
  clearCooldown(id);
  return status();
});
