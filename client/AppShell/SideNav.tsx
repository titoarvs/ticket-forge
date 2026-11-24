'use client';
// The links in the sidebar: a project's pages inside a project, the main pages elsewhere.
import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { S, type Any, activeSprint, can, feat, isDone, isSub } from '../core';
import { I, Ico, Sk } from '../ui';
import { VIEW_FEATURE, VIEWS } from '../Workspace/views';
import { VIEW_ICON } from '../Workspace/view-icons';

/** Shows a link's name beside it while the sidebar is only icons. */
export type TipProps = (text: string) => {
  onMouseEnter: (e: React.SyntheticEvent<HTMLElement>) => void;
  onFocus: (e: React.SyntheticEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  onBlur: () => void;
};
export type NavCtx = { mini: boolean; tip: TipProps };

export function SideLink({
  ctx,
  href,
  icon,
  label,
  n,
  active,
}: {
  ctx: NavCtx;
  href: string;
  icon: string;
  label: string;
  n?: number;
  active?: boolean;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <Link
      ref={ref}
      className={`side-item ${active ? 'active' : ''}`}
      href={href}
      aria-label={ctx.mini ? label : undefined}
      aria-current={active ? 'page' : undefined}
      {...ctx.tip(n ? `${label} (${n})` : label)}
    >
      <Ico svg={icon} />
      <span className="side-text">{label}</span>
      {Boolean(n) && <span className="n">{n}</span>}
    </Link>
  );
}

export function SideGroup({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`side-group ${className}`} role="group" aria-label={label}>
      <div className="side-label" aria-hidden>
        {label}
      </div>
      {children}
    </div>
  );
}

const openPrs = (p: Any) =>
  p.tickets.reduce(
    (n: number, t: Any) =>
      n + (t.prs || []).filter((r: Any) => ['Open', 'Draft'].includes(r.status)).length,
    0,
  );

/** The pages of the open project. Pages whose feature is locked are left out. */
export function ProjectNav({ p, view, ctx }: { p: Any; view: string; ctx: NavCtx }) {
  const item = (v: string, n?: number, label = VIEWS[v]) =>
    feat(VIEW_FEATURE[v] || '') ? (
      <SideLink
        key={v}
        ctx={ctx}
        href={`/p/${p.id}/${v}`}
        icon={VIEW_ICON[v]}
        label={label}
        n={n}
        active={view === v}
      />
    ) : null;
  const tests = p.tickets.reduce((s: number, t: Any) => s + t.testCases.length, 0);
  const issues = p.tickets.filter((t: Any) => !isSub(t));
  const unreleased = (p.releases || []).filter((r: Any) => r.status === 'unreleased').length;
  const hasDev = feat('prs') || (feat('code') && can('ai.use'));
  return (
    <>
      <SideGroup label="Planning">
        {item('summary')}
        {item('issues', issues.filter((t: Any) => !isDone(t)).length)}
        {item('backlog', issues.length)}
        {item('board', undefined, activeSprint() ? 'Active sprint' : 'Board')}
        {item('epics', p.epics.length)}
        {item('releases', unreleased)}
        {item('timeline')}
        {item('activity')}
        {item('reports')}
      </SideGroup>
      <SideGroup label="Quality">
        {item('tests', tests)}
        {item('testmgmt', (p.testRepo?.tests || []).length)}
        {item('automation')}
      </SideGroup>
      {hasDev && (
        <SideGroup label="Development">
          {item('prs', openPrs(p))}
          {can('ai.use') && item('codejobs')}
        </SideGroup>
      )}
      <SideGroup label="Requirements">
        {item('source', (p.sourceText ? 1 : 0) + (p.sources || []).length)}
        {item('brain')}
      </SideGroup>
    </>
  );
}

/** The main pages, outside a project. */
export function MainNav({ pathname, ctx }: { pathname: string; ctx: NavCtx }) {
  return (
    <SideGroup label="Main menu">
      <SideLink
        ctx={ctx}
        href="/projects"
        icon={I.folder}
        label="Projects"
        n={S.projectsLoaded ? S.projects.length : undefined}
        active={pathname.startsWith('/projects')}
      />
      {feat('code') && can('ai.use') && (
        <SideLink
          ctx={ctx}
          href="/code-jobs"
          icon={I.bot}
          label="Code jobs"
          active={pathname.startsWith('/code-jobs')}
        />
      )}
      {can('project.create') && (
        <SideLink
          ctx={ctx}
          href="/new"
          icon={I.plus}
          label="New project"
          active={pathname.startsWith('/new')}
        />
      )}
    </SideGroup>
  );
}

/** While a project loads. */
export function NavSkeleton() {
  return (
    <div aria-hidden>
      {[8, 3, 2].map((n, g) => (
        <div key={g} className="side-group">
          <div className="side-label">
            <Sk w={64} h={9} />
          </div>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="side-item" style={{ pointerEvents: 'none' }}>
              <Sk w={16} h={16} r={4} />
              <Sk className="side-text" w={`${48 + ((i * 17 + g * 9) % 38)}%`} h={12} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
