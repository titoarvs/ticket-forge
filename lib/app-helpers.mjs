// The `app` helper that test scripts get, built from the project's App setup (Test automation page):
//   await app.goto('Orders')        open a page by its name
//   await app.goto('Order detail', { id: 1001 })   fill a dynamic route like /orders/:id
//   await app.loginAs('Admin')      sign in with that role's saved credentials
//   app.url('Orders')               the page's path, e.g. for toHaveURL
//   app.credentials('Admin')        { username, password } for tests of the login form itself
//   app.mfaCode('Admin')            the role's current authenticator code, for tests of the MFA step itself
// Roles sign in one of three ways (App setup → Roles & logins → Sign-in):
//   form    — the app's own login form (username + password);
//   sso     — the app's single sign-on button, then the identity provider's pages (Microsoft Entra, Google, Okta,
//             Auth0, Keycloak, or any username/password page), including "Stay signed in?" and account pickers;
//   session — a signed-in session saved once by hand (cookies + local storage), for providers that block automated
//             browsers (Google often does) or MFA that can't be automated (passkeys, push approvals).
// Form and SSO sign-ins fill an authenticator (TOTP) code automatically when the role has its MFA secret saved.
import { totp } from './totp.mjs';
// Used by the test runner (lib/runner.mjs) and by the server for page snapshots, page discovery and login tests.

