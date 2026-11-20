import { api, authed } from '@/lib/server/http';
import { chatHistory, clearChat } from '@/lib/chat';

// This person's Ticket Forge AI conversation in this project (nobody else's). GET: the saved
// messages, oldest first. DELETE: start over (their messages in this project are deleted). New
// messages go to POST /api/chatbot with the project's id.
export const GET = api(async (_req, p) => {
  const user = await authed();
  return chatHistory(p.id, user);
});

export const DELETE = api(async (_req, p) => {
  const user = await authed();
  return clearChat(p.id, user);
});
