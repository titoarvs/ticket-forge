// Project brain: an Obsidian-compatible knowledge vault of Markdown notes linked with
// [[wikilinks]], so the AI (and the Claude Code agents) always start from the project's context.
// One note per thing TicketForge knows (the project, its epics, issues, releases, source documents,
// open questions, the app context and the repository profile), rebuilt automatically whenever the
// project changes. People add their own notes too; a refresh never touches those.
//
// Stored in the database (brain_notes, brain_state) per project, so the RLS policies of the
// project's workspace apply (lib/db.ts). Generated notes are deterministic: the same project gives
// the same notes, so a refresh only writes what changed and the AI context block stays the same
// text from one call to the next.

export { NOTE_TYPES, safeName } from './brain/safe-name';
export { buildNotes } from './brain/build-notes';
export { linksIn, refreshBrain, ensureBrain } from './brain/refresh-brain';
export {
  listNotes,
  getNote,
  searchNotes,
  saveNote,
  deleteNote,
  setSettings,
  brainContext,
} from './brain/brain-context';
export {
  brainBlock,
  brainPack,
  brainForCode,
  toMarkdown,
  parseMarkdown,
  exportZip,
  importNotes,
} from './brain/import-notes';
export { syncFolder, setSyncFolder } from './brain/sync-folder';
