import fs from 'node:fs';
import { healable, healScript } from '../healing';
import { maskSecrets } from '../app-helpers.mjs';
import { saveFailureShot } from '../shots';
import { describeBrowser, hideEndpoint } from '../browser.mjs';
import { runSettings } from '../run-one.mjs';
import { assertPublicTarget, browserSpec, snapshotApp } from './snapshot-app';
import { generateScripts, runScript } from './discover-pages';
import { runOnGitHub } from './follow-github-runs';

/**
 * Full run. items: [{ ticket, tc }] where ticket = { id, key, title, userStory, acceptanceCriteria
 * } and tc = { id, title, steps, expected, preconditions, script }. emit(event) streams progress.
 */
export async function runAutomation({
  items,
  baseUrl,
  regenerate,
  project,
  ai,
  emit,
  signal,
  app = {},
  user,
  notes = '',
  heal = false,
  github = null,
}: any) {
  if (!github) await assertPublicTarget(baseUrl);
  const spec = await browserSpec();
  const rs = runSettings(app.run);
  emit({
    type: 'phase',
    message: `${github ? `Runs on GitHub Actions (${github.repo} @ ${github.ref})` : `Test browser: ${describeBrowser(spec)}`} · ${rs.device}, ${rs.locale}, ${rs.timezoneId} · ${rs.testTimeoutSec}s per test${rs.retries ? `, ${rs.retries} retr${rs.retries === 1 ? 'y' : 'ies'}` : ''}`,
  });
  const needScripts = items.filter((it) => regenerate || !it.tc.script?.trim());
  if (needScripts.length) {
    const firstRole = needScripts
      .map((it) => (app.roles || []).find((r) => r.id === it.tc.roleId)?.name)
      .find(Boolean);
    emit({
      type: 'phase',
      message: `Opening ${baseUrl} to learn ${app.pages?.length ? `its ${app.pages.length > 6 ? 'first 6' : app.pages.length} page${app.pages.length > 1 ? 's' : ''}` : 'the page'}…`,
    });
    let snapshot = null;
    try {
      if (github && !spec) throw Object.assign(new Error('no local browser'), { noBrowser: true });
      snapshot = await snapshotApp({ baseUrl, app, role: firstRole });
    } catch (e) {
      // On GitHub Actions without a browser here: write the scripts from the steps and the App
      // setup (less exact).
      if (github) {
        snapshot = {
          title: '',
          path: '',
          url: baseUrl,
          elements:
            '(not available: this server has no browser; the tests run on GitHub Actions. Use role- and label-based locators from the test steps.)',
          text: '',
          notes: [],
        };
        emit({
          type: 'phase',
          level: 'warn',
          message: e.noBrowser
            ? 'No browser on this server to look at the app: the scripts are written from the test steps and App setup.'
            : `Couldn’t open ${baseUrl} here (${String(e.message || e)
                .split('\n')[0]
                .slice(0, 160)}); the scripts are written from the test steps and App setup.`,
        });
      } else {
        // Without a look at the app no scripts can be written: those tests fail with the reason;
        // the others still run.
        const why = `Could not open ${baseUrl} to write the scripts: ${hideEndpoint(maskSecrets(String(e.message || e).split('\n')[0], app), spec)}`;
        emit({ type: 'phase', level: 'err', message: why });
        for (const it of needScripts) it.noScriptReason = why;
      }
    }
    for (const n of snapshot?.notes || [])
      emit({ type: 'phase', level: /failed/.test(n) ? 'warn' : undefined, message: n });
    const byTicket: Map<any, any> = new Map();
    for (const it of needScripts) {
      if (!snapshot) break;
      if (!byTicket.has(it.ticket.id)) byTicket.set(it.ticket.id, { ticket: it.ticket, list: [] });
      byTicket.get(it.ticket.id).list.push(it);
    }
    const jobs = [...byTicket.values()];
    let done = 0;
    const worker = async () => {
      while (jobs.length && !signal?.aborted) {
        const { ticket, list } = jobs.shift();
        emit({
          type: 'phase',
          message: `AI is writing ${list.length} script${list.length > 1 ? 's' : ''} for ${ticket.key}…`,
        });
        try {
          const scripts = await generateScripts({
            ticket,
            tests: list.map((x) => x.tc),
            project,
            baseUrl,
            snapshot,
            app,
            notes,
            ai: {
              ...ai,
              signal,
              onSwitch: (message) => emit({ type: 'phase', level: 'warn', message }),
            },
          });
          for (const s of scripts) {
            const it = list[s.index];
            if (it && s.code) {
              it.tc.script = s.code;
              emit({ type: 'script', ticketId: ticket.id, tcId: it.tc.id, code: s.code });
            }
          }
        } catch (e) {
          if (signal?.aborted) return;
          emit({
            type: 'phase',
            level: 'warn',
            message: `Could not write scripts for ${ticket.key}: ${e.message}`,
          });
        }
        done += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
    void done;
  }
  if (github) return runOnGitHub({ items, baseUrl, project, emit, signal, app, user, rs, github });
  for (const it of items) {
    if (signal?.aborted) return;
    if (!it.tc.script?.trim()) {
      emit({
        type: 'result',
        ticketId: it.ticket.id,
        tcId: it.tc.id,
        result: {
          status: 'Fail',
          error:
            it.noScriptReason ||
            'No automation script: the AI couldn’t write one (see the run log).',
          durationMs: 0,
          at: new Date().toISOString(),
          logs: [],
        },
      });
      continue;
    }
    emit({ type: 'start', ticketId: it.ticket.id, tcId: it.tc.id });
    // Retries (Run settings): a test that passes on a later attempt is a pass, marked flaky so it
    // gets looked at.
    let result = await runScript({
      code: it.tc.script,
      baseUrl,
      tcId: it.tc.id,
      signal,
      app,
      browser: spec,
    });
    let attempt = 1;
    while (
      result.status !== 'Pass' &&
      attempt <= rs.retries &&
      !signal?.aborted &&
      !/No automation script/.test(result.error || '')
    ) {
      attempt++;
      emit({
        type: 'phase',
        level: 'warn',
        message: `${it.ticket.key}: “${String(it.tc.title || '').slice(0, 80)}” failed (${String(
          result.error || '',
        )
          .split('\n')[0]
          .slice(0, 120)}). Retrying (${attempt - 1} of ${rs.retries})…`,
      });
      if (result.localShot) fs.rm(result.localShot, { force: true }, () => {});
      result = await runScript({
        code: it.tc.script,
        baseUrl,
        tcId: it.tc.id,
        signal,
        app,
        browser: spec,
      });
    }
    result.attempts = attempt;
    // Self-healing Agent: a script that no longer matches the page is repaired and re-run once;
    // kept only if it passes.
    if (heal && healable(result) && !signal?.aborted) {
      emit({
        type: 'phase',
        message: `${it.ticket.key}: Self-healing agent is checking “${String(it.tc.title || '').slice(0, 70)}”…`,
      });
      try {
        const h = await healScript({
          ticket: it.ticket,
          tc: it.tc,
          result,
          baseUrl,
          project,
          ai: {
            ...ai,
            signal,
            onSwitch: (message) => emit({ type: 'phase', level: 'warn', message }),
          },
        });
        if (h.healable) {
          const again = await runScript({
            code: h.code,
            baseUrl,
            tcId: it.tc.id,
            signal,
            app,
            browser: spec,
          });
          if (again.status === 'Pass') {
            if (result.localShot) fs.rm(result.localShot, { force: true }, () => {});
            again.healed = {
              reason: h.reason,
              previous: it.tc.script,
              at: new Date().toISOString(),
              error: String(result.error || '')
                .split('\n')[0]
                .slice(0, 300),
            };
            again.attempts = attempt + 1;
            it.tc.script = h.code;
            emit({
              type: 'script',
              ticketId: it.ticket.id,
              tcId: it.tc.id,
              code: h.code,
              healed: true,
            });
            emit({
              type: 'phase',
              level: 'pass',
              message: `${it.ticket.key}: self-healed and passed (${h.reason})`,
            });
            result = again;
          } else {
            if (again.localShot) fs.rm(again.localShot, { force: true }, () => {});
            result.healAttempt = { reason: h.reason, failed: true };
            emit({
              type: 'phase',
              level: 'warn',
              message: `${it.ticket.key}: the healed script still failed, so the original failure stands.`,
            });
          }
        } else {
          result.healAttempt = { reason: h.reason, notHealable: true };
          emit({
            type: 'phase',
            message: `${it.ticket.key}: not a script problem, left failing (${h.reason})`,
          });
        }
      } catch (e) {
        if (!signal?.aborted)
          emit({
            type: 'phase',
            level: 'warn',
            message: `Self-healing couldn’t check ${it.ticket.key}: ${e.message}`,
          });
      }
    }
    if (result.status === 'Pass' && attempt > 1) {
      result.flaky = true;
      emit({
        type: 'phase',
        level: 'warn',
        message: `${it.ticket.key}: passed on attempt ${attempt} — flaky, worth a look.`,
      });
    }
    // Failures: keep the screenshot in the database. Passes: nothing to keep.
    const local = result.localShot;
    delete result.localShot;
    if (result.status !== 'Pass' && project?.id && local) {
      try {
        result.screenshot = await saveFailureShot({
          file: local,
          projectId: project.id,
          issueId: it.ticket.id,
          tcId: it.tc.id,
          error: result.error,
          user,
        });
      } catch (e) {
        emit({
          type: 'phase',
          level: 'warn',
          message: `Couldn’t save the screenshot: ${e.message}`,
        });
      }
    } else if (result.status === 'Pass' && local) {
      fs.rm(local, { force: true }, () => {});
      result.screenshot = null;
    }
    if (signal?.aborted) return;
    emit({ type: 'result', ticketId: it.ticket.id, tcId: it.tc.id, result });
  }
}
