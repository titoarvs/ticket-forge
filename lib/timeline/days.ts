// The product timeline: how TicketForge grew, day by day. Dates come from when each feature's code
// first appeared in the repository (7 to 15 November 2026). Add an entry at the top of its day when
// something new ships.
export type TlCat = 'planning' | 'ai' | 'code' | 'testing' | 'docs' | 'team' | 'platform';
export const CATS: Record<TlCat, { label: string; icon: string; color: string }> = {
  planning: { label: 'Planning', icon: '🧭', color: '#2f7bf5' },
  ai: { label: 'AI', icon: '✨', color: '#8b5cf6' },
  code: { label: 'Code & PRs', icon: '🛠️', color: '#1f9d6b' },
  testing: { label: 'Testing', icon: '✅', color: '#e2a400' },
  docs: { label: 'Documents', icon: '📄', color: '#e0526b' },
  team: { label: 'Teams & billing', icon: '👥', color: '#0ea5a4' },
  platform: { label: 'Platform', icon: '⚙️', color: '#7c8aa0' },
};
export type TlEntry = {
  id: string;
  date: string;
  title: string;
  text: string;
  cat: TlCat;
  details?: string[];
  tags?: string[];
};
export type TlDay = { date: string; title: string; blurb: string };
/** One heading per day, oldest first. */
export const DAYS: TlDay[] = [
  {
    date: '2026-11-07',
    title: 'Foundation',
    blurb: 'Documents in, backlog out: the core of TicketForge, with sign-in, storage and exports.',
  },
  {
    date: '2026-11-08',
    title: 'Planning tools',
    blurb: 'A board, a timeline, workflows and rules for how the AI should write.',
  },
  {
    date: '2026-11-09',
    title: 'Documents and the first coding agent',
    blurb: 'Word documents on demand, and Claude Code writing real changes on its own branch.',
  },
  {
    date: '2026-11-10',
    title: 'Agents',
    blurb: 'Specialist agents, questions before generating, and splitting big issues.',
  },
  {
    date: '2026-11-11',
    title: 'Control and coverage',
    blurb: 'Feature locks, model routing, pull requests and a proper test repository.',
  },
  {
    date: '2026-11-12',
    title: 'Context and polish',
    blurb: 'The AI learns each app, tests heal themselves, and releases and activity arrive.',
  },
  {
    date: '2026-11-13',
    title: 'Insight and integrations',
    blurb: 'Usage reports, CodeRabbit, GitHub Actions and ticket history.',
  },
  {
    date: '2026-11-14',
    title: 'Teams, billing and the project brain',
    blurb: 'From one company to many workspaces, plus code jobs that run anywhere.',
  },
  {
    date: '2026-11-15',
    title: 'Made for every screen',
    blurb: 'Responsive layouts, and this timeline.',
  },
];
