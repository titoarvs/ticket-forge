// The guided tours shown to new people the first time they reach a page. Each step points at an element marked with
// data-tour="…"; steps whose element isn't on the page (a feature that's off, a button your role can't use) are
// skipped, so the tour only ever shows what this person can actually do.
export type TourId = 'home' | 'new' | 'project' | 'drawer';
export type TourStep = { target: string; title: string; text: string; perm?: string; position?: 'top' | 'right' | 'bottom' | 'left' | 'center' };

export const TOURS: Record<TourId, { name: string; steps: TourStep[] }> = {
  home: {
    name: 'Getting started',
    steps: [
      { target: 'home-create', title: 'Welcome to TicketForge 👋', text: 'Start with a project. Upload a requirements document and AI drafts the epics, issues, acceptance criteria and test cases, or start blank and write issues yourself.', perm: 'project.create' },
      { target: 'tn-search', title: 'Find anything', text: 'Search projects here, or issues once you are inside a project. Press ⌘K (Ctrl+K) from anywhere.' },
      { target: 'ai-pill', title: 'Your AI connection', text: 'Shows which AI answers your requests and whether it is ready. Click it to pick a faster or more thorough option for the next task.' },
      { target: 'bell', title: 'Notifications', text: 'Mentions, assignments and finished AI jobs land here.' },
      { target: 'account', title: 'You, your AI and this tour', text: 'Change your password, connect your own Claude subscription (My AI), switch to dark mode, read the Terms and Privacy Policy, or start this tour again.' },
    ],
  },
  new: {
    name: 'Create a project',
    steps: [
      { target: 'new-dropzone', position: 'bottom', title: 'Add your requirements', text: 'Drop a PDF, Word document, spreadsheet or plain text. You can also paste text instead.' },
      { target: 'new-generate', title: 'Generate the backlog', text: 'AI reads the document and drafts epics and issues. It asks you about anything unclear, and nothing is final until you review it.', perm: 'ai.use' },
    ],
  },
  project: {
    name: 'Your project',
    steps: [
      { target: 'sidebar', position: 'right', title: 'Everything in one project', text: 'Plan in the Backlog and Board, track Epics, Releases and the Timeline, manage Test cases and automation, and review Pull requests.' },
      { target: 'backlog-ai', title: 'Grow the backlog with AI', text: 'Describe a feature and AI plans the epics and issues, or have it write a single issue for you.', perm: 'ai.use' },
      { target: 'tn-create', title: 'Create an issue', text: 'Add an issue by hand at any time. Shortcut: press C.', perm: 'issue.create' },
      { target: 'tn-edit', title: 'Saved as you go', text: 'Changes save automatically. Undo and redo with ⌘Z and ⇧⌘Z, and export the project to Excel, Word, PDF or a Jira CSV.' },
    ],
  },
  drawer: {
    name: 'An issue',
    steps: [
      { target: 'drawer-enhance', title: 'Improve it with AI', text: 'Enhance rewrites the issue with clear acceptance criteria. More AI actions writes test cases, splits it into sub-tasks and more.', perm: 'ai.use' },
      { target: 'drawer-tests', title: 'Run its tests', text: 'Runs this issue’s test cases in a real browser and records the results with screenshots.', perm: 'test.run' },
      { target: 'composer', position: 'top', title: 'Talk it through', text: 'Comment and @mention teammates. They get a notification.' },
    ],
  },
};

/** Which tour belongs to the page you are on. */
export function tourForPath(pathname: string, drawerOpen = false): TourId {
  if (drawerOpen) return 'drawer';
  if (pathname.startsWith('/new')) return 'new';
  if (pathname.startsWith('/p/')) return 'project';
  return 'home';
}
