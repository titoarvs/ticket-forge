'use client';
import { useState, useEffect } from 'react';
import { P, type Any, api, toast, openModal } from '../core';
import { ErrorState, SetCard, Spinner, Confirm, Ico, I, EmptyState } from '../ui';
import { TF, SF, MenuItem } from '../fields';
import { MineCard, UsageCard } from './MineCard';
import { TestResult, SchemaCard } from './SchemaCard';

export type Env = {
  id: string;
  name: string;
  kind: string;
  engine: string;
  host: string;
  port: number;
  database: string;
  user: string;
  updatedAt: string;
  updatedBy: string | null;
  lastTest?: {
    ok: boolean;
    at: string;
    by: string | null;
    version?: string;
    tables?: number;
    canWrite?: boolean;
    error?: string;
  } | null;
};
type Setup = { kind: string; value: string; updatedAt?: string; updatedBy?: string | null };
export type Data = {
  manage: boolean;
  local: boolean;
  mine: Env | null;
  envs: Env[];
  setup: Setup | null;
  engines: Record<string, string>;
  kinds: Record<string, string>;
  setupKinds: Record<string, string>;
};
const KIND_HELP: Record<string, string> = {
  test: 'A database you can reset. Code jobs and the step before each test run may write to it.',
  staging: 'A shared copy of the app. TicketForge only reads from it.',
  production: 'The live database. TicketForge reads its structure only, never its rows.',
};
const blank = { id: '', name: 'Test', kind: 'test', engine: 'postgres', url: '' };
// What a connection string looks like for each engine, and where it points (a SQLite connection is
// a file).
const EXAMPLE: Record<string, string> = {
  postgres: 'postgresql://user:password@host:5432/database',
  supabase: 'postgresql://postgres.<ref>:password@aws-0-<region>.pooler.supabase.com:5432/postgres',
  mysql: 'mysql://user:password@host:3306/database',
  sqlite: '/full/path/to/app.db',
  sqlserver: 'sqlserver://user:password@host:1433/database',
};
export const LOCAL_EXAMPLE: Record<string, string> = {
  postgres: 'postgresql://postgres:postgres@localhost:5432/myapp_test',
  mysql: 'mysql://root:root@localhost:3306/myapp_test',
  sqlite: '/Users/me/myapp/dev.db',
  sqlserver: 'sqlserver://sa:Passw0rd!@localhost:1433/myapp_test',
};
export const where = (e: { engine: string; host: string; port: number; database: string }) =>
  e.engine === 'sqlite' ? e.database : `${e.host}:${e.port}/${e.database}`;
