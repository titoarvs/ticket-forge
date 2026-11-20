'use client';

// Brain: the project's knowledge vault (lib/brain.ts). Linked Markdown notes about everything
// TicketForge knows (the project, epics, issues, decisions, open questions, releases, documents,
// the app context and the repository profile), kept up to date from the project, plus the team's
// own notes. AI actions and code agents read the notes linked to their task first. Opens in
// Obsidian (download the vault), imports Obsidian notes, and on this computer syncs with a folder.
// A list with search and filters, the note (Markdown with [[wikilinks]], backlinks), and a graph of
// the links.

export { Brain } from './Brain/Brain';
