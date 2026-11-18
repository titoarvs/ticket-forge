'use client';
// Activity: the project's timeline of every change, newest first, grouped by day. It joins each issue's own history
// and comments (created, every field change, links, test results, pull requests…) with the changes the server logs
// for the rest of the project (sprints, epics, releases, workflow and settings, test management, deleted issues).
// Filter by type, person, time and text; click an issue to open it.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { P, S, useStore, api, FIELD_LABEL, type Any } from './core';
import { Ico, I, Avatar, EmptyState, Spinner } from './ui';
import { TF, SF, MenuItem } from './fields';
import { openDrawer } from './actions';
import { Header } from './views';

type Ev = { id: string; at: string; author: string; kind: string; issue?: Any; text: ReactNode; plain: string; from?: string; to?: string };
const TYPES: [string, string][] = [
  ['', 'All changes'],
  ['issue', 'Issues'],
  ['comment', 'Comments'],
  ['sprint', 'Sprints'],
  ['epic', 'Epics'],
  ['release', 'Releases'],
  ['test', 'Tests'],
  ['pr', 'Pull requests'],
  ['settings', 'Project settings'],
];
const RANGES: [string, string, number][] = [
  ['', 'Any time', 0],
  ['1', 'Last 24 hours', 1],
  ['7', 'Last 7 days', 7],
  ['30', 'Last 30 days', 30],
];
const KIND_ICON: Record<string, string> = {
  issue: I.backlog,
  comment: I.comment,
  sprint: I.calendar,
  epic: I.epic,
  release: I.pr,
  test: I.test,
  pr: I.pr,
  settings: I.settings,
  project: I.settings,
};
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s);
function dayLabel(d: string) {
  const t = new Date();
  const y = new Date(Date.now() - 864e5);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (d === iso(t)) return 'Today';
  if (d === iso(y)) return 'Yesterday';
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
const localDay = (at: string) => {
  const x = new Date(at);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** What kind of change an issue history entry is (for the type filter). */
function kindOf(h: Any) {
  if (h.field === 'sprintId') return 'sprint';
  if (h.field === 'epicId') return 'epic';
  if (h.field === 'fixVersions') return 'release';
  const tx = String(h.text || '');
  if (h.field === 'event' && (/pull request|merge request/i.test(tx) || h.author === 'Development')) return 'pr';
  if (h.field === 'event' && (/test/i.test(tx) || h.author === 'Automation')) return 'test';
  if (h.field === 'testCases') return 'test';
  return 'issue';
}
const IssueLink = ({ t }: { t: Any }) => (
  <button type="button" className="act-issue" onClick={() => openDrawer('issue', t.id)} title={t.title}>
    <span className="key">{t.key}</span>
    <span className="act-issue-t">{t.title}</span>
  </button>
);

/** Every issue history entry and comment as timeline events. */
function issueEvents(p: Any): Ev[] {
  const out: Ev[] = [];
  for (const t of p.tickets) {
    for (const h of t.history || []) {
      if (!h?.at) continue;
      const label = FIELD_LABEL[h.field] || h.field;
      let text: ReactNode, plain: string;
      if (h.field === 'created') {
        text = (
          <>
            created <IssueLink t={t} />
          </>
        );
        plain = `created ${t.key} ${t.title}`;
      } else if (h.text) {
        text = (
          <>
            {h.text} <span className="muted">on</span> <IssueLink t={t} />
          </>
        );
        plain = `${h.text} ${t.key} ${t.title}`;
      } else if (h.from !== undefined) {
        text = (
          <>
            changed <b>{label}</b> <span className="muted">on</span> <IssueLink t={t} />
          </>
        );
        plain = `changed ${label} ${t.key} ${t.title} ${h.from} ${h.to}`;
      } else {
        text = (
          <>
            updated <b>{label}</b> <span className="muted">on</span> <IssueLink t={t} />
          </>
        );
        plain = `updated ${label} ${t.key} ${t.title}`;
      }
      out.push({
        id: `h${t.id}${h.id}`,
        at: h.at,
        author: h.author || 'Someone',
        kind: kindOf(h),
        issue: t,
        text,
        plain,
        from: h.from,
        to: h.to,
      });
    }
    for (const c of t.comments || []) {
      if (!c?.at) continue;
      const body = String(c.body || c.text || '')
        .replace(/\s+/g, ' ')
        .trim();
      out.push({
        id: `c${t.id}${c.id}`,
        at: c.at,
        author: c.author || 'Someone',
        kind: c.system ? 'test' : 'comment',
        issue: t,
        text: (
          <>
            commented on <IssueLink t={t} />
            {body && <span className="act-quote">“{clip(body)}”</span>}
          </>
        ),
        plain: `commented ${t.key} ${t.title} ${body}`,
      });
    }
  }
  return out;
}

export function Activity() {
  useStore();
  const p = P();
  const [server, setServer] = useState<Any[] | null>(null);
  const [err, setErr] = useState('');
  const [type, setType] = useState('');
  const [who, setWho] = useState('');
  const [range, setRange] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(150);
  useEffect(() => {
    let live = true;
    api(`/api/projects/${p.id}/activity?limit=1000`)
      .then((d) => {
        if (live) {
          setServer(d.items);
          setErr('');
        }
      })
      .catch((e) => {
        if (live) {
          setErr(e.message);
          setServer([]);
        }
      });
    return () => {
      live = false;
    };
  }, [p.id, p.version]);
  const all = useMemo(() => {
    const list: Ev[] = issueEvents(p);
    for (const s of server || []) {
      list.push({
        id: `s${s.id}`,
        at: s.at,
        author: s.author || 'Someone',
        kind: s.kind === 'project' ? 'settings' : s.kind,
        text: <>{s.text}</>,
        plain: s.text,
      });
    }
    return list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [p, p.tickets, S.dataRev, server]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = useMemo(() => [...new Set(all.map((e) => e.author))].sort(), [all]);
  const qq = q.trim().toLowerCase();
  const since = range ? Date.now() - Number(range) * 864e5 : 0;
  const shown = all.filter(
    (e) =>
      (!type || e.kind === type) &&
      (!who || e.author === who) &&
      (!since || Date.parse(e.at) >= since) &&
      (!qq || `${e.author} ${e.plain}`.toLowerCase().includes(qq)),
  );
  const page = shown.slice(0, limit);
  const days: [string, Ev[]][] = [];
  for (const e of page) {
    const d = localDay(e.at);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(e);
    else days.push([d, [e]]);
  }
  const active = Boolean(type || who || range || qq);

  return (
    <>
      <Header title="Activity" />
      <p className="muted" style={{ marginTop: -6 }}>
        Every change in this project, newest first: issues and their fields, comments, sprints, epics, releases, tests, pull requests and
        settings.
      </p>
      <div className="toolbar act-tools">
        <TF
          search
          sx={{ width: 240 }}
          placeholder="Search changes"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(150);
          }}
          aria-label="Search changes"
        />
        <SF
          filter
          aria-label="Type of change"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setLimit(150);
          }}
        >
          {TYPES.map(([k, l]) => (
            <MenuItem key={k || 'all'} value={k}>
              {l}
            </MenuItem>
          ))}
        </SF>
        <SF
          filter
          aria-label="Person"
          value={who}
          onChange={(e) => {
            setWho(e.target.value);
            setLimit(150);
          }}
        >
          <MenuItem value="">Everyone</MenuItem>
          {people.map((n) => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </SF>
        <SF
          filter
          aria-label="Time"
          value={range}
          onChange={(e) => {
            setRange(e.target.value);
            setLimit(150);
          }}
        >
          {RANGES.map(([k, l]) => (
            <MenuItem key={k || 'any'} value={k}>
              {l}
            </MenuItem>
          ))}
        </SF>
        {active && (
          <button
            className="btn subtle"
            onClick={() => {
              setType('');
              setWho('');
              setRange('');
              setQ('');
            }}
          >
            Clear filters
          </button>
        )}
        <div className="spacer" />
        {server === null ? (
          <span className="muted small">
            <Spinner /> Loading project changes…
          </span>
        ) : (
          <span className="muted small">
            {shown.length.toLocaleString()} change{shown.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {err && <p className="warn-text small">Couldn’t load the project-level changes ({err}); issue changes are shown.</p>}
      {!shown.length ? (
        <EmptyState compact icon={I.history} tone="neutral" title={active ? 'No changes match' : 'No changes yet'}>
          <p>{active ? 'Try another filter.' : 'Changes to issues, sprints, epics, releases and settings show up here.'}</p>
        </EmptyState>
      ) : (
        <div className="act-feed">
          {days.map(([d, evs]) => (
            <section key={d} className="act-day">
              <h3 className="act-day-h">
                {dayLabel(d)}
                <span className="count">{evs.length}</span>
              </h3>
              <ol className="act-list">
                {evs.map((e) => (
                  <li key={e.id} className={`act-item k-${e.kind}`}>
                    <span className="act-ic" title={TYPES.find(([k]) => k === e.kind)?.[1] || e.kind}>
                      <Ico svg={KIND_ICON[e.kind] || I.history} />
                    </span>
                    <Avatar name={e.author} size={24} />
                    <div className="act-body">
                      <div className="act-line">
                        <b>{e.author}</b> {e.text}
                      </div>
                      {e.from !== undefined && (
                        <div className="act-diff">
                          <span className="act-from">{clip(String(e.from), 80)}</span>
                          <Ico svg={I.chevron} className="act-arrow" />
                          <span className="act-to">{clip(String(e.to), 80)}</span>
                        </div>
                      )}
                    </div>
                    <time className="act-time muted small" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                      {new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {shown.length > limit && (
            <button className="show-more" onClick={() => setLimit(limit + 300)}>
              Show older changes <span className="muted">· {(shown.length - limit).toLocaleString()} more</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}