export function DatabaseSettings() {
  const base = `/api/projects/${P().id}/database`;
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<Any>(null);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState('');
  const load = () => api(base).then(setData).catch(setErr);
  useEffect(() => {
    load();
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err)
    return (
      <ErrorState
        compact
        title="Couldn’t load the database settings"
        error={err}
        onRetry={() => {
          setErr(null);
          load();
        }}
      />
    );
  if (!data)
    return (
      <SetCard title="Databases">
        <Spinner /> Loading…
      </SetCard>
    );
  // Without the Set up the database permission: only your own database.
  if (!data.manage) return <MineCard base={base} data={data} setData={setData} />;

  const act = async (key: string, payload: Any, ok?: string) => {
    setBusy(key);
    try {
      const r = await api(base, { method: 'POST', body: payload });
      setData((d) => d && { ...d, envs: r.envs });
      if (ok) toast(ok);
      return r;
    } catch (e: Any) {
      toast(e.message, 'err');
      return null;
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    if (!form) return;
    const r = await act(
      'save',
      { action: 'save', ...form },
      form.id ? 'Connection saved' : 'Connection added',
    );
    if (!r) return;
    setForm(null);
    // A new or changed address is tested at once, so problems show up straight away.
    if (form.url) await test(r.env.id);
  };
  const test = async (id: string) => {
    const r = await act(`test:${id}`, { action: 'test', id });
    if (r)
      toast(
        r.env.lastTest?.ok ? 'Connected' : 'Couldn’t connect',
        r.env.lastTest?.ok ? 'ok' : 'err',
      );
  };
  const remove = (e: Env) =>
    openModal(
      <Confirm
        title={`Remove “${e.name}”?`}
        label="Remove"
        text="TicketForge forgets this connection and its saved connection string. The database itself isn’t changed."
        onYes={async () => {
          await act(`remove:${e.id}`, { action: 'remove', id: e.id }, 'Connection removed');
        }}
      />,
    );
  const edit = (e: Env) =>
    setForm({ id: e.id, name: e.name, kind: e.kind, engine: e.engine, url: '' });

  return (
    <>
      <SetCard
        title="Databases"
        desc="Connect the databases of the app this project builds. The schema is read from them for specs and issues, and code jobs and tests use the Test database."
        right={
          !form && (
            <button
              className="btn primary"
              disabled={!!busy}
              onClick={() =>
                setForm({ ...blank, name: data.envs.some((e) => e.kind === 'test') ? '' : 'Test' })
              }
            >
              <Ico svg={I.plus} />
              Add connection
            </button>
          )
        }
      >
        {data.envs.length ? (
          <table className="tbl set-tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Database</th>
                <th>Last test</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.envs.map((e) => (
                <tr key={e.id}>
                  <td>
                    <b>{e.name}</b>
                    <div className="muted small">
                      {data.kinds[e.kind] || e.kind} · {data.engines[e.engine] || e.engine}
                    </div>
                  </td>
                  <td>
                    <code>{where(e)}</code>
                    {e.engine !== 'sqlite' && (
                      <div className="muted small">as {e.user || 'default user'}</div>
                    )}
                  </td>
                  <td>
                    <TestResult env={e} busy={busy === `test:${e.id}`} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn sm" disabled={!!busy} onClick={() => test(e.id)}>
                      Test
                    </button>{' '}
                    <button className="btn sm subtle" disabled={!!busy} onClick={() => edit(e)}>
                      Edit
                    </button>{' '}
                    <button
                      className="btn sm subtle"
                      disabled={!!busy}
                      aria-label={`Remove ${e.name}`}
                      onClick={() => remove(e)}
                    >
                      <Ico svg={I.trash} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !form && (
            <EmptyState compact icon={I.database} title="No database connected yet">
              <p>
                Start with a <b>Test</b> database: one that can be reset without losing real data.
              </p>
            </EmptyState>
          )
        )}
      </SetCard>

      {form && (
        <SetCard
          title={
            form.id
              ? `Edit “${data.envs.find((e) => e.id === form.id)?.name || form.name}”`
              : 'Add a connection'
          }
          desc="The connection string is encrypted on the server. It’s never shown again, exported or sent to the AI."
        >
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 180, margin: 0 }}>
              <span>Name</span>
              <TF
                value={form.name}
                maxLength={60}
                placeholder="Test"
                onChange={(e: Any) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 160, margin: 0 }}>
              <span>Type</span>
              <SF
                value={form.kind}
                onChange={(e: Any) => setForm({ ...form, kind: e.target.value })}
              >
                {Object.entries(data.kinds).map(([k, l]) => (
                  <MenuItem key={k} value={k}>
                    {l}
                  </MenuItem>
                ))}
              </SF>
            </label>
            <label className="field" style={{ flex: 1, minWidth: 160, margin: 0 }}>
              <span>Engine</span>
              <SF
                value={form.engine}
                onChange={(e: Any) => setForm({ ...form, engine: e.target.value })}
              >
                {Object.entries(data.engines).map(([k, l]) => (
                  <MenuItem key={k} value={k}>
                    {l}
                  </MenuItem>
                ))}
              </SF>
            </label>
          </div>
          <p className="muted small" style={{ margin: '6px 0 12px' }}>
            {KIND_HELP[form.kind]}
          </p>
          <label className="field" style={{ margin: 0 }}>
            <span>Connection string</span>
            <TF
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={form.url}
              onChange={(e: Any) => setForm({ ...form, url: e.target.value })}
              placeholder={
                form.id
                  ? 'Leave empty to keep the saved connection string'
                  : EXAMPLE[form.engine] || EXAMPLE.postgres
              }
            />
          </label>
          {form.engine === 'supabase' && (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              In Supabase: Project Settings → Database → Connection string → URI. The Session pooler
              (port 5432) works on networks without IPv6.
            </p>
          )}
          {form.engine === 'mysql' && (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              Works with MySQL 5.7+ and MariaDB 10.2+. Connections that aren’t local use TLS; add{' '}
              <code>?ssl=false</code> for a server without it.
            </p>
          )}
          {form.engine === 'sqlite' && (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              The full path of the database file on the computer TicketForge runs on. Not available
              on the hosted service.
            </p>
          )}
          {form.engine === 'sqlserver' && (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              Encrypted by default; add <code>?encrypt=false</code> for a server without TLS. SQL
              Server has no read-only mode, so every read TicketForge does is rolled back.
            </p>
          )}
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button
              className="btn primary"
              disabled={!!busy || !form.name.trim() || (!form.id && !form.url.trim())}
              onClick={save}
            >
              {busy === 'save' ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : form.url ? (
                'Save and test'
              ) : (
                'Save'
              )}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </SetCard>
      )}

      <UsageCard base={base} data={data} setData={setData} />
      <MineCard base={base} data={data} setData={setData} />
      <SchemaCard base={base} envs={data.envs} />
    </>
  );
}
