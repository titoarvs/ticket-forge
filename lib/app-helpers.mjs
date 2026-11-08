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

// Where apps usually keep their login form. Tried in order when App setup doesn't name the login page, after
// any login-looking pages from App setup (a scan of the app's code lists those).
export const LOGIN_CANDIDATES = ['/login', '/sign-in', '/signin', '/sign-in/manual', '/sign-in/email', '/sign-in/password', '/login/email', '/login/password',
  '/auth/login', '/auth/signin', '/auth/sign-in', '/account/login', '/users/sign_in', '/user/login', '/admin/login', '/'];
const LOGIN_PAGE_RE = /log-?in|sign-?in|auth/i;
const NOT_LOGIN_RE = /sign-?up|register|forgot|reset|callback|verify|logout|log-?out|sign-?out|invite|:/i;

/** Login-looking paths from the App setup pages first (email/password forms before others), then the usual ones. */
export function loginCandidates(pages = []) {
  const own = pages.map((p) => String(p.path || '')).filter((x) => x.startsWith('/') && LOGIN_PAGE_RE.test(x) && !NOT_LOGIN_RE.test(x))
    .sort((a, b) => (/manual|email|password|credential/i.test(b) ? 1 : 0) - (/manual|email|password|credential/i.test(a) ? 1 : 0));
  return [...new Set([...own, ...LOGIN_CANDIDATES])];
}
const USER_FIELD = 'input[type="email"], input[autocomplete="username"], input[autocomplete="email"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i]';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A Login form setting that is a CSS selector (not a label, and not an email typed in the wrong box). */
const cssSetting = (v) => { const t = String(v || '').trim(); return t && !EMAIL_RE.test(t) && /[\[#.=]/.test(t) ? t : ''; };
const SUBMIT_NAME = /^\s*(sign ?in|log ?in|continue|submit|enter|next)\b/i;
/** The login form's submit button: the one inside the password field's form, else a "Sign in"-like button. */
async function submitButton(page) {
  const inForm = page.locator('form:has(input[type="password"])').locator('button[type="submit"], input[type="submit"], button:not([type])').first();
  if (await inForm.count()) return inForm;
  return page.getByRole('button', { name: SUBMIT_NAME }).or(page.locator('button[type="submit"], input[type="submit"]')).first();
}

/**
 * Finds the login form: the page App setup names, or the first candidate page with a visible password field.
 * Leaves the browser on that page. Returns { path, tried }.
 */
export async function findLoginForm(page, cfg = {}) {
  const login = cfg.login || {};
  if (login.path) { await page.goto(login.path); return { path: login.path, tried: [login.path] }; }
  const tried = [];
  for (const p of loginCandidates(cfg.pages)) {
    tried.push(p);
    try {
      const res = await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (res && res.status() >= 400) continue;
      // Apps that draw the form after loading (React, Next.js…) need a moment, so wait briefly for the field.
      if (await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
        return { path: new URL(page.url()).pathname, tried };
      }
    } catch { /* try the next one */ }
  }
  throw new Error(`Couldn't find a login form: none of ${tried.slice(0, 8).join(', ')}${tried.length > 8 ? '…' : ''} shows a password field. Set the login page in Test automation → App setup → Login form.`);
}

/** The fields and button of the login form on the current page, described for people (no values). */
export async function describeLoginForm(page, login = {}) {
  const pick = (loc) => loc.evaluate((el) => {
    const label = (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || '';
    const name = el.getAttribute('name'), id = el.getAttribute('id');
    return { label: String(label).trim().replace(/\s+/g, ' ').slice(0, 40), selector: name ? `${el.tagName.toLowerCase()}[name="${name}"]` : id && !/[:\s]/.test(id) ? `#${id}` : el.tagName.toLowerCase() };
  }).catch(() => null);
  const user = await pick(page.locator(cssSetting(login.usernameField) || USER_FIELD).first());
  const pass = await pick(page.locator(cssSetting(login.passwordField) || 'input[type="password"]').first());
  const submit = await pick(cssSetting(login.submitButton) ? page.locator(cssSetting(login.submitButton)).first() : await submitButton(page));
  return { user, pass, submit };
}

/** cfg = { pages: [{ name, path }], roles: [{ id, name, username, password }], login: { path, usernameField, passwordField, submitButton, success } } */
export function makeApp(page, expect, cfg = {}) {
  const pages = cfg.pages || [];
  const roles = cfg.roles || [];
  const login = cfg.login || {};
  const findPage = (name) => pages.find((p) => norm(p.name) === norm(name) || norm(p.path) === norm(name) || p.id === name);
  const findRole = (name) => roles.find((r) => norm(r.name) === norm(name) || r.id === name);
  const field = (spec) => (isSelector(spec) ? page.locator(spec) : page.getByLabel(spec).or(page.getByPlaceholder(spec))).first();
  const button = (spec) => (isSelector(spec) ? page.locator(spec) : page.getByRole('button', { name: spec }).or(page.getByRole('link', { name: spec }))).first();

  /** Things worth telling the person about the last sign-in (settings that were ignored). */
  const notes = [];
  const usable = (spec, label, values) => {
    const v = String(spec || '').trim();
    if (!v) return '';
    if (values.some((x) => x && v === String(x)) || EMAIL_RE.test(v)) {
      notes.push(`The Login form's “${label}” setting holds a login value, not a ${label === 'Sign-in button' ? 'button text' : 'field label'}, so it was ignored. Put email addresses and passwords in Roles & logins, and leave this setting empty or set it to the label (like “Email”).`);
      return '';
    }
    return v;
  };
  const settingOrAuto = async (spec, make, auto, label) => {
    if (!spec) return auto;
    const loc = make(spec);
    if (await loc.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) return loc;
    notes.push(`The Login form's “${label}” setting (“${spec}”) matched nothing on the page, so it was found automatically instead.`);
    return auto;
  };

  const app = {
    notes,
    /** The login page: from App setup, or the one loginAs found. */
    loginPath: login.path || '',
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
      // The login page from App setup, or found once per run and remembered.
      if (!app.loginPath) app.loginPath = (await findLoginForm(page, cfg)).path;
      else await page.goto(app.loginPath);
      const loginPath = app.loginPath;
      // Custom settings from App setup, unless they hold a login value instead of a label (a common mix-up),
      // and only when they match something on the page; otherwise the field is found automatically.
      const autoUser = page.locator(USER_FIELD).or(page.getByLabel(/e-?mail|user ?name|login/i)).first();
      const autoPass = page.locator('input[type="password"]').first();
      const userSpec = usable(login.usernameField, 'Username field', [username, password]);
      const passSpec = usable(login.passwordField, 'Password field', [username, password]);
      const user = await settingOrAuto(userSpec, field, autoUser, 'Username field');
      const pass = await settingOrAuto(passSpec, field, autoPass, 'Password field');
      await user.fill(username);
      await pass.fill(password);
      const btnSpec = usable(login.submitButton, 'Sign-in button', [username, password]);
      const submit = await settingOrAuto(btnSpec, button, await submitButton(page), 'Sign-in button');
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
