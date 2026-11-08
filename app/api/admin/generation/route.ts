import { api, perm, body } from '@/lib/server/http';
import { getRules, saveRules, resetRules, rulesMeta, rulesText, normalizeRules, DEFAULT_RULES } from '@/lib/genrules.js';

// Administration → Generation: the team's standard for generated tickets, test cases and scripts.
const view = async (rules: any) => ({
  rules, defaults: normalizeRules(DEFAULT_RULES), meta: await rulesMeta(),
  preview: { tickets: rulesText(rules, 'tickets'), tests: rulesText(rules, 'tests'), automation: rulesText(rules, 'automation') },
});

export const GET = api(async () => { await perm('users.manage'); return view(await getRules({ fresh: true })); });
// { rules, preview: true } only shows what the AI would be told, without saving.
export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  if (b.preview) { const r = normalizeRules(b.rules); return { preview: { tickets: rulesText(r, 'tickets'), tests: rulesText(r, 'tests'), automation: rulesText(r, 'automation') } }; }
  return view(await saveRules(user, b.rules || {}));
});
export const DELETE = api(async () => { await perm('users.manage'); return view(await resetRules()); });
