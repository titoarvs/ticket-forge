'use client';
import { useState } from 'react';
import { S, saveUi, emit, P, type Any, uid, openModal } from '../core';
import { Ico, I } from '../ui';
import { TF, SF, MenuItem } from '../fields';
import { type setupStatus, appSetup, edit } from './AppSetup';
import { DiscoverModal } from './DiscoverModal';

export function SetupOverview({
  status,
  go,
}: {
  status: ReturnType<typeof setupStatus>;
  go: (k: string) => void;
}) {
  return (
    <div className="card setup-overview">
      {status.todo ? (
        <p className="sub" style={{ marginTop: 0 }}>
          {status.todo} thing{status.todo > 1 ? 's' : ''} to set up before every test can run.
        </p>
      ) : (
        <p className="sub" style={{ marginTop: 0 }}>
          Everything is set up. Tests can run.
        </p>
      )}
      <ul className="setup-list">
        {status.items.map((x) => (
          <li key={x.key} className={x.ok ? 'ok' : x.optional ? 'opt' : 'todo'}>
            <span className="setup-ic">
              {x.ok ? (
                <Ico svg={I.check} />
              ) : x.optional ? (
                <Ico svg={I.clock} />
              ) : (
                <Ico svg={I.warn} />
              )}
            </span>
            <span className="setup-text">
              <b>{x.label}</b>
              <span className="muted small">{x.detail}</span>
            </span>
            <button
              className="btn sm subtle"
              onClick={() =>
                x.go === 'settings' ? ((S.autoTab = 'settings'), saveUi(), emit()) : go(x.go)
              }
            >
              {x.ok ? 'Open' : 'Set up'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
// ---------------------------------------------------------------- pages, organized by area
const SIGN_IN_SEG =
  /^(auth|sign-?in|signin|log-?in|sign-?up|register|forgot|reset|verify|mfa|sso|account)$/i;
const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const MAIN = 'Main pages';
/**
 * The area a page belongs to, from its path: sign-in pages together; a section with several pages
 * ("/dashboard/pay-runs/…") gets its own group ("Dashboard › Pay runs"); lone top-level pages are
 * "Main pages".
 */
function areaOf(path: string, all: string[]) {
  const segs = String(path || '/')
    .split('/')
    .filter(Boolean);
  const [first = '', second = ''] = segs;
  if (!first) return MAIN;
  if (SIGN_IN_SEG.test(first)) return 'Sign-in & account';
  if (
    !all.some(
      (x) => (x !== path && x.startsWith(`/${first}/`)) || (x !== path && x === `/${first}`),
    )
  )
    return MAIN;
  const sub =
    second &&
    !second.startsWith(':') &&
    all.filter((x) => x === `/${first}/${second}` || x.startsWith(`/${first}/${second}/`)).length >
      1
      ? second
      : '';
  return [titleCase(first), sub && titleCase(sub)].filter(Boolean).join(' › ');
}
const areaRank = (a: string) => (a === MAIN ? 0 : a === 'Sign-in & account' ? 1 : 2);
export function PagesSection({ canEdit, base }: { canEdit: boolean; base: string }) {
  const a = appSetup(P());
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const paths = a.pages.map((x: Any) => String(x.path || ''));
  const rows = a.pages
    .map((pg: Any, i: number) => ({ pg, i, area: areaOf(pg.path, paths) }))
    .filter(
      ({ pg }: Any) =>
        filter === 'all' ||
        (filter === 'code' && pg.fromCode) ||
        (filter === 'manual' && !pg.fromCode) ||
        (filter === 'dynamic' && String(pg.path).includes(':')) ||
        (filter === 'missing' && pg.missing),
    )
    .filter(
      ({ pg }: Any) =>
        !q.trim() ||
        `${pg.name} ${pg.path} ${pg.description || ''} ${pg.file || ''}`
          .toLowerCase()
          .includes(q.trim().toLowerCase()),
    )
    .sort(
      (x: Any, y: Any) =>
        areaRank(x.area) - areaRank(y.area) ||
        x.area.localeCompare(y.area) ||
        String(x.pg.path).localeCompare(String(y.pg.path)),
    );
  const groups: [string, Any[]][] = [];
  for (const r of rows) {
    const g = groups.find(([k]) => k === r.area);
    if (g) g[1].push(r);
    else groups.push([r.area, [r]]);
  }
  const count = (f: (pg: Any) => boolean) => a.pages.filter(f).length;
  return (
    <div className="card">
      <div className="pages-tools">
        <TF
          value={q}
          placeholder={`Search ${a.pages.length} pages by name, path or file`}
          onChange={(e) => setQ(e.target.value)}
          sx={{ flex: 1, minWidth: 220 }}
          aria-label="Search pages"
        />
        <SF filter value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show">
          <MenuItem value="all">All pages ({a.pages.length})</MenuItem>
          <MenuItem value="code">From the code ({count((x) => x.fromCode)})</MenuItem>
          <MenuItem value="manual">Added by hand ({count((x) => !x.fromCode)})</MenuItem>
          <MenuItem value="dynamic">
            Need values, like :id ({count((x) => String(x.path).includes(':'))})
          </MenuItem>
          {count((x) => x.missing) > 0 && (
            <MenuItem value="missing">No longer in the code ({count((x) => x.missing)})</MenuItem>
          )}
        </SF>
        {canEdit && (
          <button
            className="btn sm"
            onClick={() => {
              edit((x) => {
                x.pages.push({ id: uid(), name: '', path: '/', description: '' });
              });
              setQ('');
              setFilter('manual');
            }}
          >
            <Ico svg={I.plus} />
            Add page
          </button>
        )}
        {canEdit && (
          <button
            className="btn sm"
            disabled={!base}
            title={
              base ? 'Follow the app’s links to find its pages' : 'Set the application URL first'
            }
            onClick={() => openModal(<DiscoverModal />)}
          >
            <Ico svg={I.search} />
            Discover
          </button>
        )}
      </div>
      {!a.pages.length ? (
        <p className="muted small">
          No pages yet. Sync with the repository, discover them from the running app, or add the
          main ones by hand, so scripts can open them by name.
        </p>
      ) : !rows.length ? (
        <p className="muted small">No page matches.</p>
      ) : (
        groups.map(([area, list]) => (
          <div key={area} className="pg-group">
            <button
              type="button"
              className={`as-h ${closed[area] ? 'closed' : ''}`}
              onClick={() => setClosed({ ...closed, [area]: !closed[area] })}
            >
              <Ico svg={I.chevron} />
              <b>{area}</b>
              <span className="count">{list.length}</span>
            </button>
            {!closed[area] && (
              <table className="tbl as-tbl pg-tbl">
                <tbody>
                  {list.map(({ pg, i }: Any) => {
                    const dyn = String(pg.path || '').includes(':');
                    return (
                      <tr key={pg.id} className={pg.missing ? 'pg-missing' : ''}>
                        <td style={{ width: '26%' }}>
                          <TF
                            disabled={!canEdit}
                            value={pg.name}
                            placeholder="e.g. Orders"
                            onChange={(e) =>
                              edit((x) => {
                                x.pages[i] = { ...x.pages[i], name: e.target.value };
                              }, `pg${pg.id}n`)
                            }
                          />
                        </td>
                        <td style={{ width: '30%' }}>
                          <TF
                            mono
                            disabled={!canEdit}
                            value={pg.path}
                            placeholder="/orders"
                            spellCheck={false}
                            onChange={(e) =>
                              edit((x) => {
                                x.pages[i] = { ...x.pages[i], path: e.target.value.trim() };
                              }, `pg${pg.id}p`)
                            }
                          />
                          <div className="pg-badges">
                            {pg.fromCode && (
                              <span className="pg-badge" title={pg.file || ''}>
                                {pg.missing ? 'No longer in the code' : 'From code'}
                              </span>
                            )}
                            {dyn && (
                              <span
                                className="pg-badge dyn"
                                title="Scripts pass values: app.goto('Name', { id: … })"
                              >
                                {(() => {
                                  const ps = [...String(pg.path).matchAll(/:(\w+)([?*]?)/g)];
                                  const need = ps.filter((m) => !m[2]).map((m) => m[1]);
                                  const opt = ps.filter((m) => m[2]).map((m) => m[1]);
                                  return [
                                    need.length && `Needs ${need.join(', ')}`,
                                    opt.length && `Optional ${opt.join(', ')}`,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ');
                                })()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <TF
                            disabled={!canEdit}
                            value={pg.description || ''}
                            placeholder="What’s on it (helps the AI)"
                            onChange={(e) =>
                              edit((x) => {
                                x.pages[i] = { ...x.pages[i], description: e.target.value };
                              }, `pg${pg.id}d`)
                            }
                          />
                          {pg.file && (
                            <div className="muted small as-file" title={pg.file}>
                              <Ico svg={I.doc} /> {pg.file}
                            </div>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right', width: 72 }}>
                          {base && !dyn && (
                            <a
                              className="icon-btn"
                              href={`${base}${String(pg.path || '/').startsWith('/') || String(pg.path).startsWith('#') ? '' : '/'}${pg.path || ''}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open in a new tab"
                            >
                              <Ico svg={I.external} />
                            </a>
                          )}
                          {canEdit && (
                            <button
                              className="icon-btn"
                              aria-label={`Remove ${pg.name || 'page'}`}
                              title="Remove"
                              onClick={() =>
                                edit((x) => {
                                  x.pages.splice(i, 1);
                                })
                              }
                            >
                              <Ico svg={I.trash} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}
    </div>
  );
}
