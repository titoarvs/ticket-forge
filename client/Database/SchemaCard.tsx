'use client';
import { useState, useEffect, Fragment } from 'react';
import { type Any, P, api, toast, openModal, ago } from '../core';
import { Confirm, SetCard, Spinner, EmptyState, I, Ico } from '../ui';
import { SF, MenuItem, TF } from '../fields';
import type { Env } from './DatabaseSettings';

type Column = { name: string; type: string; nullable: boolean; default?: string; pk?: boolean };
type Table = {
  schema: string;
  name: string;
  columns: Column[];
  primaryKey: string[];
  foreignKeys: { columns: string[]; refTable: string; refColumns: string[] }[];
  unique: string[][];
  indexes: { name: string; columns: string[]; unique: boolean }[];
};
type Changes = {
  since: string;
  addedTables: string[];
  removedTables: string[];
  changedTables: {
    table: string;
    addedColumns: string[];
    removedColumns: string[];
    changedColumns: { name: string; from: string; to: string }[];
  }[];
};
type Schema = {
  source: Any;
  readAt: string;
  readBy: string | null;
  truncated: boolean;
  tables: Table[];
  enums: { name: string; values: string[] }[];
  changes: Changes | null;
};
const tname = (t: Table) => (t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name);
/**
 * The app's schema: read it from a connection or the repository, see what changed, and browse the
 * tables.
 */
