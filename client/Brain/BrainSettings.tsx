'use client';
import { useState } from 'react';
import { type Any, useStore, P, api, toast, openModal, ago } from '../core';
import { Modal, Ico, I, Spinner } from '../ui';
import { TF } from '../fields';
import { FolderPicker } from '../DevCode';
import { type List, TYPE_ORDER } from './make-resolver';

export function BrainSettings({ list, reload }: { list: List | null; reload: () => Promise<Any> }) {
  useStore();
  const [useInAi, setUseInAi] = useState(list?.useInAi !== false);
  const [dir, setDir] = useState(list?.sync?.dir || '');
  const [busy, setBusy] = useState('');
  const [last, setLast] = useState<Any>(list?.sync?.last || null);
  const can = list?.can;
  const pid = P().id;
  const saveAi = async (v: boolean) => {
    setUseInAi(v);
    try {
      await api(`/api/projects/${pid}/brain`, {
        method: 'POST',
        body: { action: 'settings', useInAi: v },
      });
      await reload();
      toast(
        v
          ? 'AI actions read the brain again.'
          : 'AI actions no longer read the brain for this project.',
      );
    } catch (e: Any) {
      setUseInAi(!v);
      toast(e.message, 'err');
    }
  };
  const sync = async () => {
    setBusy('sync');
    try {
      const r = await api(`/api/projects/${pid}/brain`, {
        method: 'POST',
        body: { action: 'sync', dir },
      });
      setLast(r);
      await reload();
      toast(
        `${r.wroteAuto} written from the project, ${r.toFolder} of your notes to the folder, ${r.fromFolder + r.newNotes} from the folder${r.conflicts.length ? `; ${r.conflicts.length} changed on both sides (the newer one kept)` : ''}.`,
        'ok',
        { title: 'Synced' },
      );
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const stop = async () => {
    try {
      await api(`/api/projects/${pid}/brain`, {
        method: 'POST',
        body: { action: 'syncFolder', dir: '' },
      });
      setDir('');
      setLast(null);
      await reload();
      toast('Folder sync turned off. The folder keeps its files.');
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };
  return (
    <Modal title="Brain settings" actions={[{ label: 'Done', kind: 'primary' }]}>
      <label className="row brain-toggle" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={useInAi}
          disabled={!can?.settings}
          onChange={(e) => saveAi(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <b>AI reads the brain</b>
          <br />
          <span className="muted small">
            Writing tickets and test cases, documents, splits, plans and code jobs start from the
            notes linked to their issue or epic (up to about 9,000 characters).
            {!can?.settings ? ' Changing this needs the Project settings permission.' : ''}
          </span>
        </span>
      </label>
      <hr className="sep" />
      <h3 className="brain-h" style={{ marginTop: 0 }}>
        Sync with a folder
      </h3>
      {!list?.local ? (
        <p className="muted small">
          When TicketForge runs on your computer (opened at localhost), it can keep a folder, such
          as one inside your Obsidian vault, in step with the brain. Here, use Download for Obsidian
          and Import instead.
        </p>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            Writes every note to the folder. Your own notes go both ways: edit them in Obsidian or
            here, and each sync copies the newer version across. New files in the folder become
            notes. Notes TicketForge writes are refreshed in the folder each time.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <TF
              size="small"
              sx={{ flex: '1 1 260px' }}
              value={dir}
              onChange={(e: Any) => setDir(e.target.value)}
              placeholder="/Users/you/Obsidian/My vault/Project brain"
              aria-label="Folder"
              disabled={!can?.settings}
            />
            <button
              className="btn"
              disabled={!can?.settings}
              onClick={() =>
                openModal(
                  <FolderPicker
                    start={dir}
                    title="Choose the folder to sync"
                    hint="Open the folder for this project’s notes (it can be inside your Obsidian vault), then choose it."
                    onPick={(x) => {
                      setDir(x);
                      openModal(
                        <BrainSettings
                          list={{ ...(list as List), sync: { ...(list?.sync || {}), dir: x } }}
                          reload={reload}
                        />,
                      );
                    }}
                  />,
                )
              }
            >
              <Ico svg={I.folder} />
              Browse…
            </button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button
              className="btn primary"
              disabled={!can?.settings || !dir.trim() || busy === 'sync'}
              onClick={sync}
            >
              {busy === 'sync' ? <Spinner /> : <Ico svg={I.refresh} />}Sync now
            </button>
            {list?.sync?.dir && (
              <button className="btn subtle" disabled={!can?.settings} onClick={stop}>
                Stop syncing
              </button>
            )}
          </div>
          {last && (
            <p className="muted small">
              Last sync{list?.sync?.at ? ` ${ago(list.sync.at)}` : ''}: {last.wroteAuto} generated
              notes written, {last.toFolder} of yours to the folder,{' '}
              {(last.fromFolder || 0) + (last.newNotes || 0)} from it
              {last.deletedNotes ? `, ${last.deletedNotes} deleted here` : ''}
              {last.deletedFiles ? `, ${last.deletedFiles} files deleted` : ''}.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
// ---------------------------------------------------------------- graph
/**
 * Colours per note type, read from the page's CSS variables (so they follow light and dark mode).
 */
export function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  const out: Record<string, string> = {};
  for (const t of TYPE_ORDER) out[t] = v(`--bn-${t}`, '#8590a2');
  return {
    ...out,
    edge: v('--bn-edge', 'rgba(130,140,160,.35)'),
    edgeHi: v('--brand', '#0c66e4'),
    text: v('--text', '#172b4d'),
    bg: v('--bg', '#fff'),
    muted: v('--text-subtlest', '#626f86'),
  };
}
export type GNode = {
  id: string;
  type: string;
  title: string;
  key: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
  fixed?: boolean;
};
