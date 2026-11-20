import { api, authed, body, HttpError } from '@/lib/server/http';
import { answer, announcement } from '@/lib/chatbot';
import { releaseNotes } from '@/lib/release-notes';

// The help chatbot (rule-based, no AI). Every signed-in user can use it; ticket data is limited by
// their role in lib/chatbot.ts.
// GET: the release announcement for the robot ({ announcement: null } while the flag
// RELEASE_ANNOUNCEMENT is off).
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

// POST { message }: the chatbot's reply, { reply, kind: 'faq' | 'data' | 'denied' | 'unknown' }.
export const POST = api(async (req) => {
  const user = await authed();
  const b = await body(req);
  if (typeof b.message !== 'string' || !b.message.trim())
    throw new HttpError(400, 'Type a question first.');
  return answer(user, b.message);
});
