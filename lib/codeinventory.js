// What the code itself says is built, without AI: for each page, the headings, buttons, form fields and API calls in
// its files; the API endpoints (Next.js route handlers, Express / Fastify / Hono routers, NestJS controllers, Laravel
// and Django routes); and the data models (Prisma, Drizzle, TypeORM, Sequelize, Mongoose, SQL migrations, Django).
// "Find built features" works from this inventory; documents only help name things.
import fs from 'node:fs/promises';
import path from 'node:path';
import { localReader } from './codebase.js';

const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const uniq = (xs, n) => [...new Set(xs.map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x && x.length > 1 && x.length < 90 && !/[{}<>=;]|^\W+$/.test(x)))].slice(0, n);
const CODE_EXT = /\.(tsx?|jsx?|vue|svelte|mjs|cjs|php|py|rb|go|java|kt|cs)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|\.next|coverage|test-results|playwright-report|vendor|__tests__|__mocks__)\/|\.(test|spec|stories|d)\.[tj]sx?$/i;

/** UI facts in one file's source: headings, button and link texts, field labels, API calls, permission checks. */
function uiFacts(text) {
  const all = (re, g = 1) => [...text.matchAll(re)].map((m) => m[g]);
  return {
    headings: uniq([...all(/<(?:h[1-3]|CardTitle|DialogTitle|SheetTitle|PageHeader|PageTitle|Title)\b[^>]*>\s*([^<{]+?)\s*</g), ...all(/\b(?:title|heading|pageTitle)\s*[:=]\s*\{?\s*["'`]([^"'`{}$]{3,80})["'`]/g)], 12),
    actions: uniq([...all(/<(?:Button|button|Link|a|DropdownMenuItem|MenuItem|Tab|TabsTrigger)\b[^>]*>\s*(?:<[^>]+>\s*)*([A-Za-z][^<{]{1,60}?)\s*</g)], 20),
    fields: uniq([...all(/<(?:Label|label|FormLabel)\b[^>]*>\s*([^<{]+?)\s*</g), ...all(/\b(?:label|placeholder)\s*[:=]\s*\{?\s*["'`]([^"'`{}$]{2,60})["'`]/g)], 20),
    api: uniq([...all(/["'`]((?:\/api)?\/[a-z0-9_\-/:${}.]+)["'`]/gi).filter((x) => /\/api\/|^\/(v\d|[a-z-]+\/[a-z-:${}]+)/i.test(x) && !/\.(png|svg|jpe?g|css|js)$/.test(x))
      .map((x) => x.replace(/\$\{[^}]+\}/g, ':id'))], 15),
    perms: uniq(all(/\b(?:can|hasPermission|hasRole|requireRole|usePermission|checkPermission)\(\s*["'`]([^"'`]+)["'`]/g), 8),
  };
}
const factsText = (f) => [f.headings.length && `headings: ${f.headings.join(' | ')}`, f.actions.length && `actions: ${f.actions.join(' | ')}`,
  f.fields.length && `fields: ${f.fields.join(' | ')}`, f.api.length && `links & calls: ${f.api.join(', ')}`, f.perms.length && `permissions: ${f.perms.join(', ')}`].filter(Boolean).join('; ');

/** Endpoints in one file. */
function endpoints(file, text) {
  const out = [];
  // Next.js App Router route handlers: app/api/x/[id]/route.ts → GET /api/x/:id
  const m = file.match(/(?:^|\/)app\/(.*?)\/route\.[tj]sx?$/);
  if (m) {
    const route = `/${m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).map((s) => s.replace(/^\[\.{0,3}(.+?)\]$/, ':$1')).join('/')}`;
    for (const v of text.matchAll(/export\s+(?:const|async function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) out.push(`${v[1]} ${route}`);
  }
  // Next.js pages/api
  const pm = file.match(/(?:^|\/)pages\/(api\/.*?)\.[tj]sx?$/);
  if (pm) out.push(`ANY /${pm[1].replace(/\/index$/, '').replace(/\[(.+?)\]/g, ':$1')}`);
  // Express / Fastify / Hono / Koa routers
  for (const v of text.matchAll(/\b(?:router|app|server|api|route|r)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)) out.push(`${v[1].toUpperCase()} ${v[2]}`);
  // NestJS
  const base = text.match(/@Controller\(\s*["'`]([^"'`]*)["'`]/)?.[1];
  if (base !== undefined || /@Controller\(\s*\)/.test(text)) {
    for (const v of text.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/g)) out.push(`${v[1].toUpperCase()} /${[base, v[2]].filter(Boolean).join('/').replace(/\/+/g, '/')}`);
  }
  // Laravel / Django
  for (const v of text.matchAll(/Route::(get|post|put|patch|delete|resource|apiResource)\(\s*['"]([^'"]+)['"]/g)) out.push(`${v[1].toUpperCase()} /${v[2].replace(/^\//, '')}`);
  for (const v of text.matchAll(/\b(?:re_)?path\(\s*r?['"]\^?([^'"]*)['"]/g)) if (/urls\.py$/.test(file)) out.push(`ANY /${v[1]}`);
  return out;
}
/** Data models in one file. */
function models(file, text) {
  const out = [];
  if (/\.prisma$/.test(file)) for (const v of text.matchAll(/^model\s+(\w+)\s*\{/gm)) out.push(v[1]);
  for (const v of text.matchAll(/\b(?:pgTable|mysqlTable|sqliteTable)\(\s*["'`](\w+)["'`]/g)) out.push(v[1]);
  for (const v of text.matchAll(/@Entity\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g)) out.push(v[1]);
  for (const v of text.matchAll(/\bmodel\(\s*["'`](\w+)["'`]\s*,/g)) out.push(v[1]);
  for (const v of text.matchAll(/sequelize\.define\(\s*["'`](\w+)["'`]/g)) out.push(v[1]);
  if (/\.sql$/i.test(file) || /migrations?\//i.test(file)) for (const v of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?(?:\w+\.)?(\w+)/gi)) out.push(v[1]);
  if (/models\.py$/.test(file)) for (const v of text.matchAll(/^class\s+(\w+)\(.*models\.Model\)/gm)) out.push(v[1]);
  return out;
}

/** One repository's endpoints and models (frontend or backend). */
async function serverSide(dir, files, read) {
  const eps = [], mods = new Map();
  const cands = files.filter((f) => !SKIP.test(f) && (CODE_EXT.test(f) || /\.(prisma|sql)$/i.test(f))
    && /(api|route|router|controller|server|handler|endpoint|model|entity|schema|migration|db|prisma|urls\.py|web\.php|api\.php)/i.test(f)).slice(0, 1500);
  for (const f of cands) {
    let text = '';
    try { text = await read(f); } catch { continue; }
    for (const e of endpoints(f, text)) eps.push({ e, file: f });
    for (const m of models(f, text)) if (!mods.has(m)) mods.set(m, f);
  }
  const seen = new Set();
  return { endpoints: eps.filter((x) => (seen.has(x.e) ? false : seen.add(x.e))).slice(0, 900), models: [...mods].map(([name, file]) => ({ name, file })).slice(0, 200), dir };
}

/**
 * The code inventory: pages with their UI facts, and the endpoints and models of the repository (and the backend
 * repository when the project has one). Returns texts for the prompt plus lookups to check the AI's citations.
 */
export async function codeInventory({ root, pages, backendDir = '' }) {
  const read = (f) => fs.readFile(path.join(root, f), 'utf8');
  const pageFacts = [];
  for (const p of pages) {
    const own = [p.file, ...(p.depFiles || []).filter((f) => f !== p.file && /components|features|views|pages|screens|modules|routes|app\//.test(f) && !/components\/ui\//.test(f))].filter(Boolean).slice(0, 6);
    const merged = { headings: [], actions: [], fields: [], api: [], perms: [] };
    for (const f of own) {
      let text = '';
      try { text = await read(f); } catch { continue; }
      const x = uiFacts(text);
      for (const k of Object.keys(merged)) merged[k].push(...x[k]);
    }
    for (const k of Object.keys(merged)) merged[k] = uniq(merged[k], k === 'actions' || k === 'fields' ? 18 : 12);
    pageFacts.push({ path: p.path, name: p.name, files: own, facts: merged });
  }
  const local = localReader(root);
  const front = await serverSide(root, await local.list(), (f) => local.read(f));
  let back = null;
  if (backendDir) {
    try { const br = localReader(backendDir); back = await serverSide(br.label, await br.list(), (f) => br.read(f)); } catch (e) { back = { error: e.message, endpoints: [], models: [] }; }
  }
  // Grouped by file (controller / route module), so hundreds of endpoints stay compact.
  const epText = (s, label) => {
    if (!s?.endpoints?.length) return '';
    const by = new Map();
    for (const x of s.endpoints) { if (!by.has(x.file)) by.set(x.file, []); by.get(x.file).push(x.e); }
    return `${label} (${s.endpoints.length}):\n${[...by].map(([f, es]) => `- ${f}: ${es.join(', ')}`).join('\n')}`;
  };
  const modText = (s, label) => (s?.models?.length ? `${label}: ${s.models.map((m) => m.name).join(', ')}` : '');
  const known = new Set([...pages.map((p) => p.path), ...pageFacts.flatMap((p) => p.files),
    ...[front, back].filter(Boolean).flatMap((s) => [...s.endpoints.map((x) => x.e), ...s.endpoints.map((x) => x.e.split(' ')[1]), ...s.endpoints.map((x) => x.file), ...s.models.map((m) => m.name), ...s.models.map((m) => m.file)])]);
  return {
    pagesText: pageFacts.map((p) => `- ${p.path} (${p.name}) [${p.files.join(', ')}]${factsText(p.facts) ? `\n    ${factsText(p.facts)}` : ''}`).join('\n'),
    endpointsText: [epText(front, 'Endpoints in this repository'), epText(back, `Endpoints in the backend repository (${back?.dir || backendDir})`)].filter(Boolean).join('\n\n'),
    modelsText: [modText(front, 'Data models in this repository'), modText(back, 'Data models in the backend repository')].filter(Boolean).join('\n'),
    counts: { pages: pageFacts.length, endpoints: front.endpoints.length + (back?.endpoints.length || 0), models: front.models.length + (back?.models.length || 0), backend: Boolean(back && !back.error), backendError: back?.error || null },
    pageFacts, known,
    /** Is this citation something the code really has? (a page path, a file, an endpoint, a model) */
    isCode: (s) => {
      const x = String(s || '').trim();
      if (!x || /\.mdx?$/i.test(x) || /^[0-9a-f]{7,40}$/i.test(x)) return false;
      if (known.has(x)) return true;
      const pathOnly = x.replace(/^(GET|POST|PUT|PATCH|DELETE|ANY)\s+/i, '');
      return known.has(pathOnly) || (x.length > 4 && [...known].some((k) => k.length > 4 && (k.endsWith(x) || x.endsWith(k))));
    },
  };
}
export const _test = { uiFacts, endpoints, models, clip };
