import {
  join,
  isApi,
  nextApp,
  nextPages,
  sveltekit,
  nuxt,
  astro,
  remix,
  jsxRoutes,
  objectRoutes,
  laravelRoutes,
  djangoRoutes,
  nameForPath,
  paramsOf,
} from './object-routes';

/** Rails config/routes.rb: get '…', root, resources :orders (index/new/show/edit). */
function railsRoutes(text) {
  const out: any[] = [];
  if (/^\s*root\b/m.test(text)) out.push({ path: '/' });
  for (const m of text.matchAll(/^\s*get\s+['"]([^'"]+)['"]/gm)) out.push({ path: join(m[1]) });
  for (const m of text.matchAll(/^\s*resources?\s+:(\w+)/gm)) {
    const b = join(m[1]);
    out.push({ path: b }, { path: `${b}/new` }, { path: `${b}/:id` }, { path: `${b}/:id/edit` });
  }
  return out.filter((r) => !isApi(r.path));
}
// ---------------------------------------------------------------- scanning a code base
const SKIP_DIRS =
  /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.svelte-kit|\.output|dist|build|out|coverage|vendor|\.turbo|\.vercel|__pycache__|\.venv|venv)(\/|$)/;
// Hidden folders (.git, .kilo/worktrees, .claude…) hold copies or tooling, not the app.
const HIDDEN_DIR = /(^|\/)\.[^/]+\//;
export const skipPath = (f) => SKIP_DIRS.test(f) || HIDDEN_DIR.test(f);
// ---------------------------------------------------------------- TanStack Router (file-based)
/**
 * One TanStack route segment: $id → :id, {-$v} → :v?, $ → :splat*, _layout / (group) / index /
 * route → nothing.
 */
function tanstackSeg(s, isLast) {
  let m;
  if (/^\(.*\)$/.test(s)) return '';
  if (s.startsWith('_')) return ''; // pathless layout
  if (isLast && (s === 'index' || s === 'route')) return '';
  if (s === '$') return ':splat*';
  if ((m = s.match(/^\{-\$(\w+)\}$/))) return `:${m[1]}?`;
  if ((m = s.match(/^\{\$(\w+)\}$/))) return `:${m[1]}`;
  if ((m = s.match(/^\$(\w+)$/))) return `:${m[1]}`;
  return s.replace(/_$/, '').replace(/\[(.)\]/g, '$1'); // trailing _ = not nested; [.] escapes a dot
}
/** A TanStack path as written in routeTree.gen.ts ('/pay-runs/$id/', '/{-$version}') → our form. */
const tanstackPath = (p) =>
  join(
    ...p
      .split('/')
      .filter(Boolean)
      .map((s, i, a) => tanstackSeg(s, i === a.length - 1)),
  );
