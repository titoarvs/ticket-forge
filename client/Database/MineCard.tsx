'use client';
import { useState } from 'react';
import { api, toast, type Any } from '../core';
import { SetCard, Ico, I, Spinner } from '../ui';
import { SF, MenuItem, TF } from '../fields';
import { type Data, where, LOCAL_EXAMPLE } from './DatabaseSettings';
import { TestResult } from './SchemaCard';

/** Which database code jobs and tests use, and what runs before each test run. */
export function UsageCard({
  base,
  data,
  setData,
}: {
  base: string;
  data: Data;
  setData: (f: (d: Data | null) => Data | null) => void;
}) {
  const test = data.envs.find((e) => e.kind === 'test');
  const [kind, setKind] = useState(data.setup?.kind || 'none');
  const [value, setValue] = useState(data.setup?.value || '');
  const [busy, setBusy] = useState(false);
  const dirty =
    kind !== (data.setup?.kind || 'none') ||
    (kind !== 'none' && value.trim() !== (data.setup?.value || ''));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api(base, { method: 'POST', body: { action: 'saveSetup', kind, value } });
      setData((d) => d && { ...d, setup: r.setup });
      setValue(r.setup.value);
      toast('Saved');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const used =
    data.local && data.mine ? (
      <>
        your own database (<code>{where(data.mine)}</code>) on this computer, otherwise the
        project’s <b>{test?.name || 'Test'}</b> database
      </>
    ) : test ? (
      <>
        the <b>{test.name}</b> database (<code>{where(test)}</code>,{' '}
        {data.engines[test.engine] || test.engine})
      </>
    ) : null;
  return (
    <SetCard
      title="Code jobs and tests"
      desc="Only a Test database is ever written to. Staging and Production are never given to code jobs or tests."
    >
      {used ? (
        <p style={{ marginTop: 0 }}>Code jobs and test runs use {used}.</p>
      ) : (
        <div className="warn-banner">
          <Ico svg={I.warn} />
          <span>
            No Test database yet: code jobs run without a database, and tests can’t check saved
            data. Add a connection of type <b>Test</b> above.
          </span>
        </div>
      )}
      <ul className="muted small" style={{ margin: '0 0 12px', paddingLeft: 18 }}>
        <li>
          <b>Code jobs</b> (on this computer) get it as <code>DATABASE_URL</code> and{' '}
          <code>TEST_DATABASE_URL</code>, so agents can run migrations and tests. TicketForge’s own
          database and keys are never passed to them.
        </li>
        <li>
          <b>Test runs</b> on this server can check saved data with <code>app.db.query()</code>,
          read-only. Runs on GitHub Actions don’t get it.
        </li>
      </ul>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: 1, minWidth: 240, margin: 0 }}>
          <span>Before each test run</span>
          <SF value={kind} onChange={(e: Any) => setKind(e.target.value)}>
            {Object.entries(data.setupKinds).map(([k, l]) => (
              <MenuItem key={k} value={k}>
                {l}
              </MenuItem>
            ))}
          </SF>
        </label>
        {kind !== 'none' && (
          <label className="field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
            <span>{kind === 'sql' ? 'SQL file' : 'npm script'}</span>
            <TF
              value={value}
              spellCheck={false}
              placeholder={kind === 'sql' ? 'db/seed.sql' : 'db:reset'}
              onChange={(e: Any) => setValue(e.target.value)}
            />
          </label>
        )}
        <button
          className="btn primary"
          disabled={busy || !dirty || (kind !== 'none' && !value.trim())}
          onClick={save}
        >
          {busy ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : (
            'Save'
          )}
        </button>
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        {kind === 'sql'
          ? 'The file is read from the project’s repository and run on the Test database in one transaction, so a failure changes nothing. If it fails, the tests don’t run.'
          : kind === 'npm'
            ? 'Runs npm run <script> in the repository folder on this computer, with DATABASE_URL set to the Test database. If it fails, the tests don’t run.'
            : 'Tests use the Test database as it is.'}
      </p>
    </SetCard>
  );
}
/**
 * Your own database for this project: used instead of the project's Test one for your code jobs and
 * test runs.
 */
export function MineCard({
  base,
  data,
  setData,
}: {
  base: string;
  data: Data;
  setData: (f: (d: Data | null) => Data | null) => void;
}) {
  const [url, setUrl] = useState('');
  const [engine, setEngine] = useState(
    data.mine?.engine === 'supabase' ? 'postgres' : data.mine?.engine || 'postgres',
  );
  const [busy, setBusy] = useState('');
  const call = async (key: string, payload: Any, ok?: string) => {
    setBusy(key);
    try {
      const r = await api(base, { method: 'POST', body: payload });
      setData((d) => d && { ...d, mine: r.mine });
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
    const r = await call('save', { action: 'setMine', url, engine });
    if (r) {
      setUrl('');
      const t = await call('test', { action: 'testMine' });
      if (t)
        toast(
          t.mine?.lastTest?.ok ? 'Connected' : 'Couldn’t connect',
          t.mine?.lastTest?.ok ? 'ok' : 'err',
        );
    }
  };
  const m = data.mine;
  return (
    <SetCard
      title="Your own database"
      desc="A database on your computer, such as a local Postgres, for your own code jobs and test runs. Only you use it, and it never changes the project’s settings."
    >
      {!data.local ? (
        <p className="muted small" style={{ margin: 0 }}>
          Your own database can be set up only when TicketForge runs on your computer and is opened
          at localhost.
        </p>
      ) : (
        <>
          {m && (
            <div
              className="row"
              style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}
            >
              <span>
                <code>{where(m)}</code>{' '}
                <span className="muted small">
                  {data.engines[m.engine] || m.engine}
                  {m.engine !== 'sqlite' ? ` · as ${m.user || 'default user'}` : ''}
                </span>
              </span>
              <TestResult env={m} busy={busy === 'test'} />
              <span className="spacer" />
              <button
                className="btn sm"
                disabled={!!busy}
                onClick={async () => {
                  const t = await call('test', { action: 'testMine' });
                  if (t)
                    toast(
                      t.mine?.lastTest?.ok ? 'Connected' : 'Couldn’t connect',
                      t.mine?.lastTest?.ok ? 'ok' : 'err',
                    );
                }}
              >
                Test
              </button>
              <button
                className="btn sm subtle"
                disabled={!!busy}
                onClick={() =>
                  call('forget', { action: 'setMine', url: '' }, 'Your own database is forgotten')
                }
              >
                Forget
              </button>
            </div>
          )}
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field" style={{ width: 180, margin: 0 }}>
              <span>Engine</span>
              <SF value={engine} onChange={(e: Any) => setEngine(e.target.value)}>
                {Object.entries(data.engines)
                  .filter(([k]) => k !== 'supabase')
                  .map(([k, l]) => (
                    <MenuItem key={k} value={k}>
                      {l}
                    </MenuItem>
                  ))}
              </SF>
            </label>
            <label className="field" style={{ flex: 1, minWidth: 240, margin: 0 }}>
              <span>{m ? 'Replace with another connection string' : 'Connection string'}</span>
              <TF
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={url}
                placeholder={LOCAL_EXAMPLE[engine] || LOCAL_EXAMPLE.postgres}
                onChange={(e: Any) => setUrl(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={!!busy || !url.trim()} onClick={save}>
              {busy === 'save' ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : (
                'Save and test'
              )}
            </button>
          </div>
        </>
      )}
    </SetCard>
  );
}
