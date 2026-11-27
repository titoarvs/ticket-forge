'use client';
// Opening the code of an issue: whether "Write code with AI" is available, the Write code modal,
// and Code Jobs in a new tab.
import { type Any, P, S, feat, openModal, closeModal } from '../core';
import { codePageHref } from './CodePage';
import { myPath } from './FolderPicker';
import { dev } from './dev';
import { CodeModal } from './CodeModal';

/** Whether "Write code with AI" can be offered for issues in this project. */
export const codeReady = () => feat('code') && Boolean(myPath('frontend') || dev().repo);

/** Opens the issue's Code job page (start, watch, review); a modal when there's no router yet. */
export const openCode = (t: Any, side?: string) => {
  const href = codePageHref(P().id, t.id, side);
  if (S.nav) {
    closeModal();
    S.nav(href);
  } else openModal(<CodeModal t={t} initialSide={side} />);
};

/**
 * "Write code" on an issue or an epic's issue (TF-124): Code Jobs in a new tab with the issue; this
 * tab stays as it is. The page loads the prompt and the linked repository or spec itself.
 */
export const openWriteCode = (t: Any) => {
  const url = `/code-jobs?project=${encodeURIComponent(P().id)}&ticket=${encodeURIComponent(t.id)}`;
  window.open(url, '_blank', 'noopener');
};
