import { api, perm, body, HttpError } from '@/lib/server/http';
import { providerStatus, accountStatus, testConnection, listModels, PROVIDERS } from '@/lib/claude.js';
import { saveAiSettings, clearAiSettings } from '@/lib/settings.js';

// AI connection for administrators: status, the API setup saved in this panel, tests and model lists.

/** Checks a provider / model / endpoint / key typed in the panel. */
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
  return { provider, model, baseUrl, apiKey };
}

export const GET = api(async (req) => {
  await perm('users.manage');
  if (new URL(req.url).searchParams.get('fresh')) await accountStatus({ fresh: true });
  return providerStatus({ details: true });
});

// { action: 'test' } tests what's in use; { action: 'test', draft } or { action: 'models', draft } use unsaved settings.
export const POST = api(async (req) => {
  await perm('users.manage');
  const b = await body(req);
  const d = b.draft ? draft(b.draft) : undefined;
  if (b.action === 'models') return { models: await listModels(d) };
  return testConnection(d);
});

// Saves the AI API setup. A blank apiKey keeps the saved key (same provider and endpoint only).
export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  await saveAiSettings(user, { ...draft(b), clearKey: Boolean(b.clearKey) });
  return providerStatus({ details: true });
});

// Removes the panel's setup; environment variables (if any) apply again.
export const DELETE = api(async () => {
  await perm('users.manage');
  await clearAiSettings();
  return providerStatus({ details: true });
});
