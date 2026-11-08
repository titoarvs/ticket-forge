'use client';
// Skeleton screens: shaped like each page so the layout doesn't jump when the content arrives.
import { usePathname } from 'next/navigation';
import { I, Sk, Loading } from './ui';
import { S } from './core';

// Fixed, varied widths so rows look like text without changing on every render.
const W = [72, 54, 86, 63, 78, 48, 67, 81];
const w = (i: number, min = 0) => `${Math.max(min, W[i % W.length])}%`;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function TopNavSkeleton() {
  return (
    <header className="topnav" aria-hidden="true">
      <span className="brand"><span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} />TicketForge</span>
      <Sk w={64} h={14} style={{ margin: '0 12px' }} />
      <Sk w={96} h={14} />
      <div className="spacer" />
      <Sk w={24} h={24} r="50%" style={{ marginRight: 12 }} />
      <Sk w={150} h={28} r={14} style={{ marginRight: 12 }} />
      <Sk w={28} h={28} r="50%" />
    </header>
  );
}

function HeaderSk({ crumbs = true, buttons = 1 }: { crumbs?: boolean; buttons?: number }) {
  return <>
    {crumbs && <Sk w={160} h={10} style={{ marginBottom: 12 }} />}
    <div className="page-h"><Sk w={200} h={24} /><div className="spacer" />{range(buttons).map((i) => <Sk key={i} w={i ? 96 : 120} h={32} />)}</div>
  </>;
}
function ToolbarSk({ filters = 3 }: { filters?: number }) {
  return <div className="toolbar"><Sk w={220} h={32} />{range(filters).map((i) => <Sk key={i} w={88} h={32} />)}</div>;
}

export function TableSkeleton({ rows = 6, cols = 5, lead = 'avatar' }: { rows?: number; cols?: number; lead?: 'avatar' | 'square' | 'none' }) {
  return (
    <table className="tbl" aria-hidden="true">
      <thead><tr>{range(cols).map((c) => <th key={c}><Sk w={c ? 48 : 80} h={10} /></th>)}</tr></thead>
      <tbody>{range(rows).map((r) => (
        <tr key={r}>{range(cols).map((c) => (
          <td key={c}>{c === 0
            ? <div className="sk-row">{lead !== 'none' && <Sk w={24} h={24} r={lead === 'avatar' ? '50%' : 4} />}<Sk w={w(r)} h={12} /></div>
            : <Sk w={`${35 + ((r * 7 + c * 13) % 45)}%`} h={12} />}</td>
        ))}</tr>
      ))}</tbody>
    </table>
  );
}

function TilesSk() {
  return <div className="tiles">{range(4).map((i) => (
    <div key={i} className="tile"><Sk w={40} h={40} r={8} /><div className="sk-stack"><Sk w={48} h={18} /><Sk w={w(i)} h={10} /></div></div>
  ))}</div>;
}

// ---------------------------------------------------------------- project views
function BacklogSk() {
  return <>
    <HeaderSk buttons={2} /><ToolbarSk />
    {[4, 6].map((n, s) => (
      <div key={s} className="sk-sec">
        <div className="sk-row"><Sk w={16} h={16} r={4} /><Sk w={s ? 70 : 120} h={14} /><Sk w={110} h={10} /><div className="spacer" /><Sk w={64} h={24} /></div>
        <div style={{ borderRadius: 6, overflow: 'hidden' }}>{range(n).map((i) => (
          <div key={i} className="sk-irow"><Sk w={16} h={16} r={4} /><Sk w={52} h={12} /><Sk w={w(i + s * 3)} h={12} style={{ flex: '0 1 auto' }} />
            <div className="spacer" /><Sk w={72} h={18} /><Sk w={24} h={24} r="50%" /></div>
        ))}</div>
      </div>
    ))}
  </>;
}
function BoardSk() {
  return <>
    <HeaderSk buttons={1} /><ToolbarSk filters={2} />
    <div style={{ overflowX: 'auto' }}><div className="board">{[3, 2, 2, 1].map((n, c) => (
      <div key={c} className="col"><Sk w={80} h={10} style={{ margin: '4px 4px 6px' }} />
        {range(n).map((i) => (
          <div key={i} className="sk-bcard"><Sk w={w(c * 2 + i)} h={12} /><Sk w={w(c + i + 3, 40)} h={12} />
            <div className="sk-row"><Sk w={16} h={16} r={4} /><Sk w={48} h={10} /><div className="spacer" /><Sk w={24} h={24} r="50%" /></div></div>
        ))}
      </div>
    ))}</div></div>
  </>;
}
function CardsSk({ cards = 4 }: { cards?: number }) {
  return <div className="cards">{range(cards).map((i) => (
    <div key={i} className={`card ${i === cards - 1 && cards % 2 ? 'wide' : ''}`}>
      <Sk w={140} h={16} /><Sk w={w(i, 50)} h={10} style={{ margin: '8px 0 20px' }} />
      {range(3).map((r) => <div key={r} className="sk-row" style={{ marginBottom: 12 }}><Sk w={20} h={20} r="50%" /><Sk w={w(i + r)} h={12} /></div>)}
    </div>
  ))}</div>;
}
function DocSk() {
  return <><HeaderSk buttons={0} /><Sk w={220} h={10} style={{ marginBottom: 20 }} />
    <div style={{ maxWidth: 760 }}>{range(14).map((i) => <Sk key={i} className="sk-line" w={i % 5 === 4 ? '40%' : `${88 + (i % 3) * 4}%`} h={12} />)}</div></>;
}
function FormSk() {
  return <><HeaderSk buttons={0} /><div style={{ maxWidth: 560 }}>{range(5).map((i) => (
    <div key={i} className="sk-field"><Sk w={w(i, 30)} h={10} style={{ maxWidth: 180, marginBottom: 8 }} /><Sk h={i === 2 ? 80 : 36} /></div>
  ))}</div></>;
}
const VIEW_SKELETONS: Record<string, () => React.ReactNode> = {
  backlog: BacklogSk,
  board: BoardSk,
  summary: () => <><HeaderSk buttons={0} /><CardsSk cards={5} /></>,
  reports: () => <><HeaderSk buttons={0} /><CardsSk cards={4} /></>,
  epics: () => <><HeaderSk buttons={1} /><TableSkeleton rows={5} cols={4} lead="square" /></>,
  tests: () => <><HeaderSk buttons={1} /><TilesSk /><ToolbarSk /><TableSkeleton rows={7} cols={5} lead="none" /></>,
  automation: () => <><HeaderSk buttons={1} /><TilesSk /><ToolbarSk filters={1} /><TableSkeleton rows={6} cols={4} lead="none" /></>,
  source: DocSk,
  settings: FormSk,
};
export function ViewSkeleton({ view }: { view: string }) {
  const V = VIEW_SKELETONS[view] || BacklogSk;
  return <V />;
}

