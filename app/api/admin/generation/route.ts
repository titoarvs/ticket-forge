import { api, perm, body } from '@/lib/server/http';
import { getRules, getGuide, saveRules, resetRules, rulesMeta, rulesText, normalizeRules, DEFAULT_RULES } from '@/lib/genrules';
import { SYSTEM_BA, systemWith } from '@/lib/prompts';
import { automationSystem, SCRIPT_BASE } from '@/lib/automation';

// Administration → Generation: the team's standard for generated tickets, test cases and scripts.

/** Exactly what the AI is told for each kind of generation, as sections and as the full text. */
async function prompts(rules: any) {
  const guide = await getGuide();
  const g = (parts: string[]) => (guide && parts.some((p) => guide.applyTo?.[p]) ? { name: guide.name, text: guide.text, chars: guide.chars } : null);
  const one = (title: string, when: string, parts: string[]) => ({
    title, when, base: SYSTEM_BA, standards: [...new Set(parts.flatMap((p) => rulesText(rules, p).split('\n')).filter(Boolean))].join('\n'), guide: g(parts), text: systemWith(rules, parts, guide),
  });
  return {
    tickets: one('Writing tickets', 'Creating a project from a document, and Add feature.', ['tickets']),
    tests: one('Writing test cases', 'Test cases for a new project or feature, and “Write test cases” in the backlog.', ['tests']),
    actions: one('Improving an issue', 'Enhance, Improve acceptance criteria, Regenerate test cases, Split, and Write issue with AI.', ['tickets', 'tests']),
    automation: { title: 'Writing automation scripts', when: 'When a test runs without a script, or “Rewrite with AI”.', base: SCRIPT_BASE(),
      standards: rulesText(rules, 'automation'), guide: g(['automation']), text: automationSystem(rules, guide) },
  };
}
const view = async (rules: any) => ({
  rules, defaults: normalizeRules(DEFAULT_RULES), meta: await rulesMeta(),
  preview: { tickets: rulesText(rules, 'tickets'), tests: rulesText(rules, 'tests'), automation: rulesText(rules, 'automation') },
  prompts: await prompts(rules),
});

export const GET = api(async () => { await perm('users.manage'); return view(await getRules({ fresh: true })); });
// { rules, preview: true } only shows what the AI would be told, without saving.
export const PUT = api(async (req) => {
  const user = await perm('users.manage');
  const b = await body(req);
  if (b.preview) { const r = normalizeRules(b.rules); return { preview: { tickets: rulesText(r, 'tickets'), tests: rulesText(r, 'tests'), automation: rulesText(r, 'automation') }, prompts: await prompts(r) }; }
  return view(await saveRules(user, b.rules || {}));
});
export const DELETE = api(async () => { await perm('users.manage'); return view(await resetRules()); });
