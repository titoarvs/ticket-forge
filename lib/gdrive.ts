// Google Drive storage (Administration → Google Drive, behind the "gdrive" feature flag). The owner
// (Super Admin) connects one Google account for the workspace with OAuth and picks one folder.
// Generated and uploaded project documents then go to that folder instead of TicketForge storage. A
// save that fails (Drive down, token expired and not refreshable…) is queued in drive_docs and
// retried in the background with exponential backoff, up to MAX_RETRIES retries; after that the
// document is "failed" and nothing retries it again. Tokens are encrypted in app_meta, which only
// the server can read.
// TicketForge never browses Drive: it only opens the folder that was picked and adds files to it.

export {
  status,
  authorizeUrl,
  completeConnect,
  parseFolderId,
  selectFolder,
  listFolder,
  disconnect,
  destination,
} from './gdrive/complete-connect';
export {
  saveDocument,
  markFailed,
  documentStates,
  retryDue,
  startWorker,
} from './gdrive/save-document';
