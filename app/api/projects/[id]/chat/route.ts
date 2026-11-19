import { api, authed, body, aiOpts } from '@/lib/server/http';
import { chatHistory, sendChatMessage } from '@/lib/chat';

// The project's AI chatbot. GET: this person's saved messages in this project (nobody else's). POST
// { message }: the assistant answers with a draft issue for the preview (nothing is written to
// issues). The AI call is recorded in ai_usage and stopped by the plan's AI limit (402 with a limit
// notice).
export const GET = api(async (_req, p) => {
  const user = await authed();
  return chatHistory(p.id, user);
});

export const POST = api(async (req, p) => {
  const user = await authed();
  const b = await body(req);
  return sendChatMessage(p.id, user, { message: b.message, ai: aiOpts(b) });
});
