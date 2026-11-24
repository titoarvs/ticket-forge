'use client';
// One pull request in the list: what it is, its checks and reviews, its issue, its actions, and
// (expanded) its details.
import { type Any, can, openModal, mutate, logEvent, ago, setMenu, copyText } from '../../core';
import { Confirm, Avatar, Ico, I, TypeIcon, LayerChip, Menu } from '../../ui';
import { refreshPr, openDrawer } from '../../actions';
import { openUpdatePr } from '../../DevCode';
import { PrFindingChips, openPrFindings } from '../../CodeRabbit';
import {
  ACTIVE,
  flagsOf,
  StatusIcon,
  ChecksChip,
  ReviewChip,
  SizeChip,
  PrDetails,
} from '../PrDetails';
import { ref, prCls, VERDICT_CLS, ReviewModal } from '../ReviewModal';

type RowProps = {
  t: Any;
  r: Any;
  ai: boolean;
  open: boolean;
  onToggle: () => void;
  refreshing: boolean;
};

const hosted = (r: Any) => ['GitHub', 'GitLab'].includes(r.provider);
/** AI can review or update open requests on GitHub / GitLab that have a branch. */
const aiCan = (r: Any) => ACTIVE.includes(r.status) && hosted(r) && r.branch;

const confirmUnlink = (t: Any, r: Any) =>
  openModal(
    <Confirm
      title={`Unlink ${r.title}?`}
      label="Unlink"
      text={`It stays on ${r.provider || 'its host'}; it's only removed from ${t.key}.`}
      onYes={() =>
        mutate(() => {
          t.prs = t.prs.filter((x: Any) => x.id !== r.id);
          logEvent(t, `unlinked pull request ${r.title}`);
        })
      }
    />,
  );

function AiVerdict({ v }: { v: Any }) {
  return (
    <span
      className={`loz ${VERDICT_CLS[v.verdict] || ''}`}
      title={`${v.agent} · ${ago(v.at)}${v.posted ? ' · posted on the request' : ''}`}
    >
      AI: {v.verdict}
      {v.posted ? ' ✓' : ''}
    </span>
  );
}

/** Title, number, state, AI verdict; repository, branches, author and dates; checks and the issue. */
function PrSummary({ t, r }: { t: Any; r: Any }) {
  const f = flagsOf(r);
  return (
    <div className="pr-body">
      <div className="pr-l1">
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="pr-title">
          {r.title}
        </a>
        <span className="pr-num">{ref(r)}</span>
        <span className={`loz ${prCls(r.status)}`}>{r.status}</span>
        {r.aiReview && <AiVerdict v={r.aiReview} />}
      </div>
      <div className="pr-l2 muted small">
        <span>{r.repo}</span>
        {r.branch && (
          <span className="pr-br">
            <code>{r.branch}</code> → <code>{r.base || '…'}</code>
          </span>
        )}
        {r.author && (
          <span className="pr-who">
            <Avatar name={r.author} size={16} />
            {r.author}
          </span>
        )}
        {r.createdAt && <span>opened {ago(r.createdAt)}</span>}
        {r.updatedAt && <span>updated {ago(r.updatedAt)}</span>}
      </div>
      <div className="pr-l3">
        <ChecksChip c={r.checks} />
        <ReviewChip r={r} />
        <PrFindingChips t={t} r={r} />
        {f.conflicts && (
          <span className="pr-chip t-fail">
            <Ico svg={I.warn} />
            Conflicts
          </span>
        )}
        {f.ready && <span className="pr-chip t-pass">Ready to merge</span>}
        <SizeChip s={r.size} />
        {r.comments > 0 && (
          <span className="pr-meta" title={`${r.comments} comments`}>
            <Ico svg={I.comment} />
            {r.comments}
          </span>
        )}
        <button
          type="button"
          className="pr-issue small"
          onClick={() => openDrawer('issue', t.id)}
          title="Open the issue"
        >
          <TypeIcon type={t.type} />
          <span className="key">{t.key}</span>
          <span className="pr-issue-t">{t.title}</span>
          {t.layer && <LayerChip layer={t.layer} short />}
        </button>
      </div>
    </div>
  );
}

function MoreMenu({ t, r, id }: { t: Any; r: Any; id: string }) {
  return (
    <Menu
      id={`pr-${id}`}
      button={
        <button
          className="icon-btn"
          aria-label="More actions"
          title="More"
          onClick={() => setMenu(`pr-${id}`)}
        >
          <Ico svg={I.more} />
        </button>
      }
    >
      {r.branch && (
        <button onClick={() => copyText(r.branch)}>
          <Ico svg={I.copy} />
          Copy branch name
        </button>
      )}
      <button onClick={() => copyText(r.url)}>
        <Ico svg={I.link} />
        Copy link
      </button>
      <button onClick={() => openDrawer('issue', t.id)}>
        <Ico svg={I.expand} />
        Open {t.key}
      </button>
      {can('issue.edit') && (
        <>
          <hr />
          <button style={{ color: 'var(--danger)' }} onClick={() => confirmUnlink(t, r)}>
            <Ico svg={I.trash} />
            Unlink from {t.key}
          </button>
        </>
      )}
    </Menu>
  );
}

/** Review, CodeRabbit, Update, Refresh, Open, ⋯ and the details toggle. */
function PrActions({ t, r, ai, open, onToggle, refreshing, id }: RowProps & { id: string }) {
  const edit = can('issue.edit');
  const host = r.provider || 'the host';
  return (
    <div className="pr-acts">
      {ai && aiCan(r) && (
        <button
          className="btn sm ai"
          onClick={() => openModal(<ReviewModal t={t} pr={r} />)}
          title="A read-only review agent reviews the diff against the issue"
        >
          <Ico svg={I.sparkle} />
          Review
        </button>
      )}
      {hosted(r) && (
        <button
          className="btn sm subtle"
          onClick={() => openPrFindings(t, r)}
          title="CodeRabbit's review comments: fix with an agent, file as bugs, or dismiss"
        >
          <Ico svg={I.eye} />
          CodeRabbit
        </button>
      )}
      {ai && edit && aiCan(r) && (
        <button
          className="btn sm"
          onClick={() => openUpdatePr(t, r)}
          title="Change, enhance, address review comments or re-describe it with AI"
        >
          Update
        </button>
      )}
      {edit && (
        <button
          className="icon-btn"
          title="Refresh from the host"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={() => refreshPr(t, r.id)}
        >
          <Ico svg={I.refresh} />
        </button>
      )}
      <a
        className="icon-btn"
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open on ${host}`}
        aria-label={`Open on ${host}`}
      >
        <Ico svg={I.external} />
      </a>
      <MoreMenu t={t} r={r} id={id} />
      <button
        className="icon-btn pr-toggle"
        aria-label={open ? 'Hide details' : 'Show details'}
        title={open ? 'Hide details' : 'Details'}
        onClick={onToggle}
      >
        <Ico svg={I.chevron} />
      </button>
    </div>
  );
}

/** Clicking the row (not a link or button) or pressing Enter / Space toggles its details. */
export function PrListRow(props: RowProps) {
  const { t, r, open, onToggle } = props;
  const id = `${t.id}-${r.id}`;
  return (
    <div className={`pr-item s-${String(r.status).toLowerCase()} ${open ? 'open' : ''}`}>
      <div
        className="pr-row"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('a, button')) onToggle();
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <StatusIcon r={r} />
        <PrSummary t={t} r={r} />
        <PrActions {...props} id={id} />
      </div>
      {open && <PrDetails t={t} r={r} />}
    </div>
  );
}
