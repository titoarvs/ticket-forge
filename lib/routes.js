// Finds a web app's page routes from its source code, for Test automation → App setup.
// File-based routing: Next.js (app/ and pages/), SvelteKit, Nuxt, Remix / React Router framework mode, Astro,
// TanStack Router / TanStack Start (src/routes, checked against its generated routeTree.gen.ts).
// Router config: React Router (JSX and objects), Vue Router, Angular. Server: Laravel, Django, Rails.
// Dynamic segments become :params, e.g. /orders/:id. API routes are left out.

const join = (...parts) => (`/${parts.filter((p) => p !== null && p !== undefined && p !== '').join('/')}`).replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
const ext = (f) => (f.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const isApi = (p) => /^\/api(\/|$)/.test(p);
const dirOf = (f) => f.split('/').slice(0, -1);

/** A readable page name from a path: /orders/:id → "Orders (id)". */
export function nameForPath(p, hint) {
  if (hint && String(hint).trim()) return String(hint).trim().replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const segs = p.split('/').filter(Boolean);
  const words = segs.filter((s) => !s.startsWith(':')).map((s) => s.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
  const params = segs.filter((s) => s.startsWith(':')).map((s) => s.slice(1).replace(/[*?]/g, ''));
  const base = words.length ? words.join(' › ') : 'Home';
  return params.length ? `${base} (${params.join(', ')})` : base;
}
export const paramsOf = (p) => (p.match(/:(\w+)/g) || []).map((s) => s.slice(1));

// ---------------------------------------------------------------- file-based routers
/** [id] → :id, [...slug] → :slug*, [[...slug]] / [[id]] → optional, (group) → nothing. null = not a route. */
function bracketSeg(s) {
  let m;
  if (/^\(.*\)$/.test(s)) return '';                       // route group
  if (s.startsWith('@')) return '';                        // parallel route slot
  if ((m = s.match(/^\[\[\.\.\.(\w+)\]\]$/))) return `:${m[1]}*`;
  if ((m = s.match(/^\[\.\.\.(\w+)\]$/))) return `:${m[1]}*`;
  if ((m = s.match(/^\[\[(\w+)\]\]$/))) return `:${m[1]}?`;
  if ((m = s.match(/^\[(\w+)(=\w+)?\]$/))) return `:${m[1]}`;
  return s;
}
function fileRoutes(files, { prefix, match, framework, skipSeg = () => false, last = (f) => f }) {
  const out = [];
  for (const f of files) {
    if (!f.startsWith(prefix) || !match(f)) continue;
    const segs = last(f.slice(prefix.length)).split('/').filter(Boolean);
    if (segs.some(skipSeg)) continue;
    const p = join(...segs.map(bracketSeg));
    if (!isApi(p)) out.push({ path: p, file: f, framework });
  }
  return out;
}
const nextApp = (files, root) => [`${root}src/app/`, `${root}app/`].flatMap((prefix) => fileRoutes(files, {
  prefix, framework: 'Next.js (app)',
  match: (f) => /\/page\.(t|j)sx?$|\/page\.mdx?$|^page\.(t|j)sx?$/.test(f.slice(prefix.length - 1)),
  skipSeg: (s) => s.startsWith('_') || /^\(\.{1,3}\)/.test(s) || s === 'api',
  last: (f) => f.replace(/(^|\/)page\.[a-z]+$/, ''),
}));
const nextPages = (files, root) => [`${root}src/pages/`, `${root}pages/`].flatMap((prefix) => fileRoutes(files, {
  prefix, framework: 'Next.js (pages)',
  match: (f) => /\.(t|j)sx?$|\.mdx$/.test(f) && !/(^|\/)_(app|document|error)\.|(^|\/)(404|500)\.|\.(test|spec|d)\.[tj]sx?$/.test(f.slice(prefix.length)),
  skipSeg: (s) => s === 'api' || s.startsWith('_'),
  last: (f) => f.replace(/\.[a-z]+$/, '').replace(/(^|\/)index$/, ''),
}));
const sveltekit = (files, root) => fileRoutes(files, {
  prefix: `${root}src/routes/`, framework: 'SvelteKit',
  match: (f) => /(^|\/)\+page\.svelte$/.test(f),
  last: (f) => f.replace(/(^|\/)\+page\.svelte$/, ''),
});
const nuxt = (files, root) => [`${root}app/pages/`, `${root}pages/`].flatMap((prefix) => fileRoutes(files, {
  prefix, framework: 'Nuxt',
  match: (f) => f.endsWith('.vue'),
  last: (f) => f.replace(/\.vue$/, '').replace(/(^|\/)index$/, '').split('/').map((s) => (s.startsWith('_') ? `[${s.slice(1)}]` : s)).join('/'),
}));
const astro = (files, root) => fileRoutes(files, {
  prefix: `${root}src/pages/`, framework: 'Astro',
  match: (f) => /\.(astro|md|mdx|html)$/.test(f),
  skipSeg: (s) => s.startsWith('_'),
  last: (f) => f.replace(/\.[a-z]+$/, '').replace(/(^|\/)index$/, ''),
});
/** Remix v2 / React Router v7 flat routes: app/routes/orders.$id.tsx → /orders/:id. */
function remix(files, root) {
  const prefix = `${root}app/routes/`;
  const out = [];
  for (const f of files) {
    if (!f.startsWith(prefix) || !/\.(t|j)sx?$|\.mdx?$/.test(f)) continue;
    let rel = f.slice(prefix.length);
    if (rel.includes('/')) { if (!/\/route\.[tj]sx?$/.test(rel)) continue; rel = rel.split('/')[0]; } else rel = rel.replace(/\.[a-z]+$/, '');
    const segs = rel.split(/(?<!\[)\.(?![^[]*\])/).map((s) => {
      if (s === '_index' || s === 'index') return '';
      if (s.startsWith('_')) return '';                       // pathless layout
      if (s === '$') return ':splat*';
      if (/^\(\$\w+\)$/.test(s)) return `:${s.slice(2, -1)}?`;
      if (s.startsWith('$')) return `:${s.slice(1)}`;
      return s.replace(/_$/, '').replace(/\[(.*?)\]/g, '$1');
    });
    const p = join(...segs);
    if (!isApi(p) && !/\.(xml|txt|json)$/.test(p)) out.push({ path: p, file: f, framework: 'Remix / React Router' });
  }
  return out;
}

// ---------------------------------------------------------------- config-based routers
/**
 * Walks object literals ({ path: 'x', children: [...] }) as used by Vue Router, Angular and React Router's
 * object config, joining children to their parent's path. Skips strings and comments while scanning.
 */
export function objectRoutes(text) {
  const out = [];
  const stack = []; // { t: 'obj' | 'arr', base, path, name, redirect, children }
  let i = 0;
  let pendingChildren = null; // the object whose `children: [` we're about to enter
  const top = () => stack[stack.length - 1];
  const readString = () => {
    const q = text[i];
    let s = '';
    i++;
    while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; s += text[i]; i++; }
    i++;
    return s;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { readString(); continue; }
    if (c === '{') {
      const t = top();
      const base = !t ? '' : t.t === 'arr' ? t.base : null; // objects directly inside route arrays are routes
      stack.push({ t: 'obj', base, path: null, name: null, redirect: false });
      i++; continue;
    }
    if (c === '[') {
      const t = top();
      stack.push({ t: 'arr', base: pendingChildren ? (pendingChildren.full ?? pendingChildren.base ?? '') : (t ? (t.t === 'arr' ? t.base : '') : '') });
      pendingChildren = null;
      i++; continue;
    }
    if (c === '}' || c === ']') {
      const f = stack.pop();
      if (f?.t === 'obj' && f.base !== null && f.path !== null && !f.redirect && f.path !== '**' && !f.path.includes('*')) out.push({ path: f.full, name: f.name });
      i++; continue;
    }
    const m = /^(path|name|title|redirectTo|redirect|children)\s*:\s*/.exec(text.slice(i, i + 40));
    if (m && /[\s,{(]/.test(text[i - 1] || ' ')) {
      const t = top();
      i += m[0].length;
      if (t?.t === 'obj' && t.base !== null) {
        if (m[1] === 'children') { if (text[i] === '[') pendingChildren = t; continue; }
        if (m[1] === 'redirectTo' || m[1] === 'redirect') { t.redirect = true; continue; }
        if (`'"\``.includes(text[i])) {
          const v = readString();
          if (m[1] === 'path') { t.path = v; t.full = v.startsWith('/') ? join(v) : join(t.base, v); }
          else if (!t.name) t.name = v;
        }
      }
      continue;
    }
    i++;
  }
  return out;
}

/** <Route path="orders" element={…}><Route path=":id" …/></Route> → /orders, /orders/:id */
export function jsxRoutes(text) {
  const out = [];
  const stack = [''];
  const re = /<\/Route\s*>|<Route\b/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    // read the tag up to its closing '>' at brace depth 0
    let i = m.index + m[0].length, depth = 0, quote = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === quote && text[i - 1] !== '\\') quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const tag = text.slice(m.index, i + 1);
    re.lastIndex = i + 1;
    const selfClosing = /\/\s*>$/.test(tag);
    const pm = tag.match(/\spath\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/);
    const parent = stack[stack.length - 1];
    let full = parent;
    if (pm) {
      const v = pm[1] ?? pm[2] ?? pm[3];
      full = v.startsWith('/') ? join(v) : join(parent, v);
      if (v !== '*' && !v.endsWith('/*')) out.push({ path: full });
    }
    if (!selfClosing) stack.push(full);
  }
  return out;
}

/** Laravel routes/web.php: Route::get('/orders', …), Route::view(…), Route::resource('photos', …), prefix groups. */
function laravelRoutes(text) {
  const out = [];
  const conv = (p) => join(...p.split('/').map((s) => s.replace(/^\{(\w+)\?\}$/, ':$1?').replace(/^\{(\w+)\}$/, ':$1')));
  const prefixes = []; // { prefix, depth }
  let depth = 0;
  const tokens = /Route::prefix\(\s*['"]([^'"]*)['"]\s*\)|Route::(get|view|any|match)\s*\(\s*(?:\[[^\]]*\]\s*,\s*)?['"]([^'"]*)['"]|Route::resource\(\s*['"]([^'"]+)['"]|[{}]/g;
  let m, pendingPrefix = null;
  while ((m = tokens.exec(text))) {
    if (m[0] === '{') { depth++; if (pendingPrefix !== null) { prefixes.push({ prefix: pendingPrefix, depth }); pendingPrefix = null; } continue; }
    if (m[0] === '}') { while (prefixes.length && prefixes[prefixes.length - 1].depth === depth) prefixes.pop(); depth--; continue; }
    const pre = prefixes.map((x) => x.prefix);
    if (m[1] !== undefined) { pendingPrefix = m[1]; continue; }
    if (m[3] !== undefined) { out.push({ path: conv(join(...pre, m[3])) }); continue; }
    if (m[4]) { const b = join(...pre, m[4]); out.push({ path: conv(b) }, { path: `${conv(b)}/create` }, { path: `${conv(b)}/:id` }, { path: `${conv(b)}/:id/edit` }); }
  }
  return out;
}
/** Django urls.py: path('orders/<int:pk>/', …) with include() prefixes. */
function djangoRoutes(files) {
  const includes = new Map(); // 'shop.urls' → 'shop/'
  for (const f of files) for (const m of f.text.matchAll(/path\(\s*['"]([^'"]*)['"]\s*,\s*include\(\s*['"]([\w.]+)['"]/g)) includes.set(m[2], m[1]);
  const out = [];
  for (const f of files) {
    const mod = f.file.replace(/\.py$/, '').split('/').join('.');
    const prefix = [...includes.entries()].find(([k]) => mod.endsWith(k))?.[1] || '';
    for (const m of f.text.matchAll(/(?<![\w.])path\(\s*['"]([^'"]*)['"]\s*,\s*(?!include)/g)) {
      const p = join(...`${prefix}${m[1]}`.split('/').map((s) => s.replace(/^<(?:\w+:)?(\w+)>$/, ':$1')));
      if (!isApi(p) && !p.startsWith('/admin')) out.push({ path: p, file: f.file });
    }
  }
  return out;
}
/** Rails config/routes.rb: get '…', root, resources :orders (index/new/show/edit). */
function railsRoutes(text) {
  const out = [];
  if (/^\s*root\b/m.test(text)) out.push({ path: '/' });
  for (const m of text.matchAll(/^\s*get\s+['"]([^'"]+)['"]/gm)) out.push({ path: join(m[1]) });
  for (const m of text.matchAll(/^\s*resources?\s+:(\w+)/gm)) {
    const b = join(m[1]);
    out.push({ path: b }, { path: `${b}/new` }, { path: `${b}/:id` }, { path: `${b}/:id/edit` });
  }
  return out.filter((r) => !isApi(r.path));
}

// ---------------------------------------------------------------- scanning a code base
const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.svelte-kit|\.output|dist|build|out|coverage|vendor|\.turbo|\.vercel|__pycache__|\.venv|venv)(\/|$)/;
// Hidden folders (.git, .kilo/worktrees, .claude…) hold copies or tooling, not the app.
const HIDDEN_DIR = /(^|\/)\.[^/]+\//;
export const skipPath = (f) => SKIP_DIRS.test(f) || HIDDEN_DIR.test(f);

// ---------------------------------------------------------------- TanStack Router (file-based)
/** One TanStack route segment: $id → :id, {-$v} → :v?, $ → :splat*, _layout / (group) / index / route → nothing. */
function tanstackSeg(s, isLast) {
  let m;
  if (/^\(.*\)$/.test(s)) return '';
  if (s.startsWith('_')) return '';                        // pathless layout
  if (isLast && (s === 'index' || s === 'route')) return '';
  if (s === '$') return ':splat*';
  if ((m = s.match(/^\{-\$(\w+)\}$/))) return `:${m[1]}?`;
  if ((m = s.match(/^\{\$(\w+)\}$/))) return `:${m[1]}`;
  if ((m = s.match(/^\$(\w+)$/))) return `:${m[1]}`;
  return s.replace(/_$/, '').replace(/\[(.)\]/g, '$1');   // trailing _ = not nested; [.] escapes a dot
}
/** A TanStack path as written in routeTree.gen.ts ('/pay-runs/$id/', '/{-$version}') → our form. */
const tanstackPath = (p) => join(...p.split('/').filter(Boolean).map((s, i, a) => tanstackSeg(s, i === a.length - 1)));
export function tanstackRoutes(files, root, genText = '') {
  const dir = [`${root}src/routes/`, `${root}app/routes/`].find((d) => files.some((f) => f.startsWith(d)));
  if (!dir) return [];
  const byPath = new Map();
  for (const f of files) {
    if (!f.startsWith(dir) || !/\.(t|j)sx?$/.test(f) || /\.(test|spec|d)\.[tj]sx?$/.test(f)) continue;
    const rel = f.slice(dir.length).replace(/\.(t|j)sx?$/, '').replace(/\.lazy$/, '');
    const parts = rel.split('/');
    if (parts.some((x) => x.startsWith('-')) || /(^|\/)__root$/.test(rel)) continue;  // ignored files, the root layout
    const segs = parts.flatMap((x) => x.split(/\.(?![^[]*\])/));                     // dots nest, except [.]
    const p = join(...segs.map((x, i) => tanstackSeg(x, i === segs.length - 1)));
    const cur = byPath.get(p) || { path: p, files: [] };
    cur.files.push(f);
    // The page itself: prefer the index/leaf file over its layout.
    if (!cur.file || /(^|[./])index$/.test(rel)) cur.file = f;
    byPath.set(p, cur);
  }
  // The generated route tree is the router's own list: keep exactly its paths when it's there.
  const gen = genText.match(/interface FileRoutesByFullPath\s*\{([\s\S]*?)\n\}/)?.[1]; // paths can contain { }
  if (gen) {
    const real = new Set([...gen.matchAll(/'([^']+)'\s*:/g)].map((m) => tanstackPath(m[1])));
    for (const k of [...byPath.keys()]) if (!real.has(k)) byPath.delete(k);
    for (const k of real) if (!byPath.has(k)) byPath.set(k, { path: k, files: [], file: null });
  }
  return [...byPath.values()].map((r) => ({ ...r, framework: 'TanStack Router' }));
}

/**
 * files: every file path in the code base (relative, '/'-separated). read(path) returns a file's text.
 * Returns { routes: [{ path, name, file, framework, params }], frameworks, roots }.
 */
export async function scanCodebase(files, read) {
  files = files.filter((f) => !skipPath(f));
  const routes = [];
  const frameworks = new Set();
  const add = (list, framework, file) => {
    for (const r of list) {
      if (!r.path || isApi(r.path)) continue;
      routes.push({ path: r.path, name: r.name || null, file: r.file || file || null, files: r.files || (r.file || file ? [r.file || file] : []), framework: r.framework || framework });
      frameworks.add(r.framework || framework);
    }
  };
  // Each package.json is an app (monorepos have several).
  const pkgs = files.filter((f) => /(^|\/)package\.json$/.test(f)).slice(0, 12);
  const roots = pkgs.length ? pkgs.map((f) => f.replace(/package\.json$/, '')) : [''];
  for (const root of roots) {
    let deps = {};
    try { const j = JSON.parse(await read(`${root}package.json`)); deps = { ...j.dependencies, ...j.devDependencies }; } catch { /* no package.json */ }
    const has = (n) => Object.keys(deps).some((d) => d === n || d.startsWith(`${n}/`));
    const mine = files.filter((f) => f.startsWith(root) && !roots.some((r) => r !== root && r.startsWith(root) && f.startsWith(r)));
    if (has('next')) { add(nextApp(mine, root), 'Next.js (app)'); add(nextPages(mine, root), 'Next.js (pages)'); }
    if (has('@sveltejs/kit')) add(sveltekit(mine, root), 'SvelteKit');
    if (has('nuxt') || has('nuxt3')) add(nuxt(mine, root), 'Nuxt');
    if (has('astro')) add(astro(mine, root), 'Astro');
    if (has('@tanstack/react-router') || has('@tanstack/react-start') || has('@tanstack/solid-router')) {
      let gen = '';
      const genFile = mine.find((f) => /(^|\/)routeTree\.gen\.[tj]s$/.test(f));
      if (genFile) { try { gen = await read(genFile); } catch { /* unreadable */ } }
      add(tanstackRoutes(mine, root, gen), 'TanStack Router');
    }
    if (has('@remix-run') || (has('@react-router') && mine.some((f) => f.startsWith(`${root}app/routes/`)))) add(remix(mine, root), 'Remix / React Router');
    // Router config in source files
    const want = [];
    if (has('react-router') || has('react-router-dom')) want.push('react');
    if (has('vue-router')) want.push('vue');
    if (has('@angular/router')) want.push('angular');
    if (want.length) {
      const candidates = mine.filter((f) => /\.(t|j)sx?$|\.vue$/.test(f) && !/\.(test|spec|stories|d)\.[tj]sx?$/.test(f)
        && (/rout/i.test(f) || /(^|\/)(App|main|index|app\.module)\.[tj]sx?$/.test(f))).slice(0, 80);
      for (const f of candidates) {
        let text = '';
        try { text = await read(f); } catch { continue; }
        if (want.includes('react') && /<Route\b/.test(text)) add(jsxRoutes(text), 'React Router', f);
        if (/\b(createBrowserRouter|createHashRouter|createRouter|RouterModule|Routes\s*=|routes\s*[:=])/.test(text)) {
          add(objectRoutes(text), want.includes('vue') ? 'Vue Router' : want.includes('angular') ? 'Angular' : 'React Router', f);
        }
      }
    }
  }
  // Server frameworks (no package.json needed)
  for (const f of files.filter((x) => /(^|\/)routes\/web\.php$/.test(x))) { try { add(laravelRoutes(await read(f)), 'Laravel', f); } catch { /* unreadable */ } }
  const py = files.filter((x) => /(^|\/)urls\.py$/.test(x)).slice(0, 40);
  if (py.length) {
    const texts = [];
    for (const f of py) { try { texts.push({ file: f, text: await read(f) }); } catch { /* unreadable */ } }
    add(djangoRoutes(texts), 'Django');
  }
  for (const f of files.filter((x) => /(^|\/)config\/routes\.rb$/.test(x))) { try { add(railsRoutes(await read(f)), 'Rails', f); } catch { /* unreadable */ } }

  // One entry per path; prefer one with a route name.
  const byPath = new Map();
  for (const r of routes) { const cur = byPath.get(r.path); if (!cur || (!cur.name && r.name)) byPath.set(r.path, r); }
  const list = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)).map((r) => ({ ...r, name: nameForPath(r.path, r.name), params: paramsOf(r.path) }));
  return { routes: list, frameworks: [...frameworks], roots: roots.map((r) => r || '/') };
}
