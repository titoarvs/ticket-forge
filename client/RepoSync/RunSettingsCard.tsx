'use client';
import { P, can, type Any, mutate, newTicket, logEvent, newTest } from '../core';
import { TF, SF, MenuItem, CB } from '../fields';
import { doneStatus } from './RepoSyncCard';

// ---------------------------------------------------------------- Playwright run settings (Test
// automation → Settings)
const RUN_DEFAULTS = {
  retries: 1,
  testTimeoutSec: 90,
  actionTimeoutSec: 15,
  navTimeoutSec: 30,
  expectTimeoutSec: 10,
  device: 'desktop',
  locale: 'en-PH',
  timezoneId: 'Asia/Manila',
  ignoreHttpsErrors: false,
  reducedMotion: true,
};
const DEVICES: [string, string][] = [
  ['desktop', 'Desktop · 1440×900'],
  ['laptop', 'Laptop · 1280×800'],
  ['tablet', 'Tablet · 820×1180, touch'],
  ['mobile', 'Phone · 390×844, touch'],
];
export function RunSettingsCard() {
  const p = P();
  const ed = can('project.settings');
  const rs = { ...RUN_DEFAULTS, ...(p.automation?.app?.run || {}) };
  const set = (k: string, v: Any) =>
    mutate(
      (pp: Any) => {
        pp.automation.app = {
          pages: [],
          roles: [],
          login: {},
          notes: '',
          ...(pp.automation.app || {}),
        };
        pp.automation.app.run = { ...RUN_DEFAULTS, ...(pp.automation.app.run || {}), [k]: v };
      },
      { tag: `run.${k}` },
    );
  const numF = (k: string, label: string, help: string, min: number, max: number) => (
    <label className="field">
      <span>{label}</span>
      <TF
        type="number"
        disabled={!ed}
        value={(rs as Any)[k]}
        slotProps={{ htmlInput: { min, max } }}
        onChange={(e) => set(k, Math.min(max, Math.max(min, Number(e.target.value) || min)))}
      />
      <small className="muted">{help}</small>
    </label>
  );
  const isDefault =
    JSON.stringify({ ...RUN_DEFAULTS, ...(p.automation?.app?.run || {}) }) ===
    JSON.stringify(RUN_DEFAULTS);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Run settings</h3>
        {ed && !isDefault && (
          <button
            className="link-btn small"
            style={{ marginLeft: 'auto' }}
            onClick={() =>
              mutate((pp: Any) => {
                if (pp.automation.app) delete pp.automation.app.run;
              })
            }
          >
            Reset to defaults
          </button>
        )}
      </div>
      <p className="sub">
        How Playwright runs each test. Retries catch one-off network hiccups; a test that only
        passes on a retry is marked <b>flaky</b>.
      </p>
      <div className="grid3">
        <label className="field">
          <span>Retries when a test fails</span>
          <SF
            disabled={!ed}
            value={rs.retries}
            onChange={(e) => set('retries', Number(e.target.value))}
          >
            {[0, 1, 2, 3].map((x) => (
              <MenuItem key={x} value={x}>
                {x === 0 ? 'No retries' : `${x} retr${x === 1 ? 'y' : 'ies'}`}
              </MenuItem>
            ))}
          </SF>
          <small className="muted">Each retry starts a fresh browser.</small>
        </label>
        {numF(
          'testTimeoutSec',
          'Time limit per test (s)',
          'The whole script, sign-in included.',
          15,
          600,
        )}
        <label className="field">
          <span>Screen</span>
          <SF disabled={!ed} value={rs.device} onChange={(e) => set('device', e.target.value)}>
            {DEVICES.map(([k, l]) => (
              <MenuItem key={k} value={k}>
                {l}
              </MenuItem>
            ))}
          </SF>
          <small className="muted">Phone and tablet also turn on touch.</small>
        </label>
        {numF(
          'actionTimeoutSec',
          'Wait for a click or fill (s)',
          'How long to wait for an element.',
          2,
          120,
        )}
        {numF(
          'navTimeoutSec',
          'Wait for a page to load (s)',
          'Slow staging servers need more.',
          5,
          180,
        )}
        {numF(
          'expectTimeoutSec',
          'Wait for a check to pass (s)',
          'For expect(…) assertions.',
          2,
          120,
        )}
        <label className="field">
          <span>Language (locale)</span>
          <TF
            disabled={!ed}
            value={rs.locale}
            placeholder="en-PH"
            onChange={(e) => set('locale', e.target.value.trim())}
          />
          <small className="muted">Dates and numbers format like this.</small>
        </label>
        <label className="field">
          <span>Time zone</span>
          <TF
            disabled={!ed}
            value={rs.timezoneId}
            placeholder="Asia/Manila"
            onChange={(e) => set('timezoneId', e.target.value.trim())}
          />
          <small className="muted">Cut-offs and dates use this zone.</small>
        </label>
        <div className="field">
          <span>Browser</span>
          <CB
            disabled={!ed}
            label="Accept self-signed HTTPS certificates"
            checked={Boolean(rs.ignoreHttpsErrors)}
            onChange={(e: Any) => set('ignoreHttpsErrors', e.target.checked)}
          />
          <CB
            disabled={!ed}
            label="Reduce animations (steadier runs)"
            checked={rs.reducedMotion !== false}
            onChange={(e: Any) => set('reducedMotion', e.target.checked)}
          />
        </div>
      </div>
    </div>
  );
}
// ---------------------------------------------------------------- test cases for the existing
// pages (from their code)
/**
 * Adds reviewed page test cases to their issues; pages with no issue get a new one, Done (delivered
 * work).
 */
export function applyPageTests(pages: Any[], picked: (pageIdx: number, tcIdx: number) => boolean) {
  const done = doneStatus();
  let added = 0,
    created = 0;
  const touched = new Set<string>();
  mutate((pp: Any) => {
    const roleId = (name?: string) =>
      (pp.automation?.app?.roles || []).find((r: Any) => r.name === name)?.id;
    const newByTitle = new Map<string, Any>();
    pages.forEach((pg: Any, pi: number) => {
      const tcs = pg.testCases.filter((_: Any, ti: number) => picked(pi, ti));
      if (!tcs.length) return;
      let t = pg.ticketId ? pp.tickets.find((x: Any) => x.id === pg.ticketId) : null;
      if (!t && pg.newIssue) {
        t = newByTitle.get(pg.newIssue.title);
        if (!t) {
          t = newTicket({
            title: pg.newIssue.title,
            type: 'Story',
            epicId: pg.newIssue.epicId,
            userStory: pg.newIssue.userStory,
            acceptanceCriteria: pg.newIssue.acceptanceCriteria,
            status: done,
            labels: ['delivered', 'from-code'],
            description: `Already built. Page: ${pg.path}\nCode: ${pg.files.slice(0, 6).join(', ')}`,
          });
          logEvent(t, 'added from the code: an existing page with no issue', 'Repository sync');
          pp.tickets.push(t);
          newByTitle.set(pg.newIssue.title, t);
          created++;
        }
      }
      if (!t) return;
      for (const tc of tcs) {
        const { runAsName, ...rest } = tc;
        t.testCases.push({
          ...newTest(),
          ...rest,
          ...(roleId(runAsName) ? { roleId: roleId(runAsName) } : {}),
        });
        added++;
      }
      logEvent(
        t,
        `added ${tcs.length} test case${tcs.length > 1 ? 's' : ''} written from the code of ${pg.path}`,
        'Repository sync',
      );
      touched.add(t.key);
    });
  });
  return { added, created, issues: touched.size };
}
