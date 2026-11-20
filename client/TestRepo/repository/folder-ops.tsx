'use client';
// Changing the repository's folders: adding one, deleting one (its contents move up), and
// rebuilding the folders to match the epics.
import { type Any, uid, openModal, toast } from '../../core';
import { Confirm } from '../../ui';
import { edit } from '../run-status';

export function addFolder(name: string, parentId: string | null) {
  edit((rr) => {
    rr.folders.push({ id: uid(), name, parentId });
  });
}

/** Asks first; the folder's tests and sub-folders move up to its parent, no test is deleted. */
export function confirmDeleteFolder(cur: Any, onDone: () => void) {
  openModal(
    <Confirm
      title={`Delete the folder “${cur.name}”?`}
      label="Delete folder"
      text="Its tests and sub-folders move up to the parent folder. No test is deleted."
      onYes={() => {
        edit((rr) => {
          rr.tests.forEach((t: Any) => {
            if (t.folderId === cur.id) t.folderId = cur.parentId || null;
          });
          rr.folders.forEach((f: Any) => {
            if (f.parentId === cur.id) f.parentId = cur.parentId || null;
          });
          rr.folders = rr.folders.filter((f: Any) => f.id !== cur.id);
        });
        onDone();
      }}
    />,
  );
}

/** One folder per epic, each test in the folder of its (first) issue's epic. Returns tests moved. */
function moveIntoEpicFolders() {
  let moved = 0;
  edit((rr, pp) => {
    const folderFor = (name: string) => {
      let f = rr.folders.find((x: Any) => x.name === name && !x.parentId);
      if (!f) {
        f = { id: uid(), name, parentId: null };
        rr.folders.push(f);
      }
      return f.id;
    };
    for (const t of rr.tests) {
      const epicId = pp.tickets.find((x: Any) => x.id === (t.issueIds || [])[0])?.epicId;
      const ep = pp.epics.find((e: Any) => e.id === epicId);
      const id = folderFor(ep ? `${ep.key} ${ep.title}` : 'No epic');
      if (t.folderId !== id) {
        t.folderId = id;
        moved++;
      }
    }
    // epic folders in backlog order, then the rest
    const order = new Map<string, number>(
      pp.epics.map((e: Any, i: number) => [`${e.key} ${e.title}`, i] as [string, number]),
    );
    rr.folders.sort((a: Any, b: Any) => (order.get(a.name) ?? 1e6) - (order.get(b.name) ?? 1e6));
  });
  return moved;
}

export const sortIntoEpicFolders = () =>
  openModal(
    <Confirm
      title="Sort tests into epic folders?"
      label="Sort into epic folders"
      text="Each test moves to a folder named after its epic (created when missing). Tests with no issue or no epic go to “No epic”. Other folders stay, possibly empty."
      onYes={() => {
        const moved = moveIntoEpicFolders();
        toast(`${moved} test${moved === 1 ? '' : 's'} moved into epic folders.`, 'ok', {
          title: 'Repository organized',
        });
      }}
    />,
  );
