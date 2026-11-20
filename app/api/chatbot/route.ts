import { api, authed, body, aiOpts, ndjson } from '@/lib/server/http';
import { announcement } from '@/lib/chatbot';
import { releaseNotes } from '@/lib/release-notes';
import { requireProject } from '@/lib/store';
import { checkMessage } from '@/lib/chat';
import { chatTurn } from '@/lib/assistant/turn';

// Ticket Forge AI, the one chat of the app (lib/assistant/turn.ts). Every signed-in user can use
// it; what it knows is limited by their access and permissions.
// GET: the release announcement for the robot ({ announcement: null } while the flag
// RELEASE_ANNOUNCEMENT is off).
export const maxDuration = 300;

export const GET = api(async () => {
  await authed();
  const latest = releaseNotes()[0];
  const features = latest?.features.slice(0, 3).join(', ');
  return {
    announcement: announcement(
      latest ? `Ticket Forge v${latest.version} is out${features ? `: ${features}` : ''}.` : '',
    ),
  };
});

// POST { message, projectId?, history? }: the reply as a stream of JSON lines: { type: 'delta',
// text } while it is written, { type: 'status', status: 'drafting' | 'reset' }, then { type:
// 'done', messages } (the turn). Inside a project the turn is saved; outside, the browser sends
// the conversation so far as `history`.
export const POST = api(async (req) => {
  const user = await authed();
  const b = await body(req);
  checkMessage(b.message);
  const projectId = typeof b.projectId === 'string' && b.projectId ? b.projectId : null;
  if (projectId) await requireProject(user, projectId);
  const ai = aiOpts(b);
  return ndjson(req, async (send, signal) => {
    const out = await chatTurn({
      user,
      projectId,
      message: b.message,
      history: b.history,
      ai,
      signal,
      onDelta: (text) => send({ type: 'delta', text }),
      onStatus: (status) => send({ type: 'status', status }),
    });
    send({ type: 'done', ...out });
  });
});
