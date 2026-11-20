// The words Ticket Forge AI is given: its role and rules (the system prompt) and the conversation
// so far with the new message (the prompt). When the person asks for an issue, the model ends its
// reply with a [[DRAFT: …]] line; the app then writes the draft (lib/assistant/turn.ts).
import { DRAFT_MARK } from './reply';

type Turn = { role: string; content: string; draft?: any };

const ROLE = `You are Ticket Forge AI, the assistant inside TicketForge, an app that turns requirements into epics, issues, acceptance criteria and test cases, with a board, backlog, tests and code tools.
Answer in short, friendly, plain English. Use Markdown: short paragraphs, bullet lists, **bold** for issue keys and names. Keep answers under 200 words unless asked for more.
Use only the facts below about the app and the person's data. Never invent issue keys, names or numbers; if you don't know, say so and say where in the app to look.`;

const DRAFT_ON = `Drafting issues: when the person asks you to create, add, write or draft an issue, story, bug or task (or to change the draft you made), reply with one short sentence, then on its own last line write ${DRAFT_MARK}: <one line with everything they asked for>]]. The app then writes the draft for them to check and create. Never write the issue's fields yourself.`;

const DRAFT_OFF = `Issues can only be drafted inside a project. If the person asks for one, tell them to open the project first and ask again there.`;

type Context = { guide: string; person: string; project?: string; facts?: string };

export function systemPrompt({ guide, person, project, facts }: Context) {
  return [
    ROLE,
    project ? DRAFT_ON : DRAFT_OFF,
    `How TicketForge works:\n${guide}`,
    person,
    project || 'No project is open: the person is on a page outside projects.',
    facts && `Live data for this question:\n${facts}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const said = (t: Turn) => {
  const who = t.role === 'user' ? 'Person' : 'You';
  const draft = t.draft?.title ? ` (you drafted the issue “${t.draft.title}”)` : '';
  return `${who}: ${String(t.content || '').slice(0, 1500)}${draft}`;
};

/** The conversation so far and the new message, as one prompt. */
export function chatPrompt(past: Turn[], message: string) {
  const earlier = past.length ? `The conversation so far:\n${past.map(said).join('\n')}\n\n` : '';
  return `${earlier}The person's new message:\n${message}`;
}
