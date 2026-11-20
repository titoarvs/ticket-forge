'use client';
// The repository's left side: organize by epics or folders, all tests, the tree, and managing
// folders.
import type { Any } from '../../core';
import { Ico, I } from '../../ui';
import { TF } from '../../fields';
import { canEdit } from '../TestManagement';
import { confirmDeleteFolder, sortIntoEpicFolders } from './folder-ops';
import { EpicTree } from './epic-tree';
import type { Repo } from './use-repository';

type RowProps = { g: Repo; id: string; icon: string; label: string; count: number };

/** A tree row that picks a folder (or "all", "unlinked", "none"). */
function PickRow({ g, id, icon, label, count }: RowProps) {
  return (
    <button className={`xr-folder ${g.folder === id ? 'on' : ''}`} onClick={() => g.setFolder(id)}>
      <Ico svg={icon} />
      <span>{label}</span>
      <span className="count">{count}</span>
    </button>
  );
}

function ModeTabs({ g }: { g: Repo }) {
  const tab = (m: string, label: string) => (
    <button
      role="tab"
      aria-selected={g.mode === m}
      className={g.mode === m ? 'on' : ''}
      onClick={() => g.setMode(m)}
    >
      {label}
    </button>
  );
  return (
    <div className="xr-mode" role="tablist" aria-label="Organize by">
      {tab('epics', 'Epics')}
      {tab('folders', 'Folders')}
    </div>
  );
}

function EpicsSide({ g }: { g: Repo }) {
  const unlinked = g.r.tests.filter((t: Any) => !(t.issueIds || []).length).length;
  return (
    <>
      <EpicTree g={g} />
      {unlinked > 0 && (
        <PickRow g={g} id="unlinked" icon={I.doc} label="Not linked to an issue" count={unlinked} />
      )}
      {canEdit() && g.r.tests.length > 0 && (
        <button
          className="btn sm subtle"
          onClick={sortIntoEpicFolders}
          title="Make the folders match the epics"
        >
          <Ico svg={I.folder} />
          Sort into epic folders
        </button>
      )}
    </>
  );
}

function FolderTree({ g, parentId, depth }: { g: Repo; parentId: string | null; depth: number }) {
  const { r, folder, setFolder } = g;
  return (
    <>
      {r.folders
        .filter((f: Any) => (f.parentId || null) === parentId)
        .map((f: Any) => (
          <div key={f.id}>
            <button
              className={`xr-folder ${folder === f.id ? 'on' : ''}`}
              style={{ paddingLeft: 10 + depth * 14 }}
              title={f.name}
              onClick={() => setFolder(f.id)}
            >
              <Ico svg={I.folder} />
              <span>{f.name}</span>
              <span className="count">
                {r.tests.filter((t: Any) => t.folderId === f.id).length}
              </span>
            </button>
            <FolderTree g={g} parentId={f.id} depth={depth + 1} />
          </div>
        ))}
    </>
  );
}

/** "New folder" (inside the chosen one): Enter or leaving the box saves, Escape cancels. */
function NewFolder({ g }: { g: Repo }) {
  const { cur, newFolder, setNewFolder, saveNewFolder } = g;
  if (newFolder === null)
    return (
      <button className="btn sm subtle" onClick={() => setNewFolder('')}>
        <Ico svg={I.plus} />
        New folder{cur ? ' here' : ''}
      </button>
    );
  return (
    <div className="xr-newfolder">
      <TF
        autoFocus
        value={newFolder}
        placeholder={cur ? `Folder inside ${cur.name}` : 'Folder name'}
        onChange={(e) => setNewFolder(e.target.value)}
        onKeyDown={(e: Any) => {
          if (e.key === 'Enter') saveNewFolder();
          if (e.key === 'Escape') setNewFolder(null);
        }}
        onBlur={saveNewFolder}
      />
    </div>
  );
}

function FoldersSide({ g }: { g: Repo }) {
  const loose = g.r.tests.filter((t: Any) => !t.folderId).length;
  return (
    <>
      <FolderTree g={g} parentId={null} depth={0} />
      <PickRow g={g} id="none" icon={I.doc} label="Not in a folder" count={loose} />
      {canEdit() && <NewFolder g={g} />}
    </>
  );
}

export function Sidebar({ g }: { g: Repo }) {
  const { cur } = g;
  return (
    <aside className="xr-tree">
      <ModeTabs g={g} />
      <PickRow g={g} id="all" icon={I.test} label="All tests" count={g.r.tests.length} />
      {g.mode === 'epics' ? <EpicsSide g={g} /> : <FoldersSide g={g} />}
      {cur && canEdit() && (
        <button
          className="btn sm subtle"
          onClick={() => confirmDeleteFolder(cur, () => g.setFolder('all'))}
        >
          <Ico svg={I.trash} />
          Delete folder
        </button>
      )}
    </aside>
  );
}