function SidebarSk() {
  return (
    <div className={`side-wrap ${S.sideCollapsed ? 'mini' : ''}`}>
    <nav className="sidebar" aria-hidden="true">
      <div className="proj-head"><Sk w={32} h={32} r={4} /><div className="sk-stack" style={{ gap: 6 }}><Sk w="75%" h={12} /><Sk w="50%" h={10} /></div></div>
      {[5, 2, 1].map((n, g) => (
        <div key={g}><Sk w={64} h={8} style={{ margin: '18px 10px 10px' }} />
          {range(n).map((i) => <div key={i} className="side-item" style={{ pointerEvents: 'none' }}><Sk w={16} h={16} r={4} /><Sk className="side-text" w={w(i + g * 2, 45)} h={12} style={{ maxWidth: 120 }} /></div>)}
        </div>
      ))}
    </nav>
    </div>
  );
}
export function WorkspaceSkeleton({ view }: { view: string }) {
  return (
    <Loading label="Loading project…" className="shell">
      <SidebarSk />
      <div className="main"><section className="view"><ViewSkeleton view={view} /></section></div>
    </Loading>
  );
}

// ---------------------------------------------------------------- pages
export function ProjectsSkeleton() {
  return <Loading label="Loading projects…"><div className="toolbar"><Sk w={220} h={32} /></div><TableSkeleton rows={5} cols={6} lead="square" /></Loading>;
}
function ProjectsPageSk() {
  return <div className="page"><div className="page-inner"><HeaderSk crumbs={false} buttons={2} /><ProjectsSkeleton /></div></div>;
}
export function AdminSkeleton() {
  return (
    <div className="page"><div className="page-inner"><Loading label="Loading administration…">
      <HeaderSk buttons={1} />
      <div className="tabbar" style={{ paddingBottom: 10, gap: 16 }}>{[60, 64, 140, 56, 120].map((x, i) => <Sk key={i} w={x} h={14} />)}</div>
      <ToolbarSk filters={0} /><TableSkeleton rows={5} cols={5} />
    </Loading></div></div>
  );
}
function NewProjectSk() {
  return <div className="page"><div className="page-inner" style={{ maxWidth: 760 }}><Loading><HeaderSk buttons={0} /><Sk h={220} r={8} style={{ marginBottom: 16 }} /><FormSk /></Loading></div></div>;
}

/** First load of the app, before we know who's signed in: a skeleton of the page being opened. */
export function AppSkeleton() {
  const path = usePathname() || '/';
  let body: React.ReactNode;
  if (path.startsWith('/p/')) body = <WorkspaceSkeleton view={path.split('/')[3] || 'backlog'} />;
  else if (path.startsWith('/admin')) body = <AdminSkeleton />;
  else if (path.startsWith('/new')) body = <NewProjectSk />;
  else body = <ProjectsPageSk />;
  return <><TopNavSkeleton /><main id="app">{body}</main></>;
}

export function AuthSkeleton() {
  return (
    <div className="auth-wrap"><Loading className="auth-card">
      <div className="auth-brand"><span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} />TicketForge</div>
      <Sk w={120} h={20} style={{ margin: '0 auto 10px' }} /><Sk w={220} h={10} style={{ margin: '0 auto 24px' }} />
      {range(2).map((i) => <div key={i} className="sk-field"><Sk w={i ? 64 : 40} h={10} style={{ marginBottom: 8 }} /><Sk h={40} /></div>)}
      <Sk h={36} style={{ marginTop: 8 }} />
    </Loading></div>
  );
}

export function NotifSkeleton() {
  return <Loading label="Loading notifications…">{range(3).map((i) => (
    <div key={i} className="sk-notif"><Sk w={28} h={28} r="50%" /><div className="sk-stack" style={{ gap: 6 }}><Sk w={w(i)} h={12} /><Sk w={w(i + 3)} h={10} /><Sk w={60} h={10} /></div></div>
  ))}</Loading>;
}
