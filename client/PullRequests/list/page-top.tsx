'use client';
// The top of the Pull requests page: title, refresh progress, Code jobs, Link pull request, the
// intro, the status counts, the "needs attention" chips and the search / sort / group tools.
import Link from 'next/link';
import { type Any, P, can, openModal, S, emit } from '../../core';
import { Ico, I, Spinner } from '../../ui';
import { TF, SF, MenuItem } from '../../fields';
import { ACTIVE, flagsOf, FOCUS, SORTS } from '../PrDetails';
import { LinkModal } from '../ReviewModal';
import type { PrFilters, PrRow } from './filters';

type Progress = { done: number; total: number } | null;
type HeadProps = { rows: PrRow[]; ai: boolean; progress: Progress; refreshOpen: () => void };

export function PageHead({ rows, ai, progress, refreshOpen }: HeadProps) {
  const edit = can('issue.edit');
  return (
    <div className="page-h">
      <h1>Pull requests</h1>
      <span className="spacer" />
      {progress ? (
        <span className="muted small pr-progress">
          <Spinner />
          Updating from GitHub/GitLab… {progress.done} of {progress.total}
        </span>
      ) : (
        edit &&
        rows.some((x) => ACTIVE.includes(x.r.status)) && (
          <button className="btn" onClick={refreshOpen}>
            <Ico svg={I.refresh} />
            Refresh open
          </button>
        )
      )}
      {ai && (
        <Link
          className="btn"
          href={`/p/${P().id}/codejobs`}
          title="Every code generation for this project: running, ready for review, shipped"
        >
          <Ico svg={I.bot} />
          Code jobs
        </Link>
      )}
      {edit && (
        <button className="btn primary" onClick={() => openModal(<LinkModal />)}>
          <Ico svg={I.plus} />
          Link pull request
        </button>
      )}
    </div>
  );
}

/** What the page shows, and (without a local repository) where to set one up for AI. */
export function Intro({ ai }: { ai: boolean }) {
  const setUp = !ai && can('ai.use') && can('project.settings');
  return (
    <p className="muted small" style={{ marginTop: -6 }}>
      Every pull and merge request linked to this project’s issues, with their checks, reviews and
      conflicts from GitHub / GitLab.
      {ai && ' Review them with AI, or update them with AI on their own branch.'}
      {setUp && (
        <>
          {' '}
          Set up the local repository in{' '}
          <a
            href={`/p/${P().id}/settings`}
            onClick={() => {
              S.setTab = 'code';
              emit();
            }}
          >
            Project settings → Code & GitHub
          </a>{' '}
          to review and update them with AI.
        </>
      )}
    </p>
  );
}

export function StatusTabs({ rows, f }: { rows: PrRow[]; f: PrFilters }) {
  const count = (s: string) => rows.filter((x) => x.r.status === s).length;
  const tabs: [string, string, number][] = [
    ['active', 'Active', count('Open') + count('Draft')],
    ['Open', 'Open', count('Open')],
    ['Draft', 'Draft', count('Draft')],
    ['Merged', 'Merged', count('Merged')],
    ['Declined', 'Declined', count('Declined')],
    ['all', 'All', rows.length],
  ];
  return (
    <div className="pr-stats">
      {tabs.map(([k, l, n]) => (
        <button
          key={k}
          type="button"
          className={!f.focus && f.status === k ? 'on' : ''}
          onClick={() => f.setStatus(k)}
        >
          <b>{n}</b>
          <span>{l}</span>
        </button>
      ))}
    </div>
  );
}

/** Failing checks, changes requested, conflicts …: only while some requests are open. */
export function FocusChips({ rows, f }: { rows: PrRow[]; f: PrFilters }) {
  if (!rows.some((x) => ACTIVE.includes(x.r.status))) return null;
  const count = (k: string) => rows.filter((x) => (flagsOf(x.r) as Any)[k]).length;
  return (
    <div className="pr-focus" role="group" aria-label="Needs attention">
      <span className="muted small">Needs attention</span>
      {FOCUS.map(([k, l, cls]) => {
        const n = count(k);
        const on = f.focus === k;
        return (
          <button
            key={k}
            type="button"
            className={`pr-chip ${n ? cls : ''} ${on ? 'on' : ''}`}
            disabled={!n && !on}
            aria-pressed={on}
            onClick={() => f.setFocus(on ? '' : k)}
          >
            {l}
            <b>{n}</b>
          </button>
        );
      })}
    </div>
  );
}

export function Tools({ rows, shown, f }: { rows: PrRow[]; shown: number; f: PrFilters }) {
  const repos = [...new Set(rows.map((x) => x.r.repo).filter(Boolean))] as string[];
  return (
    <div className="row pr-tools">
      <TF
        filter
        search
        value={f.q}
        placeholder="Search title, branch, issue, label…"
        onChange={(e) => f.setQ(e.target.value)}
        aria-label="Search pull requests"
      />
      {repos.length > 1 && (
        <SF
          filter
          value={f.repo}
          onChange={(e) => f.setRepo(e.target.value)}
          aria-label="Repository"
        >
          <MenuItem value="">All repositories</MenuItem>
          {repos.map((x) => (
            <MenuItem key={x} value={x}>
              {x}
            </MenuItem>
          ))}
        </SF>
      )}
      <SF filter value={f.sort} onChange={(e) => f.setSort(e.target.value)} aria-label="Sort">
        {SORTS.map(([k, l]) => (
          <MenuItem key={k} value={k}>
            {l}
          </MenuItem>
        ))}
      </SF>
      <SF filter value={f.group} onChange={(e) => f.setGroup(e.target.value)} aria-label="Group by">
        <MenuItem value="none">No grouping</MenuItem>
        <MenuItem value="status">Group by status</MenuItem>
        <MenuItem value="repo">Group by repository</MenuItem>
        <MenuItem value="epic">Group by epic</MenuItem>
      </SF>
      <span className="spacer" />
      <span className="muted small">
        {shown} of {rows.length}
      </span>
    </div>
  );
}
