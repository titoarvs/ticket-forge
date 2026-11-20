'use client';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { type Any, S, api, emit, setMenu, hashColor, COLORS, P } from '../core';
import { Menu, Ico, I, TypeIcon } from '../ui';
import { openDrawer } from '../actions';

/** Inside a project: its name, and a menu to jump to another project. */
export function ProjectSwitcher({ p }: { p: Any }) {
  const open = S.menu === 'projects';
  const load = async () => {
    if (!S.projectsLoaded) {
      try {
        S.projects = await api('/api/projects');
        S.projectsLoaded = true;
        emit();
      } catch {
        /* the menu shows what it has */
      }
    }
  };
  const others = (S.projects || []).filter((x: Any) => x.id !== p.id);
  return (
    <Menu
      id="projects"
      left
      button={
        <button
          className={`proj-switch ${open ? 'on' : ''}`}
          onClick={() => {
            setMenu('projects');
            load();
          }}
          title="Switch project"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span
            className="proj-avatar xs"
            style={{ background: hashColor(p.key, COLORS) }}
            aria-hidden
          >
            {String(p.key).slice(0, 2)}
          </span>
          <span className="proj-name">{p.name}</span>
          <Ico svg={I.chevron} className="proj-chev" />
        </button>
      }
    >
      <div className="mh">Current project</div>
      <button onClick={() => S.nav(`/p/${p.id}/backlog`)}>
        <span className="proj-avatar xs" style={{ background: hashColor(p.key, COLORS) }}>
          {String(p.key).slice(0, 2)}
        </span>
        {p.name}
        <small>{p.key}</small>
      </button>
      {others.length > 0 && (
        <>
          <hr />
          <div className="mh">Switch to</div>
          {others.slice(0, 8).map((x: Any) => (
            <button key={x.id} onClick={() => S.nav(`/p/${x.id}/backlog`)}>
              <span className="proj-avatar xs" style={{ background: hashColor(x.key, COLORS) }}>
                {String(x.key).slice(0, 2)}
              </span>
              {x.name}
              <small>{x.key}</small>
            </button>
          ))}
        </>
      )}
      <hr />
      <button onClick={() => S.nav('/projects')}>
        <Ico svg={I.folder} />
        All projects
      </button>
    </Menu>
  );
}
/**
 * Search in the top bar (⌘K): issues by key or summary inside a project, projects elsewhere. Enter
 * opens the first match.
 */
export function HeaderSearch({ inProject }: { inProject: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const qq = q.trim().toLowerCase();
  const loadProjects = async () => {
    if (!inProject && !S.projectsLoaded) {
      try {
        S.projects = await api('/api/projects');
        S.projectsLoaded = true;
        emit();
      } catch {
        /* shows what it has */
      }
    }
  };
  type Hit = {
    id: string;
    key: string;
    title: string;
    go: () => void;
    icon: ReactNode;
    meta?: string;
  };
  let hits: Hit[] = [];
  if (qq) {
    if (inProject) {
      const p = P();
      const scored = p.tickets
        .map((t: Any) => {
          const key = String(t.key).toLowerCase(),
            title = String(t.title).toLowerCase();
          const score =
            key === qq
              ? 0
              : key.startsWith(qq)
                ? 1
                : title.startsWith(qq)
                  ? 2
                  : title.includes(qq) || key.includes(qq)
                    ? 3
                    : -1;
          return { t, score };
        })
        .filter((x: Any) => x.score >= 0)
        .sort((a: Any, b: Any) => a.score - b.score)
        .slice(0, 8);
      hits = scored.map(({ t }: Any) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        icon: <TypeIcon type={t.type} />,
        meta: t.status,
        go: () => openDrawer('issue', t.id),
      }));
      hits.push(
        ...p.epics
          .filter((e: Any) => `${e.key} ${e.title}`.toLowerCase().includes(qq))
          .slice(0, 3)
          .map((e: Any) => ({
            id: e.id,
            key: e.key,
            title: e.title,
            icon: <TypeIcon type="Epic" />,
            meta: 'Epic',
            go: () => openDrawer('epic', e.id),
          })),
      );
    } else {
      hits = (S.projects || [])
        .filter((x: Any) => `${x.key} ${x.name}`.toLowerCase().includes(qq))
        .slice(0, 8)
        .map((x: Any) => ({
          id: x.id,
          key: x.key,
          title: x.name,
          icon: (
            <span className="proj-avatar xs" style={{ background: hashColor(x.key, COLORS) }}>
              {String(x.key).slice(0, 2)}
            </span>
          ),
          meta: 'Project',
          go: () => S.nav(`/p/${x.id}/backlog`),
        }));
    }
  }
  const pick = (h?: Hit) => {
    if (!h) return;
    h.go();
    setQ('');
    setOpen(false);
    (document.activeElement as HTMLElement)?.blur();
  };
  return (
    <div className="tn-search" ref={ref} data-tour="tn-search">
      <Ico svg={I.search} className="tn-search-ic" />
      <input
        id="tn-search"
        type="search"
        autoComplete="off"
        placeholder={inProject ? 'Search issues' : 'Search projects'}
        aria-label={inProject ? 'Search issues by key or summary' : 'Search projects'}
        value={q}
        onFocus={() => {
          setOpen(true);
          loadProjects();
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(hits[active]);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setQ('');
            setOpen(false);
            (e.target as HTMLElement).blur();
          }
        }}
      />
      <kbd className="tn-kbd" aria-hidden>
        ⌘K
      </kbd>
      {open && qq && (
        <div className="tn-results" role="listbox">
          {hits.length ? (
            hits.map((h, i) => (
              <button
                key={h.id}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'on' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
              >
                {h.icon}
                <span className="key">{h.key}</span>
                <span className="tn-r-title">{h.title}</span>
                {h.meta && <small>{h.meta}</small>}
              </button>
            ))
          ) : (
            <p className="muted small tn-none">Nothing matches “{q.trim()}”.</p>
          )}
        </div>
      )}
    </div>
  );
}
