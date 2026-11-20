'use client';
import { useState } from 'react';
import { type Any, S, emit, copyText, closeModal, toast } from '../core';
import { Ico, I, Modal, Spinner } from '../ui';
import { aiAction, saveAiSettings } from '../api/admin';
import { SF, MenuItem, TF, PeopleF } from '../fields';
import { A } from './UsersTab';

// ---------------------------------------------------------------- AI connection
/** Stores the admin view of the AI connection and refreshes the top-bar status. */
export function applyAi(st: Any) {
  A.ai = st;
  const acct = st.account;
  S.status = {
    ...(S.status || {}),
    ...st,
    account: acct && {
      cli: acct.cli,
      signedIn: acct.signedIn,
      loggedIn: acct.loggedIn,
      subscriptionType: acct.subscriptionType,
    },
  };
  emit();
}
export const PLAN: Record<string, string> = {
  pro: 'Pro',
  max: 'Max',
  team: 'Team',
  enterprise: 'Enterprise',
  free: 'Free',
};
export function envExample(c: Any, id: string) {
  const p = c.providers.find((x: Any) => x.id === id) || {};
  const lines = [`AI_PROVIDER=${id}`];
  if (id === 'ollama') lines.push(`AI_BASE_URL=${p.base}`);
  else if (id === 'custom')
    lines.push('AI_BASE_URL=https://your-endpoint.example.com/v1', 'AI_API_KEY=your-key');
  else lines.push(`AI_API_KEY=your-key        # or ${p.keys?.[0]}`);
  lines.push(p.model ? `AI_MODEL=${p.model}` : 'AI_MODEL=a-model-your-key-can-use');
  return lines.join('\n');
}
export const MISSING: Record<string, string> = {
  provider: 'a provider',
  key: 'the API key',
  model: 'the model',
  baseUrl: 'the endpoint URL',
};
export const join = (xs: string[]) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '';
export function TestResult({ t, onPick }: { t: Any; onPick?: (m: string) => void }) {
  if (t.ok)
    return (
      <div className="ok-banner">
        <Ico svg={I.check} />
        <span>
          Connected
          {t.used ? (
            <>
              {' '}
              using <b>{t.used}</b>
            </>
          ) : (
            ''
          )}
          . The AI replied “{t.reply}” in {(t.ms / 1000).toFixed(1)} s.
        </span>
      </div>
    );
  return (
    <div className="test-fail">
      <div className="warn-banner danger">
        <Ico svg={I.warn} />
        <span>{t.error}</span>
      </div>
      {t.models?.length > 0 && <ModelList models={t.models} onPick={onPick} />}
    </div>
  );
}
function ModelList({ models, onPick }: { models: string[]; onPick?: (m: string) => void }) {
  return (
    <>
      <p className="small" style={{ margin: '12px 0 6px' }}>
        {models.length} models this key can use{onPick ? '. Click one to use it' : ''}:
      </p>
      <div className="model-list">
        {models.map((m) => (
          <button
            key={m}
            type="button"
            className="label-chip"
            onClick={() => (onPick ? onPick(m) : copyText(m))}
          >
            {m}
          </button>
        ))}
      </div>
    </>
  );
}
/** Add or edit one AI provider. The key is saved encrypted and never shown again. */
export function ProviderModal({ c, entry }: { c: Any; entry?: Any }) {
  const saved = entry
    ? (c.settings?.providers || []).find((x: Any) => x.id === entry.entryId)
    : null;
  const [f, setF] = useState(() => ({
    provider: saved?.provider || 'claude-sub',
    model: saved?.model || '',
    baseUrl: saved?.baseUrl || '',
    apiKey: '',
  }));
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Any>(null);
  const [models, setModels] = useState<string[]>([]);
  const p = c.providers.find((x: Any) => x.id === f.provider) || {};
  const set = (k: string, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setResult(null);
  };
  const pickProvider = (v: string) => {
    setF({ provider: v, model: '', baseUrl: '', apiKey: '' });
    setModels([]);
    setResult(null);
  };
  // The saved key is reused only for the same provider and endpoint, so it's never sent to a
  // different service.
  const keepsKey = Boolean(
    saved?.hasKey &&
    saved.provider === f.provider &&
    (saved.baseUrl || '') === f.baseUrl.trim().replace(/\/+$/, ''),
  );
  const keyOptional = f.provider === 'ollama' || f.provider === 'custom';
  const needsUrl = f.provider === 'custom';
  const sub = p.kind === 'claude-code';
  const [advanced, setAdvanced] = useState(Boolean(saved?.baseUrl) && !needsUrl);
  const showUrl = !sub && (needsUrl || f.provider === 'ollama' || advanced);
  const canSave = Boolean(
    f.provider &&
    (f.model.trim() || p.model) &&
    (!needsUrl || f.baseUrl.trim()) &&
    (keyOptional || keepsKey || f.apiKey.trim()),
  );
  const draft = {
    id: saved?.id,
    provider: f.provider,
    model: f.model.trim(),
    baseUrl: f.baseUrl.trim(),
    apiKey: f.apiKey.trim(),
  };
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e: Any) {
      setResult({ ok: false, error: e.message });
    } finally {
      setBusy('');
    }
  };
  const loadModels = () =>
    run('models', async () => {
      const r = await aiAction({ action: 'models', draft });
      setModels(r.models || []);
      if (!r.models?.length)
        setResult({
          ok: false,
          error: 'The provider didn’t list any models. Type the model name instead.',
        });
    });
  const test = () => run('test', async () => setResult(await aiAction({ action: 'test', draft })));
  const save = () =>
    run('save', async () => {
      applyAi(await saveAiSettings(draft));
      closeModal();
      toast(saved ? `${p.label} updated` : `${p.label} added`);
    });
  return (
    <Modal
      title={saved ? `Edit ${p.label || 'provider'}` : 'Add an AI provider'}
      wide
      left={
        <button className="btn" disabled={!!busy || !canSave} onClick={test}>
          {busy === 'test' ? (
            <>
              <Spinner />
              Testing…
            </>
          ) : (
            'Test'
          )}
        </button>
      }
      actions={[
        { label: 'Cancel' },
        {
          label: busy === 'save' ? 'Saving…' : saved ? 'Save' : 'Add provider',
          kind: 'primary',
          disabled: !!busy || !canSave,
          onClick: save,
        },
      ]}
    >
      <div className="grid2">
        <label className="field">
          <span>Provider</span>
          <SF value={f.provider} onChange={(e) => pickProvider(e.target.value)}>
            {c.providers.map((x: Any) => (
              <MenuItem key={x.id} value={x.id}>
                {x.label}
              </MenuItem>
            ))}
          </SF>
        </label>
        <label className="field">
          <span>
            {p.keyLabel || 'API key'}
            {keyOptional ? ' (optional)' : ''}
          </span>
          <TF
            type="password"
            value={f.apiKey}
            onChange={(e) => set('apiKey', e.target.value)}
            autoComplete="off"
            placeholder={
              keepsKey
                ? `Saved, ends with ${saved.keyHint}. Leave blank to keep it`
                : sub
                  ? 'sk-ant-oat01-… from claude setup-token'
                  : p.site
                    ? `Paste your key from ${p.site}`
                    : 'Paste your API key'
            }
          />
        </label>
      </div>
      {sub && (
        <div className="sub-note small">
          <p style={{ margin: '0 0 6px' }}>
            <b>Shared:</b> everyone’s AI requests use this plan. To use your subscription only for
            yourself, set it up in <b>My AI</b> (your avatar menu) instead; each person can add
            their own there. TicketForge runs Claude Code on this server, signed in with the token
            (no API billing).
          </p>
          <ol style={{ margin: '0 0 6px', paddingLeft: 18 }}>
            <li>
              In a terminal on your computer run <code>claude setup-token</code> and sign in with
              your Claude account.
            </li>
            <li>
              Paste the <code>sk-ant-oat01-…</code> token it prints here (shown once; valid for a
              year).
            </li>
          </ol>
          <p className="muted" style={{ margin: 0 }}>
            Needs Claude Code installed where TicketForge runs (your computer or a VPS:{' '}
            <code>npm install -g @anthropic-ai/claude-code</code>); serverless hosting such as
            Vercel can’t run it. It counts toward your plan’s limits, and your plan is meant for
            your own use: for a whole team, use a team plan or an API.
          </p>
        </div>
      )}
      {showUrl ? (
        <label className="field">
          <span>Endpoint URL{needsUrl ? '' : ' (optional)'}</span>
          <TF
            value={f.baseUrl}
            onChange={(e) => set('baseUrl', e.target.value)}
            placeholder={p.base || 'https://your-endpoint.example.com/v1'}
            spellCheck={false}
          />
          {!needsUrl && (
            <span className="muted small" style={{ fontWeight: 400 }}>
              Leave blank for {p.base || 'the default'}.
            </span>
          )}
        </label>
      ) : sub ? null : (
        <p className="small" style={{ margin: '-4px 0 12px' }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setAdvanced(true);
            }}
          >
            Use a custom endpoint
          </a>
        </p>
      )}
      <div className="field">
        <span>Model</span>
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'stretch' }}>
          <PeopleF
            avatars={false}
            value={f.model}
            onChange={(v) => set('model', v)}
            options={models}
            placeholder={p.model ? `${p.model} (default)` : 'Type a model name, or load the list'}
          />
          <button
            type="button"
            className="btn"
            disabled={
              !!busy ||
              (!keyOptional && !keepsKey && !f.apiKey.trim()) ||
              (needsUrl && !f.baseUrl.trim())
            }
            onClick={loadModels}
          >
            {busy === 'models' ? (
              <>
                <Spinner />
                Loading…
              </>
            ) : (
              'Load models'
            )}
          </button>
        </div>
      </div>
      {models.length > 0 && !result && (
        <ModelList models={models} onPick={(m) => set('model', m)} />
      )}
      {result && (
        <div style={{ marginTop: 12 }}>
          <TestResult t={result} onPick={(m) => set('model', m)} />
        </div>
      )}
    </Modal>
  );
}
