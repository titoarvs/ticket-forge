// One turn of Ticket Forge AI, the one chat of the app. The person's message, the conversation so
// far and what the assistant may know (lib/assistant/knowledge.ts) go to the AI, whose reply
// streams back as it is written. When the reply asks for a draft, the issue draft is written the
// same way as New issue (lib/chat.ts) and shown under the reply.
// Inside a project the turn is saved (the conversation is restored next time); outside projects the
// browser keeps the conversation and sends it with each message, and nothing is saved.
// No AI set up (503): the free rule-based helper answers instead. The plan's AI limit (402) stops
// the turn before anything is saved, like any other AI action.
import { askAI } from '../claude/ask-ai';
import { requireProject, getProject } from '../store';
import { checkMessage, recentMessages, writeDraft, saveTurn, draftReply } from '../chat';
import { appGuide, personBlock, projectBlock, liveFacts, basicAnswer } from './knowledge';
import { systemPrompt, chatPrompt } from './prompt';
import { visiblePart, draftRequest, replyStream } from './reply';

const PAST_MAX = 12;

export type TurnInput = {
  user: any;
  projectId?: string | null;
  message: any;
  /** Outside projects: the conversation so far, from the browser. */
  history?: any;
  ai?: any;
  signal?: AbortSignal;
  /** The reply's text as it is written. */
  onDelta?: (text: string) => void;
  /** 'drafting' while the issue draft is written; 'reset' when the reply starts over. */
  onStatus?: (status: string) => void;
  /** Tests stand in the AI calls. */
  ask?: (opts: any) => Promise<string>;
  write?: (a: any) => Promise<any>;
};

/** The browser's copy of the conversation, checked and shortened. */
function cleanHistory(history: any) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-PAST_MAX)
    .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 1500) }));
}

/** The model's reply text, or the rule-based answer when no AI is set up. */
async function reply(i: TurnInput, text: string, project: any, past: any[]) {
  const stream = replyStream((t) => i.onDelta?.(t));
  const system = systemPrompt({
    guide: appGuide(),
    person: personBlock(i.user),
    project: project ? projectBlock(project) : '',
    facts: await liveFacts(i.user, text),
  });
  try {
    return await (i.ask || askAI)({
      ...(i.ai || {}),
      task: 'chat',
      reasoning: 'fast',
      system,
      prompt: chatPrompt(past, text),
      signal: i.signal,
      onText: (_n: number, _total: number, chunk?: string) => chunk && stream.push(chunk),
      onSwitch: () => {
        stream.reset();
        i.onStatus?.('reset');
      },
    });
  } catch (e) {
    if (e?.status !== 503 || i.signal?.aborted) throw e;
    i.onStatus?.('reset');
    const basic = await basicAnswer(i.user, text);
    i.onDelta?.(basic);
    return basic;
  }
}

export async function chatTurn(i: TurnInput) {
  const text = checkMessage(i.message);
  const pid = i.projectId || null;
  if (pid) await requireProject(i.user, pid);
  const project = pid ? await getProject(pid) : null;
  const past = pid ? await recentMessages(pid, i.user, PAST_MAX) : cleanHistory(i.history);
  const raw = String((await reply(i, text, project, past)) || '');
  const wanted = project ? draftRequest(raw) : null;
  let draft = null;
  if (wanted !== null) {
    i.onStatus?.('drafting');
    draft = await writeDraft(project, i.user, wanted || text, i.ai, i.write);
  }
  const content = visiblePart(raw, true).trim() || (draft ? draftReply(draft) : '…');
  if (pid) return { messages: await saveTurn(pid, i.user, text, content, draft) };
  const now = new Date().toISOString();
  return {
    messages: [
      { id: `u${Date.now()}`, role: 'user', content: text, draft: null, createdAt: now },
      { id: `a${Date.now()}`, role: 'assistant', content, draft: null, createdAt: now },
    ],
  };
}