export function SchemaCard({ base, envs }: { base: string; envs: Env[] }) {
  const [schema, setSchema] = useState<Schema | null>(() => P().dbSchema || null);
  const pickDefault = () =>
    schema?.source?.type === 'database' && envs.some((e) => e.id === schema.source.envId)
      ? schema.source.envId
      : (envs.find((e) => e.kind === 'test') || envs[0])?.id || 'repo';
  const [source, setSource] = useState<string>(pickDefault);
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string>('');
  useEffect(() => {
    if (source !== 'repo' && !envs.some((e) => e.id === source)) setSource(pickDefault());
  }, [envs]); // eslint-disable-line react-hooks/exhaustive-deps

  const read = async () => {
    setBusy('read');
    try {
      const r = await api(base, {
        method: 'POST',
        body:
          source === 'repo'
            ? { action: 'readSchema', source: 'repo' }
            : { action: 'readSchema', id: source },
      });
      setSchema(r.schema);
      toast(
        r.schema.changes && r.schema.changes.since !== schema?.changes?.since
          ? 'Schema read: it changed since last time'
          : `Schema read: ${r.schema.tables.length} tables`,
      );
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const clear = () =>
    openModal(
      <Confirm
        title="Forget the schema?"
        label="Forget"
        text="The AI stops using this schema in specs, documents and issues until it's read again. The database and repository aren't changed."
        onYes={async () => {
          try {
            await api(base, { method: 'POST', body: { action: 'clearSchema' } });
            setSchema(null);
            toast('Schema forgotten');
          } catch (e: Any) {
            toast(e.message, 'err');
          }
        }}
      />,
    );

  const from = schema
    ? schema.source.type === 'database'
      ? `the ${schema.source.name} database`
      : `${schema.source.format} files in the repository`
    : '';
  const qq = q.trim().toLowerCase();
  const shown = (schema?.tables || []).filter(
    (t) =>
      !qq ||
      tname(t).toLowerCase().includes(qq) ||
      t.columns.some((c) => c.name.toLowerCase().includes(qq)),
  );
  return (
    <SetCard
      title="Schema"
      desc="The app’s tables, columns and relations, never its rows. Coding specs, agent documents, test cases and issue writing use it, so the AI names real tables and says when a migration is needed."
    >
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: 1, minWidth: 220, margin: 0 }}>
          <span>Read from</span>
          <SF value={source} onChange={(e: Any) => setSource(e.target.value)}>
            {envs.map((e) => (
              <MenuItem key={e.id} value={e.id}>
                {e.name} database ({e.host})
              </MenuItem>
            ))}
            <MenuItem value="repo">Repository files (Prisma, Drizzle or SQL migrations)</MenuItem>
          </SF>
        </label>
        <button className="btn primary" disabled={!!busy} onClick={read}>
          {busy === 'read' ? (
            <>
              <Spinner />
              Reading…
            </>
          ) : schema ? (
            'Read again'
          ) : (
            'Read schema'
          )}
        </button>
        {schema && (
          <button className="btn subtle" disabled={!!busy} onClick={clear}>
            Forget
          </button>
        )}
      </div>

      {!schema ? (
        <EmptyState compact icon={I.database} title="No schema yet">
          <p>
            Read it from a connection, or from the repository’s schema files when no database is
            connected.
          </p>
        </EmptyState>
      ) : (
        <>
          <p className="muted small" style={{ margin: '12px 0 8px' }}>
            <b>{schema.tables.length}</b> table{schema.tables.length === 1 ? '' : 's'}
            {schema.enums.length ? (
              <>
                , <b>{schema.enums.length}</b> enum{schema.enums.length === 1 ? '' : 's'}
              </>
            ) : null}{' '}
            from {from} · read {ago(schema.readAt)}
            {schema.readBy ? ` by ${schema.readBy}` : ''}
            {schema.truncated && (
              <>
                {' '}
                ·{' '}
                <span className="t-fail">
                  shortened: very large schemas keep the first 300 tables and 120 columns per table
                </span>
              </>
            )}
          </p>
          {schema.changes && <ChangesNote changes={schema.changes} />}
          <TF
            value={q}
            placeholder="Find a table or column"
            aria-label="Find a table or column"
            onChange={(e: Any) => setQ(e.target.value)}
            sx={{ width: '100%', margin: '4px 0 8px' }}
          />
          <table className="tbl set-tbl">
            <thead>
              <tr>
                <th>Table</th>
                <th>Columns</th>
                <th>Relations</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const k = tname(t);
                const isOpen = open === k;
                return (
                  <Fragment key={k}>
                    <tr
                      style={{ cursor: 'pointer' }}
                      onClick={() => setOpen(isOpen ? '' : k)}
                      aria-expanded={isOpen}
                    >
                      <td>
                        <Ico svg={isOpen ? I.collapse : I.expand} /> <code>{k}</code>
                      </td>
                      <td>{t.columns.length}</td>
                      <td className="muted small">
                        {t.foreignKeys.length
                          ? t.foreignKeys.map((f) => `→ ${f.refTable}`).join(', ')
                          : '—'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={3} style={{ background: 'var(--surface-2, transparent)' }}>
                          <table className="tbl" style={{ margin: 0 }}>
                            <tbody>
                              {t.columns.map((c) => {
                                const fk = t.foreignKeys.find((f) => f.columns.includes(c.name));
                                return (
                                  <tr key={c.name}>
                                    <td>
                                      <code>{c.name}</code>
                                    </td>
                                    <td className="muted">{c.type}</td>
                                    <td className="small">
                                      {[
                                        c.pk && 'primary key',
                                        !c.pk && !c.nullable && 'required',
                                        t.unique.some((u) => u.length === 1 && u[0] === c.name) &&
                                          'unique',
                                        fk &&
                                          `→ ${fk.refTable}.${fk.refColumns[fk.columns.indexOf(c.name)] || fk.refColumns[0]}`,
                                        c.default && `default ${c.default}`,
                                      ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <p className="muted small">No table or column matches “{q}”.</p>}
          {!!schema.enums.length && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              <b>Enums:</b>{' '}
              {schema.enums.map((e) => `${e.name} (${e.values.join(', ')})`).join(' · ')}
            </p>
          )}
        </>
      )}
    </SetCard>
  );
}
function ChangesNote({ changes: c }: { changes: Changes }) {
  const items = [
    c.addedTables.length && `New tables: ${c.addedTables.join(', ')}`,
    c.removedTables.length && `Removed tables: ${c.removedTables.join(', ')}`,
    ...c.changedTables
      .slice(0, 12)
      .map(
        (t) =>
          `${t.table}: ${[
            t.addedColumns.length && `added ${t.addedColumns.join(', ')}`,
            t.removedColumns.length && `removed ${t.removedColumns.join(', ')}`,
            t.changedColumns.length &&
              `changed ${t.changedColumns.map((x) => `${x.name} (${x.from} → ${x.to})`).join(', ')}`,
          ]
            .filter(Boolean)
            .join('; ')}`,
      ),
    c.changedTables.length > 12 && `…and ${c.changedTables.length - 12} more changed tables`,
  ].filter(Boolean);
  return (
    <div className="warn-banner" style={{ marginBottom: 8 }}>
      <Ico svg={I.history} />
      <span>
        <b>Changed since {ago(c.since)}:</b>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </span>
    </div>
  );
}
export function TestResult({ env, busy }: { env: Env; busy: boolean }) {
  if (busy)
    return (
      <span className="muted small">
        <Spinner /> Testing…
      </span>
    );
  const t = env.lastTest;
  if (!t) return <span className="loz s-todo">Not tested</span>;
  if (!t.ok)
    return (
      <>
        <span className="loz t-fail">Failed</span>
        <div className="muted small" style={{ maxWidth: 320 }}>
          {t.error}
        </div>
      </>
    );
  return (
    <>
      <span className="loz t-pass">Connected</span>
      <div className="muted small">
        {/^\d/.test(String(t.version)) ? `PostgreSQL ${t.version}` : t.version} · {t.tables} table
        {t.tables === 1 ? '' : 's'} · {t.canWrite ? 'can write' : 'read-only user'} · {ago(t.at)}
      </div>
    </>
  );
}
