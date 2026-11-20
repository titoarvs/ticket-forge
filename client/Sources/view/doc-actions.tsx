'use client';
// What you can do with a source document: download its text, rename or remove it, and attach the
// original PDF or Word file.
import {
  type Any,
  S,
  emit,
  openModal,
  keepsOriginal,
  toast,
  uploadOriginal,
  mutate,
  api,
  closeModal,
} from '../../core';
import { Modal, Confirm } from '../../ui';
import { TF } from '../../fields';

/** The document's text as a Markdown file named after it. */
export function downloadText(sel: Any) {
  const name =
    sel.name
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^\w\- ]+/g, '')
      .trim() || 'document';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([sel.text], { type: 'text/markdown' }));
  a.download = `${name}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function renameDoc(sel: Any) {
  let v = sel.name;
  const save = () => {
    if (v.trim())
      mutate((pp) => {
        const d = pp.sources.find((x: Any) => x.id === sel.id);
        if (d) d.name = v.trim();
      });
    closeModal();
  };
  openModal(
    <Modal
      title="Rename document"
      actions={[{ label: 'Cancel' }, { label: 'Rename', kind: 'primary', onClick: save }]}
    >
      <label className="field">
        <span>Name</span>
        <TF
          autoFocus
          defaultValue={sel.name}
          onChange={(e) => {
            v = e.target.value;
          }}
        />
      </label>
    </Modal>,
  );
}

/** Removes the document (not the issues it produced); ⌘Z brings it back. */
export function removeDoc(sel: Any, issueCount: number) {
  const kept = issueCount
    ? ` The ${issueCount} issue${issueCount === 1 ? '' : 's'} it produced stay.`
    : '';
  openModal(
    <Confirm
      title={`Remove “${sel.name}”?`}
      label="Remove"
      text={`The document is removed from this project.${kept} You can undo with ⌘Z.`}
      onYes={() => {
        mutate((pp) => {
          pp.sources = (pp.sources || []).filter((x: Any) => x.id !== sel.id);
        });
        S.sourceDoc = null;
        emit();
      }}
    />,
  );
}

/**
 * Attaches (or replaces) the original file of a document; the replaced file is deleted. Only PDF
 * and Word documents are accepted.
 */
export async function attachOriginal(projectId: string, sel: Any, file: File) {
  if (!keepsOriginal(file)) {
    toast('Attach a PDF or Word (.docx) file.', 'err');
    return;
  }
  try {
    const meta = await uploadOriginal(projectId, file);
    const old = sel.file?.id;
    mutate((pp) => {
      if (sel.id === 'original') pp.sourceFile = meta;
      else {
        const d = (pp.sources || []).find((x: Any) => x.id === sel.id);
        if (d) d.file = meta;
      }
    });
    if (old) api(`/api/files/${old}`, { method: 'DELETE' }).catch(() => {});
    toast(`Attached “${meta.name}”`);
  } catch (e: Any) {
    toast(e.message, 'err');
  }
}
