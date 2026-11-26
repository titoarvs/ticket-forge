'use client';
// Project settings → GitHub issues → GitHub Project: pick the board (github.com/…/projects/N) whose
// Status, Priority, story points and sprint iterations are imported into the tickets (read-only:
// nothing is written to the board), or unlink it. The
// list comes from the linked repository and its owner. Only the project owner and the Super Admin
// can change it (the server checks too).
import { useState } from 'react';
import { P, api, pullRemote, toast, type Any } from './core';
import { Spinner } from './ui';
import { SF, MenuItem } from './fields';

const FIELD_NAMES: [string, string][] = [
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['points', 'Story points'],
  ['sprint', 'Sprint'],
];

const call = (body: Any) =>
  api(`/api/projects/${encodeURIComponent(P().id)}/github-sync`, { method: 'POST', body });

/** Which board field fills which ticket field ("Status, Story points ← Estimate"). */
function Mapped({ fields }: { fields: Any }) {
  const parts = FIELD_NAMES.filter(([k]) => fields?.[k]).map(([k, label]) =>
    fields[k] === label ? label : `${label} ← ${fields[k]}`,
  );
  const missing = FIELD_NAMES.filter(([k]) => !fields?.[k]).map(([, label]) => label);
  return (
    <small className="muted">
      Imports: {parts.length ? parts.join(', ') : 'nothing yet'}.
      {missing.length > 0 && ` Not on the board: ${missing.join(', ')}.`}
    </small>
  );
}

function Linked({ board, allowed }: { board: Any; allowed: boolean }) {
  const [busy, setBusy] = useState(false);
  const unlink = async () => {
    setBusy(true);
    try {
      await call({ action: 'unlink-board' });
      await pullRemote({ quiet: true });
      toast(`Unlinked “${board.title}”`);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="field">
      <span>GitHub Project</span>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <a href={board.url} target="_blank" rel="noreferrer">
          {board.title}
        </a>
        <button className="btn sm subtle" disabled={!allowed || busy} onClick={unlink}>
          {busy ? <Spinner /> : 'Unlink'}
        </button>
      </div>
      <Mapped fields={board.fields} />
    </div>
  );
}

function Chooser({ allowed }: { allowed: boolean }) {
  const [boards, setBoards] = useState<Any[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState('');
  const repo = P().githubSync?.repo;
  const load = async () => {
    setBusy('load');
    try {
      const r = await call({ action: 'boards' });
      setBoards(r.boards);
      setPick(r.boards[0]?.id || '');
      if (!r.boards.length)
        toast('No open GitHub Projects found for this repository or its owner.');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const link = async () => {
    setBusy('link');
    try {
      const r = await call({ action: 'link-board', boardId: pick });
      await pullRemote({ quiet: true });
      toast(`Linked “${r.board.title}”. Sync from GitHub to bring the board in.`, 'ok', {
        title: 'GitHub Project linked',
      });
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  if (!boards)
    return (
      <div className="field">
        <span>GitHub Project</span>
        <div>
          <button className="btn sm" disabled={!allowed || !repo || Boolean(busy)} onClick={load}>
            {busy === 'load' ? <Spinner /> : 'Choose a GitHub Project'}
          </button>
        </div>
        <small className="muted">
          {repo
            ? 'Optional: import Status, Priority, story points and sprints from a GitHub Project board.'
            : 'Link a repository first.'}
        </small>
      </div>
    );
  return (
    <div className="field">
      <span>GitHub Project</span>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <SF value={pick} onChange={(e) => setPick(e.target.value)} aria-label="GitHub Project">
          {boards.map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {b.title} (#{b.number})
            </MenuItem>
          ))}
        </SF>
        <button className="btn primary sm" disabled={!pick || Boolean(busy)} onClick={link}>
          {busy === 'link' ? <Spinner /> : 'Link project'}
        </button>
      </div>
    </div>
  );
}

export function GithubBoardPicker({ allowed }: { allowed: boolean }) {
  const board = P().githubSync?.project;
  return board ? <Linked board={board} allowed={allowed} /> : <Chooser allowed={allowed} />;
}
