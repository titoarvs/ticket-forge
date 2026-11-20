// Finds a web app's page routes from its source code, for Test automation → App setup.
// File-based routing: Next.js (app/ and pages/), SvelteKit, Nuxt, Remix / React Router framework
// mode, Astro, TanStack Router / TanStack Start (src/routes, checked against its generated
// routeTree.gen.ts).
// Router config: React Router (JSX and objects), Vue Router, Angular. Server: Laravel, Django,
// Rails.
// Dynamic segments become :params, e.g. /orders/:id. API routes are left out.

export const join = (...parts) =>
  `/${parts.filter((p) => p !== null && p !== undefined && p !== '').join('/')}`
    .replace(/\/{2,}/g, '/')
    .replace(/(.)\/$/, '$1');
export const isApi = (p) => /^\/api(\/|$)/.test(p);
/** A readable page name from a path: /orders/:id → "Orders (id)". */
export function nameForPath(p, hint) {
  if (hint && String(hint).trim())
    return String(hint)
      .trim()
      .replace(/[-_]+/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase());
  const segs = p.split('/').filter(Boolean);
  const words = segs
    .filter((s) => !s.startsWith(':'))
    .map((s) => s.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
  const params = segs.filter((s) => s.startsWith(':')).map((s) => s.slice(1).replace(/[*?]/g, ''));
  const base = words.length ? words.join(' › ') : 'Home';
  return params.length ? `${base} (${params.join(', ')})` : base;
}
export const paramsOf = (p) => (p.match(/:(\w+)/g) || []).map((s) => s.slice(1));
// ---------------------------------------------------------------- file-based routers
/**
 * [id] → :id, [...slug] → :slug*, [[...slug]] / [[id]] → optional, (group) → nothing. null = not a
 * route.
 */
function bracketSeg(s) {
  let m;
  if (/^\(.*\)$/.test(s)) return ''; // route group
  if (s.startsWith('@')) return ''; // parallel route slot
  if ((m = s.match(/^\[\[\.\.\.(\w+)\]\]$/))) return `:${m[1]}*`;
  if ((m = s.match(/^\[\.\.\.(\w+)\]$/))) return `:${m[1]}*`;
  if ((m = s.match(/^\[\[(\w+)\]\]$/))) return `:${m[1]}?`;
  if ((m = s.match(/^\[(\w+)(=\w+)?\]$/))) return `:${m[1]}`;
  return s;
}
function fileRoutes(
  files,
  { prefix, match, framework, skipSeg = () => false, last = (f) => f }: any,
) {
  const out: any[] = [];
  for (const f of files) {
    if (!f.startsWith(prefix) || !match(f)) continue;
    const segs = last(f.slice(prefix.length)).split('/').filter(Boolean);
    if (segs.some(skipSeg)) continue;
    const p = join(...segs.map(bracketSeg));
    if (!isApi(p)) out.push({ path: p, file: f, framework });
  }
  return out;
}
export const nextApp = (files, root) =>
  [`${root}src/app/`, `${root}app/`].flatMap((prefix) =>
    fileRoutes(files, {
      prefix,
      framework: 'Next.js (app)',
      match: (f) =>
        /\/page\.(t|j)sx?$|\/page\.mdx?$|^page\.(t|j)sx?$/.test(f.slice(prefix.length - 1)),
      skipSeg: (s) => s.startsWith('_') || /^\(\.{1,3}\)/.test(s) || s === 'api',
      last: (f) => f.replace(/(^|\/)page\.[a-z]+$/, ''),
    }),
  );
export const nextPages = (files, root) =>
  [`${root}src/pages/`, `${root}pages/`].flatMap((prefix) =>
    fileRoutes(files, {
      prefix,
      framework: 'Next.js (pages)',
      match: (f) =>
        /\.(t|j)sx?$|\.mdx$/.test(f) &&
        !/(^|\/)_(app|document|error)\.|(^|\/)(404|500)\.|\.(test|spec|d)\.[tj]sx?$/.test(
          f.slice(prefix.length),
        ),
      skipSeg: (s) => s === 'api' || s.startsWith('_'),
      last: (f) => f.replace(/\.[a-z]+$/, '').replace(/(^|\/)index$/, ''),
    }),
  );
export const sveltekit = (files, root) =>
  fileRoutes(files, {
    prefix: `${root}src/routes/`,
    framework: 'SvelteKit',
    match: (f) => /(^|\/)\+page\.svelte$/.test(f),
    last: (f) => f.replace(/(^|\/)\+page\.svelte$/, ''),
  });
export const nuxt = (files, root) =>
  [`${root}app/pages/`, `${root}pages/`].flatMap((prefix) =>
    fileRoutes(files, {
      prefix,
      framework: 'Nuxt',
      match: (f) => f.endsWith('.vue'),
      last: (f) =>
        f
          .replace(/\.vue$/, '')
          .replace(/(^|\/)index$/, '')
          .split('/')
          .map((s) => (s.startsWith('_') ? `[${s.slice(1)}]` : s))
          .join('/'),
    }),
  );
export const astro = (files, root) =>
  fileRoutes(files, {
    prefix: `${root}src/pages/`,
    framework: 'Astro',
    match: (f) => /\.(astro|md|mdx|html)$/.test(f),
    skipSeg: (s) => s.startsWith('_'),
    last: (f) => f.replace(/\.[a-z]+$/, '').replace(/(^|\/)index$/, ''),
  });
/** Remix v2 / React Router v7 flat routes: app/routes/orders.$id.tsx → /orders/:id. */
export function remix(files, root) {
  const prefix = `${root}app/routes/`;
  const out: any[] = [];
  for (const f of files) {
    if (!f.startsWith(prefix) || !/\.(t|j)sx?$|\.mdx?$/.test(f)) continue;
    let rel = f.slice(prefix.length);
    if (rel.includes('/')) {
      if (!/\/route\.[tj]sx?$/.test(rel)) continue;
      rel = rel.split('/')[0];
    } else rel = rel.replace(/\.[a-z]+$/, '');
    const segs = rel.split(/(?<!\[)\.(?![^[]*\])/).map((s) => {
      if (s === '_index' || s === 'index') return '';
      if (s.startsWith('_')) return ''; // pathless layout
      if (s === '$') return ':splat*';
      if (/^\(\$\w+\)$/.test(s)) return `:${s.slice(2, -1)}?`;
      if (s.startsWith('$')) return `:${s.slice(1)}`;
      return s.replace(/_$/, '').replace(/\[(.*?)\]/g, '$1');
    });
    const p = join(...segs);
    if (!isApi(p) && !/\.(xml|txt|json)$/.test(p))
      out.push({ path: p, file: f, framework: 'Remix / React Router' });
  }
  return out;
}
// ---------------------------------------------------------------- config-based routers
/**
 * Walks object literals ({ path: 'x', children: [...] }) as used by Vue Router, Angular and React
 * Router's object config, joining children to their parent's path. Skips strings and comments while
 * scanning.
 */
export function objectRoutes(text) {
  const out: any[] = [];
  const stack: any[] = []; // { t: 'obj' | 'arr', base, path, name, redirect, children }
  let i = 0;
  let pendingChildren = null; // the object whose `children: [` we're about to enter
  const top = () => stack[stack.length - 1];
  const readString = () => {
    const q = text[i];
    let s = '';
    i++;
    while (i < text.length && text[i] !== q) {
      if (text[i] === '\\') i++;
      s += text[i];
      i++;
    }
    i++;
    return s;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      readString();
      continue;
    }
    if (c === '{') {
      const t = top();
      const base = !t ? '' : t.t === 'arr' ? t.base : null; // objects directly inside route arrays are routes
      stack.push({ t: 'obj', base, path: null, name: null, redirect: false });
      i++;
      continue;
    }
    if (c === '[') {
      const t = top();
      stack.push({
        t: 'arr',
        base: pendingChildren
          ? (pendingChildren.full ?? pendingChildren.base ?? '')
          : t
            ? t.t === 'arr'
              ? t.base
              : ''
            : '',
      });
      pendingChildren = null;
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      const f = stack.pop();
      if (
        f?.t === 'obj' &&
        f.base !== null &&
        f.path !== null &&
        !f.redirect &&
        f.path !== '**' &&
        !f.path.includes('*')
      )
        out.push({ path: f.full, name: f.name });
      i++;
      continue;
    }
    const m = /^(path|name|title|redirectTo|redirect|children)\s*:\s*/.exec(text.slice(i, i + 40));
    if (m && /[\s,{(]/.test(text[i - 1] || ' ')) {
      const t = top();
      i += m[0].length;
      if (t?.t === 'obj' && t.base !== null) {
        if (m[1] === 'children') {
          if (text[i] === '[') pendingChildren = t;
          continue;
        }
        if (m[1] === 'redirectTo' || m[1] === 'redirect') {
          t.redirect = true;
          continue;
        }
        if (`'"\``.includes(text[i])) {
          const v = readString();
          if (m[1] === 'path') {
            t.path = v;
            t.full = v.startsWith('/') ? join(v) : join(t.base, v);
          } else if (!t.name) t.name = v;
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
  const out: any[] = [];
  const stack = [''];
  const re = /<\/Route\s*>|<Route\b/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    // read the tag up to its closing '>' at brace depth 0
    let i = m.index + m[0].length,
      depth = 0,
      quote = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote && text[i - 1] !== '\\') quote = null;
        continue;
      }
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
/**
 * Laravel routes/web.php: Route::get('/orders', …), Route::view(…), Route::resource('photos', …),
 * prefix groups.
 */
export function laravelRoutes(text) {
  const out: any[] = [];
  const conv = (p) =>
    join(
      ...p.split('/').map((s) => s.replace(/^\{(\w+)\?\}$/, ':$1?').replace(/^\{(\w+)\}$/, ':$1')),
    );
  const prefixes: any[] = []; // { prefix, depth }
  let depth = 0;
  const tokens =
    /Route::prefix\(\s*['"]([^'"]*)['"]\s*\)|Route::(get|view|any|match)\s*\(\s*(?:\[[^\]]*\]\s*,\s*)?['"]([^'"]*)['"]|Route::resource\(\s*['"]([^'"]+)['"]|[{}]/g;
  let m,
    pendingPrefix = null;
  while ((m = tokens.exec(text))) {
    if (m[0] === '{') {
      depth++;
      if (pendingPrefix !== null) {
        prefixes.push({ prefix: pendingPrefix, depth });
        pendingPrefix = null;
      }
      continue;
    }
    if (m[0] === '}') {
      while (prefixes.length && prefixes[prefixes.length - 1].depth === depth) prefixes.pop();
      depth--;
      continue;
    }
    const pre = prefixes.map((x) => x.prefix);
    if (m[1] !== undefined) {
      pendingPrefix = m[1];
      continue;
    }
    if (m[3] !== undefined) {
      out.push({ path: conv(join(...pre, m[3])) });
      continue;
    }
    if (m[4]) {
      const b = join(...pre, m[4]);
      out.push(
        { path: conv(b) },
        { path: `${conv(b)}/create` },
        { path: `${conv(b)}/:id` },
        { path: `${conv(b)}/:id/edit` },
      );
    }
  }
  return out;
}
/** Django urls.py: path('orders/<int:pk>/', …) with include() prefixes. */
export function djangoRoutes(files) {
  const includes: Map<any, any> = new Map(); // 'shop.urls' → 'shop/'
  for (const f of files)
    for (const m of f.text.matchAll(
      /path\(\s*['"]([^'"]*)['"]\s*,\s*include\(\s*['"]([\w.]+)['"]/g,
    ))
      includes.set(m[2], m[1]);
  const out: any[] = [];
  for (const f of files) {
    const mod = f.file.replace(/\.py$/, '').split('/').join('.');
    const prefix = [...includes.entries()].find(([k]) => mod.endsWith(k))?.[1] || '';
    for (const m of f.text.matchAll(/(?<![\w.])path\(\s*['"]([^'"]*)['"]\s*,\s*(?!include)/g)) {
      const p = join(
        ...`${prefix}${m[1]}`.split('/').map((s) => s.replace(/^<(?:\w+:)?(\w+)>$/, ':$1')),
      );
      if (!isApi(p) && !p.startsWith('/admin')) out.push({ path: p, file: f.file });
    }
  }
  return out;
}