export function tanstackRoutes(files, root, genText = '') {
  const dir = [`${root}src/routes/`, `${root}app/routes/`].find((d) =>
    files.some((f) => f.startsWith(d)),
  );
  if (!dir) return [];
  const byPath: Map<any, any> = new Map();
  for (const f of files) {
    if (!f.startsWith(dir) || !/\.(t|j)sx?$/.test(f) || /\.(test|spec|d)\.[tj]sx?$/.test(f))
      continue;
    const rel = f
      .slice(dir.length)
      .replace(/\.(t|j)sx?$/, '')
      .replace(/\.lazy$/, '');
    const parts = rel.split('/');
    if (parts.some((x) => x.startsWith('-')) || /(^|\/)__root$/.test(rel)) continue; // ignored files, the root layout
    const segs = parts.flatMap((x) => x.split(/\.(?![^[]*\])/)); // dots nest, except [.]
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
 * files: every file path in the code base (relative, '/'-separated). read(path) returns a file's
 * text.
 * Returns { routes: [{ path, name, file, framework, params }], frameworks, roots }.
 */
export async function scanCodebase(files, read) {
  files = files.filter((f) => !skipPath(f));
  const routes: any[] = [];
  const frameworks: Set<any> = new Set();
  const add = (list, framework, file?) => {
    for (const r of list) {
      if (!r.path || isApi(r.path)) continue;
      routes.push({
        path: r.path,
        name: r.name || null,
        file: r.file || file || null,
        files: r.files || (r.file || file ? [r.file || file] : []),
        framework: r.framework || framework,
      });
      frameworks.add(r.framework || framework);
    }
  };
  // Each package.json is an app (monorepos have several).
  const pkgs = files.filter((f) => /(^|\/)package\.json$/.test(f)).slice(0, 12);
  const roots = pkgs.length ? pkgs.map((f) => f.replace(/package\.json$/, '')) : [''];
  for (const root of roots) {
    let deps: any = {};
    try {
      const j = JSON.parse(await read(`${root}package.json`));
      deps = { ...j.dependencies, ...j.devDependencies };
    } catch {
      /* no package.json */
    }
    const has = (n) => Object.keys(deps).some((d) => d === n || d.startsWith(`${n}/`));
    const mine = files.filter(
      (f) =>
        f.startsWith(root) &&
        !roots.some((r) => r !== root && r.startsWith(root) && f.startsWith(r)),
    );
    if (has('next')) {
      add(nextApp(mine, root), 'Next.js (app)');
      add(nextPages(mine, root), 'Next.js (pages)');
    }
    if (has('@sveltejs/kit')) add(sveltekit(mine, root), 'SvelteKit');
    if (has('nuxt') || has('nuxt3')) add(nuxt(mine, root), 'Nuxt');
    if (has('astro')) add(astro(mine, root), 'Astro');
    if (
      has('@tanstack/react-router') ||
      has('@tanstack/react-start') ||
      has('@tanstack/solid-router')
    ) {
      let gen = '';
      const genFile = mine.find((f) => /(^|\/)routeTree\.gen\.[tj]s$/.test(f));
      if (genFile) {
        try {
          gen = await read(genFile);
        } catch {
          /* unreadable */
        }
      }
      add(tanstackRoutes(mine, root, gen), 'TanStack Router');
    }
    if (
      has('@remix-run') ||
      (has('@react-router') && mine.some((f) => f.startsWith(`${root}app/routes/`)))
    )
      add(remix(mine, root), 'Remix / React Router');
    // Router config in source files
    const want: any[] = [];
    if (has('react-router') || has('react-router-dom')) want.push('react');
    if (has('vue-router')) want.push('vue');
    if (has('@angular/router')) want.push('angular');
    if (want.length) {
      const candidates = mine
        .filter(
          (f) =>
            /\.(t|j)sx?$|\.vue$/.test(f) &&
            !/\.(test|spec|stories|d)\.[tj]sx?$/.test(f) &&
            (/rout/i.test(f) || /(^|\/)(App|main|index|app\.module)\.[tj]sx?$/.test(f)),
        )
        .slice(0, 80);
      for (const f of candidates) {
        let text = '';
        try {
          text = await read(f);
        } catch {
          continue;
        }
        if (want.includes('react') && /<Route\b/.test(text))
          add(jsxRoutes(text), 'React Router', f);
        if (
          /\b(createBrowserRouter|createHashRouter|createRouter|RouterModule|Routes\s*=|routes\s*[:=])/.test(
            text,
          )
        ) {
          add(
            objectRoutes(text),
            want.includes('vue')
              ? 'Vue Router'
              : want.includes('angular')
                ? 'Angular'
                : 'React Router',
            f,
          );
        }
      }
    }
  }
  // Server frameworks (no package.json needed)
  for (const f of files.filter((x) => /(^|\/)routes\/web\.php$/.test(x))) {
    try {
      add(laravelRoutes(await read(f)), 'Laravel', f);
    } catch {
      /* unreadable */
    }
  }
  const py = files.filter((x) => /(^|\/)urls\.py$/.test(x)).slice(0, 40);
  if (py.length) {
    const texts: any[] = [];
    for (const f of py) {
      try {
        texts.push({ file: f, text: await read(f) });
      } catch {
        /* unreadable */
      }
    }
    add(djangoRoutes(texts), 'Django');
  }
  for (const f of files.filter((x) => /(^|\/)config\/routes\.rb$/.test(x))) {
    try {
      add(railsRoutes(await read(f)), 'Rails', f);
    } catch {
      /* unreadable */
    }
  }

  // One entry per path; prefer one with a route name.
  const byPath: Map<any, any> = new Map();
  for (const r of routes) {
    const cur = byPath.get(r.path);
    if (!cur || (!cur.name && r.name)) byPath.set(r.path, r);
  }
  const list = [...byPath.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((r) => ({ ...r, name: nameForPath(r.path, r.name), params: paramsOf(r.path) }));
  return { routes: list, frameworks: [...frameworks], roots: roots.map((r) => r || '/') };
}
