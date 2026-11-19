'use client';
// The test repository: a tree (by epic and issue, or by folder) beside the matching tests. The
// parts are in client/TestRepo/repository/.
import { useRepository } from './repository/use-repository';
import { Sidebar } from './repository/sidebar';
import { TestsList } from './repository/tests-table';

export function Repository() {
  const g = useRepository();
  return (
    <div className="xr-repo">
      <Sidebar g={g} />
      <TestsList g={g} />
    </div>
  );
}
