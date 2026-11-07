// Sign-in screens: first-run setup, login, forgot/reset password, accept invite.
import { I } from './icons.js';
import { $, esc, S, api, toast, hooks } from './core.js';

const shell = (title, sub, body, foot = '') => `
  <div class="auth-wrap"><div class="auth-card">
    <div class="auth-brand"><span class="brand-mark">${I.logo}</span>TicketForge</div>
    <h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}
    <form id="authForm" novalidate>${body}<div class="auth-err" id="authErr" role="alert"></div></form>
    ${foot ? `<div class="auth-foot">${foot}</div>` : ''}
  </div></div>`;
const field = (id, label, type = 'text', extra = '') => `<label class="field"><span>${label}</span><input class="input" id="${id}" type="${type}" ${extra}></label>`;

export async function renderAuth(route) {
  const app = $('#app');
  $('#topnav').innerHTML = '';
  let submit;
  if (route.name === 'setup') {
    app.innerHTML = shell('Set up TicketForge', 'Create the owner account. The owner has full access and can invite your team.',
      `${field('aName', 'Your name', 'text', 'autocomplete="name" required')}${field('aEmail', 'Work email', 'email', 'autocomplete="email" required')}
       ${field('aPass', 'Password (at least 8 characters)', 'password', 'autocomplete="new-password" required minlength="8"')}
       <button class="btn primary wide" type="submit">Create owner account</button>`,
      `${I.settings} Database: ${esc(S.auth?.database || '')}`);
    submit = () => api('/api/auth/setup', { method: 'POST', body: { name: $('#aName').value, email: $('#aEmail').value, password: $('#aPass').value } });
  } else if (route.name === 'forgot') {
    app.innerHTML = shell('Forgot your password?', 'Enter your email and we’ll send you a link to reset it.',
      `${field('aEmail', 'Email', 'email', 'autocomplete="email" required')}<button class="btn primary wide" type="submit">Send reset link</button>`,
      '<a href="#/login">Back to sign in</a>');
    submit = async () => {
      const r = await api('/api/auth/forgot', { method: 'POST', body: { email: $('#aEmail').value } });
      $('#authForm').innerHTML = `<div class="auth-ok">${I.check}<div>If an account exists for that email, a reset link is on its way.${r.emailConfigured ? '' : '<br><span class="muted small">Email isn’t set up on this server yet — ask an administrator to send you a reset link from Administration → Users.</span>'}</div></div>`;
      return null;
    };
  } else if (route.name === 'reset') {
    app.innerHTML = shell('Choose a new password', '',
      `${field('aPass', 'New password (at least 8 characters)', 'password', 'autocomplete="new-password" required minlength="8"')}
       ${field('aPass2', 'Confirm new password', 'password', 'autocomplete="new-password" required')}
       <button class="btn primary wide" type="submit">Save password and sign in</button>`, '<a href="#/login">Back to sign in</a>');
    submit = () => {
      if ($('#aPass').value !== $('#aPass2').value) throw new Error('The passwords don’t match.');
      return api('/api/auth/reset', { method: 'POST', body: { token: route.token, password: $('#aPass').value } });
    };
  } else if (route.name === 'invite') {
    let info;
    try { info = await api(`/api/invites/${encodeURIComponent(route.token)}`); }
    catch (e) { app.innerHTML = shell('Invite unavailable', esc(e.message), '', '<a href="#/login">Go to sign in</a>'); return; }
    app.innerHTML = shell('Join your team on TicketForge', `<b>${esc(info.inviter)}</b> invited <b>${esc(info.email)}</b> as <b>${esc(info.role)}</b>.`,
      `${info.message ? `<blockquote class="auth-quote">${esc(info.message)}</blockquote>` : ''}
       ${field('aName', 'Your name', 'text', 'autocomplete="name" required')}
       ${field('aPass', 'Create a password (at least 8 characters)', 'password', 'autocomplete="new-password" required minlength="8"')}
       <button class="btn primary wide" type="submit">Accept invite</button>`);
    submit = () => api(`/api/invites/${encodeURIComponent(route.token)}/accept`, { method: 'POST', body: { name: $('#aName').value, password: $('#aPass').value } });
  } else {
    app.innerHTML = shell('Sign in', 'Sign in to continue to TicketForge.',
      `${field('aEmail', 'Email', 'email', 'autocomplete="username" required')}${field('aPass', 'Password', 'password', 'autocomplete="current-password" required')}
       <button class="btn primary wide" type="submit">Sign in</button>`,
      '<a href="#/forgot">Forgot password?</a><span class="muted">·</span><span class="muted">New here? Ask an administrator for an invite.</span>');
    submit = () => api('/api/auth/login', { method: 'POST', body: { email: $('#aEmail').value, password: $('#aPass').value } });
  }
  $('#authForm')?.querySelector('input')?.focus();
  $('#authForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#authForm button[type="submit"]');
    $('#authErr').textContent = '';
    if (btn) btn.disabled = true;
    try {
      const res = await submit();
      if (res?.user) {
        S.user = res.user;
        toast(`Welcome, ${res.user.name}`);
        await hooks.afterLogin();
      }
    } catch (err) {
      const box = $('#authErr');
      if (box) box.textContent = err.message;
    } finally { if (btn) btn.disabled = false; }
  });
}
