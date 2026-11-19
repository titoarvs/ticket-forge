'use client';
// Writing code with AI from an issue or a pull request: the entry points other screens use, and
// CodeRabbit's "fix with an agent". The parts are in open-code.tsx, update-pr/ and backend-repo/.
import { type Any, api, P, toast, aiBody, closeModal } from '../core';
import { setPrFixer } from '../CodeRabbit';
import { codeReady, openCode } from './open-code';

export { codeReady, openCode, openWriteCode } from './open-code';
export { openUpdatePr } from './update-pr/UpdatePrModal';
export { BackendRepoCard } from './backend-repo/BackendRepoCard';

// CodeRabbit findings on a pull request → an agent round on that request's branch (same as Update →
// What to change).
setPrFixer(async (t: Any, pr: Any, text: string) => {
  if (!codeReady()) {
    toast(
      'Writing code needs TicketForge on your computer with the local repository set (Project settings → Code & GitHub).',
      'err',
    );
    return;
  }
  try {
    const job = await api(`/api/projects/${P().id}/code`, {
      method: 'POST',
      body: aiBody({ action: 'update', ticketId: t.id, prId: pr.id, mode: 'prompt', prompt: text }),
    });
    closeModal();
    openCode(t, job.side);
  } catch (e: Any) {
    toast(e.message, 'err');
  }
});