const norm = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase();
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** CSS/XPath selectors are used as they are; anything else is treated as a label, placeholder or button text. */
const isSelector = (s) => /^(css=|xpath=|\/\/|[#.[]|[a-z][\w-]*(\[|#|\.|:|\s*>))/i.test(String(s).trim());

export const LOGOUT_RE = /log ?out|sign ?out|logoff/i;
/** Is the page on a login, sign-in or MFA step (so not signed in yet)? */
export function onLoginish(page, loginPath = '') {
  let u;
  try {
    u = new URL(page.url());
  } catch {
    return true;
  }
  const here = u.pathname.replace(/\/+$/, '') || '/';
  if (loginPath && here === (String(loginPath).replace(/\/+$/, '') || '/')) return true;
  return /(^|\/)(log-?in|sign-?in|signin|auth\/(login|verify|mfa|callback)|verify-mfa|mfa|2fa|sso)(\/|$)/i.test(here);
}

// Where apps usually keep their login form. Tried in order when App setup doesn't name the login page, after
// any login-looking pages from App setup (a scan of the app's code lists those).
const LOGIN_CANDIDATES = [
  '/login',
  '/sign-in',
  '/signin',
  '/sign-in/manual',
  '/sign-in/email',
  '/sign-in/password',
  '/login/email',
  '/login/password',
  '/auth/login',
  '/auth/signin',
  '/auth/sign-in',
  '/account/login',
  '/users/sign_in',
  '/user/login',
  '/admin/login',
  '/',
];
const LOGIN_PAGE_RE = /log-?in|sign-?in|auth/i;
const NOT_LOGIN_RE = /sign-?up|register|forgot|reset|callback|verify|logout|log-?out|sign-?out|invite|:/i;

/** Login-looking paths from the App setup pages first (email/password forms before others), then the usual ones. */
export function loginCandidates(pages = []) {
  const own = pages
    .map((p) => String(p.path || ''))
    .filter((x) => x.startsWith('/') && LOGIN_PAGE_RE.test(x) && !NOT_LOGIN_RE.test(x))
    .sort((a, b) => (/manual|email|password|credential/i.test(b) ? 1 : 0) - (/manual|email|password|credential/i.test(a) ? 1 : 0));
  return [...new Set([...own, ...LOGIN_CANDIDATES])];
}
const USER_FIELD =
  'input[type="email"], input[autocomplete="username"], input[autocomplete="email"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i]';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A Login form setting that is a CSS selector (not a label, and not an email typed in the wrong box). */
const cssSetting = (v) => {
  const t = String(v || '').trim();
  return t && !EMAIL_RE.test(t) && /[\[#.=]/.test(t) ? t : '';
};
const SUBMIT_NAME = /^\s*(sign ?in|log ?in|continue|submit|enter|next)\b/i;
/** The login form's submit button: the one inside the password field's form, else a "Sign in"-like button. */
async function submitButton(page) {
  const inForm = page
    .locator('form:has(input[type="password"])')
    .locator('button[type="submit"], input[type="submit"], button:not([type])')
    .first();
  if (await inForm.count()) return inForm;
  return page.getByRole('button', { name: SUBMIT_NAME }).or(page.locator('button[type="submit"], input[type="submit"]')).first();
}

/**
 * Finds the login form: the page App setup names, or the first candidate page with a visible password field.
 * Leaves the browser on that page. Returns { path, tried }.
 */
export async function findLoginForm(page, cfg = {}) {
  const login = cfg.login || {};
  if (login.path) {
    await page.goto(login.path);
    return { path: login.path, tried: [login.path] };
  }
  const tried = [];
  for (const p of loginCandidates(cfg.pages)) {
    tried.push(p);
    try {
      const res = await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (res && res.status() >= 400) continue;
      // Apps that draw the form after loading (React, Next.js…) need a moment, so wait briefly for the field.
      if (
        await page
          .locator('input[type="password"]')
          .first()
          .waitFor({ state: 'visible', timeout: 5000 })
          .then(
            () => true,
            () => false,
          )
      ) {
        return { path: new URL(page.url()).pathname, tried };
      }
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    `Couldn't find a login form: none of ${tried.slice(0, 8).join(', ')}${tried.length > 8 ? '…' : ''} shows a password field. Set the login page in Test automation → App setup → Login form.`,
  );
}

/** The fields and button of the login form on the current page, described for people (no values). */
export async function describeLoginForm(page, login = {}) {
  const pick = (loc) =>
    loc
      .evaluate((el) => {
        const label =
          (el.labels && el.labels[0] && el.labels[0].innerText) ||
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.innerText ||
          el.value ||
          '';
        const name = el.getAttribute('name'),
          id = el.getAttribute('id');
        return {
          label: String(label).trim().replace(/\s+/g, ' ').slice(0, 40),
          selector: name ? `${el.tagName.toLowerCase()}[name="${name}"]` : id && !/[:\s]/.test(id) ? `#${id}` : el.tagName.toLowerCase(),
        };
      })
      .catch(() => null);
  const user = await pick(page.locator(cssSetting(login.usernameField) || USER_FIELD).first());
  const pass = await pick(page.locator(cssSetting(login.passwordField) || 'input[type="password"]').first());
  const submit = await pick(
    cssSetting(login.submitButton) ? page.locator(cssSetting(login.submitButton)).first() : await submitButton(page),
  );
  return { user, pass, submit };
}

// ---------------------------------------------------------------- MFA and identity-provider pages
const OTP_FIELD =
  'input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[name*="totp" i], input[id*="totp" i], input[name*="mfa" i], input[id*="mfa" i], input[name="otc"], input[name*="code" i]:not([type="hidden"]):not([type="checkbox"]), input[id*="code" i]:not([type="hidden"]):not([type="checkbox"]), input[name="totpPin"], input[name="answer"]';
const OTP_LABEL =
  /authentication code|verification code|one[- ]time|security code|6[- ]digit|authenticator|enter (the )?code|mfa code|2fa/i;
const SSO_BUTTON =
  /google|microsoft|azure|entra|office ?365|okta|auth0|keycloak|onelogin|ping|sso|single sign[- ]?on|saml|company account|work account|organi[sz]ation account|corporate/i;
const NEXT_BUTTON = /^\s*(next|continue|sign ?in|log ?in|submit|verify|confirm|proceed|yes|accept|allow|done)\b/i;
const IDP_BLOCKED =
  /this browser or app may not be secure|couldn.t sign you in|unusual activity|verify it.s you|captcha|i.m not a robot|are you a robot/i;

const visible = (loc, timeout = 0) =>
  loc
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(
      () => true,
      () => false,
    );
/** The first visible element among candidates, without waiting. */
async function firstVisible(loc) {
  const n = Math.min(await loc.count().catch(() => 0), 8);
  for (let i = 0; i < n; i++)
    if (
      await loc
        .nth(i)
        .isVisible()
        .catch(() => false)
    )
      return loc.nth(i);
  return null;
}
async function clickNext(page) {
  const b =
    (await firstVisible(page.locator('button[type="submit"], input[type="submit"], #idSIButton9, #okta-signin-submit, #kc-login'))) ||
    (await firstVisible(page.getByRole('button', { name: NEXT_BUTTON })));
  if (b) await b.click();
  else await page.keyboard.press('Enter');
}
/** An MFA code box on this page: a single field, or six one-digit boxes. */
async function otpField(page) {
  const one = (await firstVisible(page.locator(OTP_FIELD))) || (await firstVisible(page.getByLabel(OTP_LABEL)));
  if (one && (await one.getAttribute('maxlength').catch(() => null)) !== '1') return { one };
  const boxes = page.locator('input[maxlength="1"]:visible');
  if ((await boxes.count().catch(() => 0)) >= 4) return { boxes };
  return one ? { one } : null;
}
/** Fills the authenticator code. Waits for a fresh code when the current one is about to expire. */
async function fillMfa(page, f, role) {
  if (!role.totp)
    throw new Error(
      `Signing in as "${role.name}" asks for an authentication code. Save the role's authenticator (MFA) secret in Test automation → App setup → Roles & logins, or use a saved session.`,
    );
  let t = totp(role.totp);
  if (t.secondsLeft < 4) {
    await page.waitForTimeout(t.secondsLeft * 1000 + 300);
    t = totp(role.totp);
  }
  if (f.one) await f.one.fill(t.code);
  else {
    await f.boxes.first().click();
    await page.keyboard.type(t.code, { delay: 40 });
  }
  await clickNext(page);
}

/** After a sign-in is submitted: handle MFA and "Stay signed in?" prompts until the app is reached (or time runs out). */
async function finishSignIn(page, role, isDone, { timeout = 30000 } = {}) {
  const end = Date.now() + timeout;
  let mfaTries = 0;
  while (Date.now() < end) {
    if (await isDone()) return;
    const f = await otpField(page);
    if (f) {
      if (++mfaTries > 2) throw new Error(`The authentication code for "${role.name}" was refused twice. Check the role's MFA secret.`);
      await fillMfa(page, f, role);
      await page.waitForTimeout(1200);
      continue;
    }
    const kmsi = await firstVisible(
      page.locator('#KmsiCheckboxField, #idSIButton9').filter({ hasText: /yes/i }).or(page.locator('input#idSIButton9[value="Yes"]')),
    );
    if (kmsi && /stay signed in/i.test(await page.content().catch(() => ''))) {
      await kmsi.click();
      await page.waitForTimeout(800);
      continue;
    }
    await page.waitForTimeout(400);
  }
}

/** Fills an identity provider's sign-in pages (username → password → MFA → prompts) until it hands back to the app. */
async function idpSignIn(idp, role, backAtApp) {
  const end = Date.now() + 60000;
  let didUser = false,
    didPass = false,
    mfaTries = 0,
    steps = 0;
  while (Date.now() < end && steps < 25) {
    steps++;
    if (await backAtApp()) return;
    await idp.waitForLoadState('domcontentloaded').catch(() => {});
    const text = await idp
      .locator('body')
      .innerText({ timeout: 3000 })
      .catch(() => '');
    if (IDP_BLOCKED.test(text))
      throw new Error(
        `The identity provider (${new URL(idp.url()).host}) blocked the automated browser (“${(text.match(IDP_BLOCKED) || [''])[0]}”). Use a saved session for "${role.name}": App setup → Roles & logins → Sign-in → Saved session.`,
      );
    // Account pickers (Google "Choose an account", Microsoft "Pick an account")
    if (role.username && /choose an account|pick an account|select an account/i.test(text)) {
      const acct = await firstVisible(idp.getByText(role.username, { exact: false }));
      if (acct) {
        await acct.click();
        await idp.waitForTimeout(1200);
        continue;
      }
      const other = await firstVisible(idp.getByText(/use another account|use a different account/i));
      if (other) {
        await other.click();
        await idp.waitForTimeout(1200);
        continue;
      }
    }
    const f = await otpField(idp);
    const pass = await firstVisible(idp.locator('input[type="password"]'));
    const user = await firstVisible(
      idp.locator(
        'input[type="email"], input[name="loginfmt"], input[name="identifier"], input[name="username"], input[name="identifier" i], #okta-signin-username, input[autocomplete="username"], input[name*="email" i], input[name*="user" i]',
      ),
    );
    if (pass && !(await pass.inputValue().catch(() => ''))) {
      if (!role.password) throw new Error(`The identity provider asks for a password, but "${role.name}" has none saved.`);
      if (user && !(await user.inputValue().catch(() => '')) && role.username) await user.fill(role.username);
      await pass.fill(role.password);
      didPass = true;
      await clickNext(idp);
      await idp.waitForTimeout(1500);
      continue;
    }
    if (f && didPass) {
      if (++mfaTries > 2) throw new Error(`The authentication code for "${role.name}" was refused twice. Check the role's MFA secret.`);
      await fillMfa(idp, f, role);
      await idp.waitForTimeout(1500);
      continue;
    }
    if (user && !didUser && !(await user.inputValue().catch(() => ''))) {
      if (!role.username) throw new Error(`The identity provider asks for a username, but "${role.name}" has none.`);
      await user.fill(role.username);
      didUser = true;
      await clickNext(idp);
      await idp.waitForTimeout(1500);
      continue;
    }
    // "Stay signed in?", consent and "Continue" screens
    const yes =
      (await firstVisible(idp.locator('#idSIButton9, button[name="approve"], #submit_approve_access, input[name="allow"]'))) ||
      (await firstVisible(idp.getByRole('button', { name: /^(yes|continue|accept|allow|approve|confirm)\b/i })));
    if (yes && (didUser || didPass)) {
      await yes.click();
      await idp.waitForTimeout(1500);
      continue;
    }
    await idp.waitForTimeout(700);
  }
  if (!(await backAtApp()))
    throw new Error(
      `Signing in as "${role.name}" through ${(() => {
        try {
          return new URL(idp.url()).host;
        } catch {
          return 'the identity provider';
        }
      })()} didn't come back to the app. Check the username and password, or use a saved session.`,
    );
}

/** Puts a saved session (Playwright storage state: cookies + local storage) into this browser. */
async function restoreSession(page, state) {
  const ctx = page.context();
  if (state.cookies?.length)
    await ctx.addCookies(state.cookies.map((c) => ({ ...c, expires: c.expires && c.expires > 0 ? c.expires : -1 })));
  for (const o of state.origins || []) {
    if (!o.localStorage?.length) continue;
    await page.goto(o.origin, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page
      .evaluate((items) => {
        for (const { name, value } of items) localStorage.setItem(name, value);
      }, o.localStorage)
      .catch(() => {});
  }
}

/** cfg = { pages: [{ name, path }], roles: [{ id, name, username, password, signIn, ssoButton, totp, session }], login: { path, usernameField, passwordField, submitButton, success } } */
export function makeApp(page, expect, cfg = {}) {
  const pages = cfg.pages || [];
  const roles = cfg.roles || [];
  const login = cfg.login || {};
  const findPage = (name) => pages.find((p) => norm(p.name) === norm(name) || norm(p.path) === norm(name) || p.id === name);
  const findRole = (name) => roles.find((r) => norm(r.name) === norm(name) || r.id === name);
  const field = (spec) => (isSelector(spec) ? page.locator(spec) : page.getByLabel(spec).or(page.getByPlaceholder(spec))).first();
  const button = (spec) =>
    (isSelector(spec) ? page.locator(spec) : page.getByRole('button', { name: spec }).or(page.getByRole('link', { name: spec }))).first();

  /** Things worth telling the person about the last sign-in (settings that were ignored). */
  const notes = [];
  const usable = (spec, label, values) => {
    const v = String(spec || '').trim();
    if (!v) return '';
    if (values.some((x) => x && v === String(x)) || EMAIL_RE.test(v)) {
      notes.push(
        `The Login form's “${label}” setting holds a login value, not a ${label === 'Sign-in button' ? 'button text' : 'field label'}, so it was ignored. Put email addresses and passwords in Roles & logins, and leave this setting empty or set it to the label (like “Email”).`,
      );
      return '';
    }
    return v;
  };
  const settingOrAuto = async (spec, make, auto, label) => {
    if (!spec) return auto;
    const loc = make(spec);
    if (
      await loc.waitFor({ state: 'visible', timeout: 4000 }).then(
        () => true,
        () => false,
      )
    )
      return loc;
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
      if (!p)
        throw new Error(`There's no page called "${name}" in the App setup. Pages: ${pages.map((x) => x.name).join(', ') || 'none yet'}.`);
      const missing = [];
      const out = String(p.path || '/')
        .replace(/:(\w+)([*?]?)/g, (_m, key, mod) => {
          const v = params?.[key];
          if (v === undefined || v === null || v === '') {
            if (!mod) missing.push(key);
            return '';
          }
          return Array.isArray(v) ? v.map(encodeURIComponent).join('/') : encodeURIComponent(String(v));
        })
        .replace(/\/{2,}/g, '/')
        .replace(/(.)\/$/, '$1');
      if (missing.length)
        throw new Error(
          `Page "${p.name}" (${p.path}) needs ${missing.join(', ')}: app.goto('${p.name}', { ${missing.map((k) => `${k}: …`).join(', ')} }).`,
        );
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
      if (!r)
        throw new Error(
          `There's no role called "${roleName}" in the App setup. Roles: ${roles.map((x) => x.name).join(', ') || 'none yet'}.`,
        );
      if (r.blocked)
        throw new Error(`Role "${r.name}"'s saved password is only used with the project's saved application URL, not this one.`);
      if (!r.username || !r.password)
        throw new Error(
          `Role "${r.name}" has no ${!r.username ? 'username' : 'password'} saved. Add it in Test automation → App setup${r.signIn === 'session' ? '' : ', or switch the role to a saved session'}.`,
        );
      return { username: r.username, password: r.password };
    },
    /** The role's current authenticator (TOTP) code. */
    mfaCode(roleName) {
      const r = findRole(roleName);
      if (!r?.totp) throw new Error(`Role "${roleName}" has no authenticator (MFA) secret saved.`);
      return totp(r.totp).code;
    },
    /** Signs in as a role: its login form, its SSO provider, or its saved session (App setup → Roles & logins). */
    async loginAs(roleName) {
      const r = findRole(roleName);
      if (!r)
        throw new Error(
          `There's no role called "${roleName}" in the App setup. Roles: ${roles.map((x) => x.name).join(', ') || 'none yet'}.`,
        );
      if (r.signIn === 'session') return app.restoreSession(r);
      if (r.signIn === 'sso') return app.ssoSignIn(r);
      const { username, password } = app.credentials(roleName);
      // The login page from App setup, or found once per run and remembered.
      if (!app.loginPath) app.loginPath = (await findLoginForm(page, cfg)).path;
      else await page.goto(app.loginPath);
      const loginPath = app.loginPath;
      // Custom settings from App setup, unless they hold a login value instead of a label (a common mix-up),
      // and only when they match something on the page; otherwise the field is found automatically.
      const autoUser = page
        .locator(USER_FIELD)
        .or(page.getByLabel(/e-?mail|user ?name|login/i))
        .first();
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
      // An MFA step (TOTP) after the password, then the app.
      await finishSignIn(page, r, async () => !onLoginish(page, loginPath), { timeout: 12000 });
      await app.expectSignedIn(r, loginPath);
    },
    /** Waits until signing in as `r` reached the app: the Login form's "Signed in when…" check, or leaving the login page. */
    async expectSignedIn(r, loginPath = app.loginPath) {
      if (/^chrome-error:|^about:blank/.test(page.url()))
        throw new Error(`Signing in as "${r.name}" ended on a browser error page: the app didn't load after the sign-in was sent.`);
      const check = String(login.success || '').trim();
      if (check.startsWith('/')) {
        await expect(page, `Signing in as ${r.name} should open ${check}`).toHaveURL(new RegExp(escapeRe(check)), { timeout: 15000 });
      } else if (check) {
        await expect(page.getByText(check).first(), `Signing in as ${r.name} should show “${check}”`).toBeVisible({ timeout: 15000 });
      } else {
        const here = loginPath.replace(/\/+$/, '') || '/';
        await page
          .waitForURL((u) => (u.pathname.replace(/\/+$/, '') || '/') !== here, { timeout: 15000 })
          .catch(() => {
            throw new Error(
              `Signing in as "${r.name}" didn't leave ${loginPath}. Check the role's username and password, or the login settings in App setup.`,
            );
          });
      }
      await page.waitForLoadState('domcontentloaded');
    },
    /** SSO: the app's sign-in button for the identity provider, then the provider's pages, then back to the app. */
    async ssoSignIn(r) {
      if (!app.loginPath) {
        // The login page from App setup, else the first usual one that shows an SSO button.
        for (const p of loginCandidates(pages)) {
          try {
            const res = await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 15000 });
            if (res && res.status() >= 400) continue;
          } catch {
            continue;
          }
          if (await visible(page.getByRole('button', { name: SSO_BUTTON }).or(page.getByRole('link', { name: SSO_BUTTON })), 5000)) {
            app.loginPath = new URL(page.url()).pathname;
            break;
          }
        }
        if (!app.loginPath)
          throw new Error(
            `Couldn't find a sign-in page with an SSO button for "${r.name}". Set the login page in App setup → Login form, and the button text on the role.`,
          );
      } else await page.goto(app.loginPath);
      const appOrigin = new URL(page.url()).origin;
      const btn = r.ssoButton
        ? button(r.ssoButton)
        : page
            .getByRole('button', { name: SSO_BUTTON })
            .or(page.getByRole('link', { name: SSO_BUTTON }))
            .first();
      if (!(await visible(btn, 8000)))
        throw new Error(
          `No SSO button${r.ssoButton ? ` “${r.ssoButton}”` : ''} on ${app.loginPath}. Set the button's text on the role (e.g. “Sign in with Google”).`,
        );
      // Some apps open the provider in a pop-up window.
      const popupP = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
      await btn.click();
      const popup = await popupP;
      const idp = popup || page;
      const loginPath = app.loginPath;
      const backAtApp = async () =>
        (popup ? popup.isClosed() : false) ||
        (!page.isClosed() && new URL(page.url()).origin === appOrigin && !onLoginish(page, loginPath) && !popup);
      await idpSignIn(idp, r, async () => {
        if (popup && popup.isClosed()) return true;
        try {
          const u = new URL(idp.url());
          return u.origin === appOrigin && !onLoginish(idp, loginPath);
        } catch {
          return false;
        }
      });
      if (popup) await popup.waitForEvent('close', { timeout: 20000 }).catch(() => {});
      await finishSignIn(page, r, backAtApp, { timeout: 15000 });
      await app.expectSignedIn(r, loginPath);
    },
    /** Saved session: put its cookies and local storage in the browser, open the app, and check it's still signed in. */
    async restoreSession(r) {
      if (!r.session)
        throw new Error(`Role "${r.name}" has no saved session. In App setup → Roles & logins, choose “Sign in in a browser” to save one.`);
      await restoreSession(page, r.session);
      const start = String(login.success || '').startsWith('/') ? login.success : r.session.landing || '/';
      await page.goto(start, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      if (onLoginish(page, app.loginPath))
        throw new Error(
          `The saved session for "${r.name}" has expired (the app asked to sign in again). Save a new one: App setup → Roles & logins → Sign in in a browser.`,
        );
      await page.waitForLoadState('domcontentloaded');
    },
  };
  return app;
}

/** Replaces saved passwords in text (errors, logs) so they never show up in results. */
export function maskSecrets(text, cfg = {}) {
  let out = String(text ?? '');
  // The Test database for app.db: its connection string and password never show up either.
  const url = cfg.db?.url;
  if (url) {
    out = out.split(url).join('[test database]');
    try {
      const pw = decodeURIComponent(new URL(url).password);
      if (pw.length >= 3) out = out.split(pw).join('••••••');
    } catch {
      /* not a URL */
    }
  }
  for (const r of cfg.roles || []) {
    if (r.password && r.password.length >= 3) out = out.split(r.password).join('••••••');
    if (r.totp && r.totp.length >= 8) out = out.split(r.totp).join('••••••');
  }
  return out;
}
