'use client';
// Administration → Local folders: every person's folder per GitHub repository on this machine, with Purge.
import { useEffect, useState } from 'react';
import { toast } from './core';
import { listLocalFolders, purgeLocalFolder } from './api/admin';

export function LocalFolders() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    listLocalFolders()
      .then(setRows)
      .catch((e: any) => setError(e.message));
  };
  useEffect(load, []);
  const purge = async (f: any) => {
    if (!window.confirm(`Purge ${f.userName || f.userId}'s folder for ${f.repo}? Its clone and settings are deleted for good.`)) return;
    try {
      await purgeLocalFolder(f.id);
      toast('Folder purged');
      load();
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };
  if (error)
    return (
      <div className="empty">
        <p>{error}</p>
        <button className="btn" onClick={load}>
          Try again
        </button>
      </div>
    );
  if (!rows) return <div className="empty">Loading…</div>;
  if (!rows.length) return <div className="empty">No local folders yet. One is created when someone connects a repository.</div>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>User</th>
          <th>Repository</th>
          <th>Folder</th>
          <th>Created</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id}>
            <td>
              {f.userName || f.userId}
              {f.email ? ` (${f.email})` : ''}
            </td>
            <td>{f.repo}</td>
            <td>
              <code>{f.path}</code>
            </td>
            <td>{f.createdAt ? new Date(f.createdAt).toLocaleString() : ''}</td>
            <td>
              <button className="btn danger" onClick={() => purge(f)}>
                Purge
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
