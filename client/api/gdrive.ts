// API client for the shared Google Drive: the only place the Google Drive setting's and the save
// state's requests are built.
import { api, type Any } from '../core';

/** The connection status, the connected account (Super Admin only) and the selected folder. */
export const getDriveStatus = (): Promise<Any> => api('/api/gdrive');
/** Starts connecting: the Google sign-in address to open. */
export const startDriveConnect = (): Promise<Any> => api('/api/gdrive/connect', { method: 'POST' });
/**
 * Makes a Drive folder (its link or id) the document destination. Refused until Google Drive is
 * connected.
 */
export const selectDriveFolder = (folder: string): Promise<Any> =>
  api('/api/gdrive/folder', { method: 'PUT', body: { folder } });
/** The latest files in the selected folder. */
export const listDriveFiles = (): Promise<Any> => api('/api/gdrive/files');
/** Disconnects Google Drive. */
export const disconnectDrive = (): Promise<Any> => api('/api/gdrive', { method: 'DELETE' });
/** The save state (saved, queued, failed) of each document of an epic. */
export const getDocumentStates = (pid: Any, epicId: string): Promise<Any> =>
  api(`/api/projects/${encodeURIComponent(pid)}/gdrive?epicId=${encodeURIComponent(epicId)}`);
