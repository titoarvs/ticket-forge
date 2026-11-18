// App context: one compact Markdown "app knowledge" document per project (what the product is, its users and roles,
// its modules and pages with their real actions and fields, domain rules, data and integrations), built once from the
// code and documents and stored on the project. Every AI prompt for the project includes it, so the AI knows the app
// without re-reading the code each time, and because it's the same text on every call, prompt caching makes it cheap.
// Rebuild it when the code changes (the project remembers the commit it was built from).
import { askAI } from './claude';
import { codeInventory } from './codeinventory';
import { readRepo, featureDocs } from './reposync';
import { localReader } from './codebase';
import { schemaBlock } from './dbschema';

const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const CONTEXT_MAX = 12000;

/**
 * The block added to system prompts: the app context, then the database schema (Project settings → Database), each
 * left out when the project has none. Stable text: good for prompt caching.
 */
export function contextBlock(project, { short = false }: any = {}) {
  return appContextBlock(project, { short }) + schemaBlock(project, { short });
}
function appContextBlock(project, { short = false }: any = {}) {
  let md = String(project?.appContext?.md || '').trim();
  // Light jobs (questions, failure notes, test selection) get the start of the brief only: what the app is, and its
  // users and roles. The rest is ~10k characters they rarely need.
  if (short && md) { const cut = md.search(/\n##\s+Modules/i); md = cut > 0 ? md.slice(0, cut).trim() : clip(md, 2500); }
  return md ? `\n\nAPP CONTEXT for "${project.name}" (what this app is and how it works; trust it over guesses, and use its exact names for pages, roles and fields):\n${clip(md, CONTEXT_MAX)}` : '';
}

/** Builds the app context from the code (when a local repository is set) and the project. Returns { md, sha, sources }. */
export async function buildAppContext({ project, dir = '', backendDir = '', ai = {}, emit = (_m) => {} }: any) {
  let code = '', sha = null, sources = { pages: 0, endpoints: 0, models: 0, docs: 0, issues: project.tickets?.length || 0 };
  if (dir) {
    emit('Reading the code: pages, endpoints, data models…');
    const repo = await readRepo(dir, null);
    sha = repo.head;
    const inv = await codeInventory({ root: repo.root, pages: repo.pages, backendDir });
    const files = await localReader(dir).list();
    const docs = await featureDocs(repo.root, files, 15000);
    sources = { ...sources, pages: inv.counts.pages, endpoints: inv.counts.endpoints, models: inv.counts.models, docs: docs.length };
    code = `PAGES (route, files, what each page shows: headings, actions, fields, calls):\n${clip(inv.pagesText, 40000)}\n\n${clip(inv.endpointsText, 15000)}\n\n${clip(inv.modelsText, 4000)}\n\nDOCUMENTS (hints):\n${docs.map((d) => `### ${d.file}\n${clip(d.text, 1200)}`).join('\n\n')}`;
  }
  const epics = (project.epics || []).map((e) => `- ${e.key} ${e.title}${e.description ? `: ${clip(e.description, 200)}` : ''}`).join('\n');
  const issues = (project.tickets || []).filter((t) => !t.parentId).slice(0, 150).map((t) => `${t.key} ${clip(t.title, 90)}`).join('; ');
  const roles = (project.automation?.app?.roles || []).map((r) => r.name).join(', ');
  emit('AI is writing the app context…');
  const md = await askAI({ ...ai, task: 'repo', reasoning: 'fast', system: `You write a compact "app knowledge" brief that other AI agents will read before every task on this app
(writing tickets and test cases, Playwright scripts, code reviews). Facts only, from the material given; mark unknowns as [unknown].
Use the app's exact names for pages, buttons, fields, roles and statuses. Dense bullet points, no prose padding.
Output GitHub Markdown with these sections, in order:
# <App name>
## What it is (2-3 lines)
## Users and roles (who, what each can do)
## Modules (one bullet per area: its pages (routes), main actions and key fields)
## Business rules and glossary (domain terms, calculations, statuses, validations)
## Data (main entities and how they relate)
## Integrations and APIs (main endpoint groups, external systems)
## Conventions (sign-in, navigation, UI patterns tests and scripts should know)
Keep the whole brief under ${Math.round(CONTEXT_MAX / 6)} words.`,
    prompt: `APP: ${project.name}${project.key ? ` (${project.key})` : ''}
Summary: ${clip(project.summary || project.description, 1500) || 'n/a'}
Roles set up for testing: ${roles || 'n/a'}
Application URL: ${project.automation?.baseUrl || 'n/a'}

EPICS:
${clip(epics, 6000) || '(none)'}

ISSUES (keys and titles): ${clip(issues, 9000) || '(none)'}

SOURCE DOCUMENT (start): ${clip(project.sourceText, 6000) || '(none)'}
${code ? `\n=== FROM THE CODE ===\n${code}` : '\n(No local repository: write from the project data only.)'}` });
  const fence = md.match(/```(?:markdown|md)?\s*([\s\S]*?)```\s*$/);
  const out = (fence ? fence[1] : md).trim();
  return { md: clip(out, CONTEXT_MAX), sha, sources, chars: out.length, at: new Date().toISOString() };
}
