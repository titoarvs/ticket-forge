// The `app` helper that test scripts get, built from the project's App setup (Test automation page):
//   await app.goto('Orders')        open a page by its name
//   await app.goto('Order detail', { id: 1001 })   fill a dynamic route like /orders/:id
//   await app.loginAs('Admin')      sign in with that role's saved credentials
//   app.url('Orders')               the page's path, e.g. for toHaveURL
//   app.credentials('Admin')        { username, password } for tests of the login form itself
// Used by the test runner (lib/runner.mjs) and by the server for page snapshots, page discovery and login tests.

const norm = (s) => String(s ?? '').trim().toLowerCase();
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** CSS/XPath selectors are used as they are; anything else is treated as a label, placeholder or button text. */
const isSelector = (s) => /^(css=|xpath=|\/\/|[#.[]|[a-z][\w-]*(\[|#|\.|:|\s*>))/i.test(String(s).trim());

export const LOGOUT_RE = /log ?out|sign ?out|logoff/i;

/** cfg = { pages: [{ name, path }], roles: [{ id, name, username, password }], login: { path, usernameField, passwordField, submitButton, success } } */
export function makeApp(page, expect, cfg = {}) {
  const pages = cfg.pages || [];
  const roles = cfg.roles || [];
  const login = cfg.login || {};
  const findPage = (name) => pages.find((p) => norm(p.name) === norm(name) || norm(p.path) === norm(name) || p.id === name);
  const findRole = (name) => roles.find((r) => norm(r.name) === norm(name) || r.id === name);
  const field = (spec) => (isSelector(spec) ? page.locator(spec) : page.getByLabel(spec).or(page.getByPlaceholder(spec))).first();
  const button = (spec) => (isSelector(spec) ? page.locator(spec) : page.getByRole('button', { name: spec }).or(page.getByRole('link', { name: spec }))).first();

  const app = {
    pages: pages.map((p) => p.name),
    roles: roles.map((r) => r.name),
    /** The path of a page in the App setup, with dynamic segments (:id, :slug*) filled from `params`. */
    url(name, params = {}) {
      const p = findPage(name);
      if (!p) throw new Error(`There's no page called "${name}" in the App setup. Pages: ${pages.map((x) => x.name).join(', ') || 'none yet'}.`);
      const missing = [];
      const out = String(p.path || '/').replace(/:(\w+)([*?]?)/g, (_m, key, mod) => {
        const v = params?.[key];
        if (v === undefined || v === null || v === '') { if (!mod) missing.push(key); return ''; }
        return Array.isArray(v) ? v.map(encodeURIComponent).join('/') : encodeURIComponent(String(v));
      }).replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
      if (missing.length) throw new Error(`Page "${p.name}" (${p.path}) needs ${missing.join(', ')}: app.goto('${p.name}', { ${missing.map((k) => `${k}: …`).join(', ')} }).`);
      return out || '/';
    },
    /** Opens a page from the App setup by its name. `params` fill dynamic segments; `options` go to page.goto. */
    async goto(name, params, options) {
      const looksLikeOptions = params && !options && ['waitUntil', 'timeout', 'referer'].some((k) => k in params);
      await page.goto(app.url(name, looksLikeOptions ? {} : params), looksLikeOptions ? params : options);
    },
    /** A role's saved username and password, for tests that exercise the login form themselves. */
    credentials(roleName) {
      const r = findRole(roleName);
      if (!r) throw new Error(`There's no role called "${roleName}" in the App setup. Roles: ${roles.map((x) => x.name).join(', ') || 'none yet'}.`);
      if (r.blocked) throw new Error(`Role "${r.name}"'s saved password is only used with the project's saved application URL, not this one.`);
      if (!r.username || !r.password) throw new Error(`Role "${r.name}" has no ${!r.username ? 'username' : 'password'} saved. Add it in Test automation → App setup.`);
      return { username: r.username, password: r.password };
    },
    /** Signs in with a role's credentials using the login form (found automatically, or as set in App setup). */
    async loginAs(roleName) {
      const r = findRole(roleName);
      const { username, password } = app.credentials(roleName);
      const loginPath = login.path || '/login';
      await page.goto(loginPath);
      const user = login.usernameField ? field(login.usernameField)
        : page.locator('input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i]')
          .or(page.getByLabel(/e-?mail|user ?name|login/i)).first();
      const pass = login.passwordField ? field(login.passwordField) : page.locator('input[type="password"]').first();
      await user.fill(username);
      await pass.fill(password);
      const submit = login.submitButton ? button(login.submitButton)
        : page.getByRole('button', { name: /sign ?in|log ?in|continue|submit|enter/i }).or(page.locator('button[type="submit"], input[type="submit"]')).first();
      await submit.click();
      const check = String(login.success || '').trim();
      if (check.startsWith('/')) {
        await expect(page, `Signing in as ${r.name} should open ${check}`).toHaveURL(new RegExp(escapeRe(check)), { timeout: 15000 });
      } else if (check) {
        await expect(page.getByText(check).first(), `Signing in as ${r.name} should show “${check}”`).toBeVisible({ timeout: 15000 });
      } else {
        const here = loginPath.replace(/\/+$/, '') || '/';
        await page.waitForURL((u) => (u.pathname.replace(/\/+$/, '') || '/') !== here, { timeout: 15000 }).catch(() => {
          throw new Error(`Signing in as "${r.name}" didn't leave ${loginPath}. Check the role's username and password, or the login settings in App setup.`);
        });
      }
      await page.waitForLoadState('domcontentloaded');
    },
  };
  return app;
}

/** Replaces saved passwords in text (errors, logs) so they never show up in results. */
export function maskSecrets(text, cfg = {}) {
  let out = String(text ?? '');
  for (const r of cfg.roles || []) if (r.password && r.password.length >= 3) out = out.split(r.password).join('••••••');
  return out;
}
