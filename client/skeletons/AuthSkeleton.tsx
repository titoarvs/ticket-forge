'use client';
import { usePathname } from 'next/navigation';
import { Loading, Sk, I } from '../ui';
import {
  HeaderSk,
  ToolbarSk,
  TableSkeleton,
  FormSk,
  WorkspaceSkeleton,
  ProjectsPageSk,
  TopNavSkeleton,
  range,
  w,
} from './TableSkeleton';

export function AdminSkeleton() {
  return (
    <div className="page">
      <div className="page-inner">
        <Loading label="Loading administration…">
          <HeaderSk buttons={1} />
          <div className="tabbar" style={{ paddingBottom: 10, gap: 16 }}>
            {[60, 64, 140, 56, 120].map((x, i) => (
              <Sk key={i} w={x} h={14} />
            ))}
          </div>
          <ToolbarSk filters={0} />
          <TableSkeleton rows={5} cols={5} />
        </Loading>
      </div>
    </div>
  );
}
function NewProjectSk() {
  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 760 }}>
        <Loading>
          <HeaderSk buttons={0} />
          <Sk h={220} r={8} style={{ marginBottom: 16 }} />
          <FormSk />
        </Loading>
      </div>
    </div>
  );
}
/** First load of the app, before we know who's signed in: a skeleton of the page being opened. */
export function AppSkeleton() {
  const path = usePathname() || '/';
  let body: React.ReactNode;
  if (path.startsWith('/p/')) body = <WorkspaceSkeleton view={path.split('/')[3] || 'backlog'} />;
  else if (path.startsWith('/admin')) body = <AdminSkeleton />;
  else if (path.startsWith('/new')) body = <NewProjectSk />;
  else body = <ProjectsPageSk />;
  return (
    <>
      <TopNavSkeleton />
      <main id="app">{body}</main>
    </>
  );
}
export function AuthSkeleton() {
  return (
    <div className="auth-wrap">
      <Loading className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} />
          TicketForge
        </div>
        <Sk w={120} h={20} style={{ margin: '0 auto 10px' }} />
        <Sk w={220} h={10} style={{ margin: '0 auto 24px' }} />
        {range(2).map((i) => (
          <div key={i} className="sk-field">
            <Sk w={i ? 64 : 40} h={10} style={{ marginBottom: 8 }} />
            <Sk h={40} />
          </div>
        ))}
        <Sk h={36} style={{ marginTop: 8 }} />
      </Loading>
    </div>
  );
}
export function NotifSkeleton() {
  return (
    <Loading label="Loading notifications…">
      {range(3).map((i) => (
        <div key={i} className="sk-notif">
          <Sk w={28} h={28} r="50%" />
          <div className="sk-stack" style={{ gap: 6 }}>
            <Sk w={w(i)} h={12} />
            <Sk w={w(i + 3)} h={10} />
            <Sk w={60} h={10} />
          </div>
        </div>
      ))}
    </Loading>
  );
}
