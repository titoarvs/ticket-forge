'use client';
// Generation options: project key, issue size, test cases (and how many per issue), and extra
// instructions. They are remembered in this browser (except the key).
import { S, type Any, store, emit } from '../../core';
import { TA, TF, SF, MenuItem, CB } from '../../fields';
import { setGenOpt } from './generate';

/** Back to the team's standard number of test cases (Administration → Generation). */
function resetToTeamStandard(e: React.MouseEvent) {
  e.preventDefault();
  S.genOpts = { ...S.genOpts, testsPerTicket: null, testsPicked: false };
  store.set('tf.genOpts', { ...S.genOpts, projectKey: '' });
  emit();
}

/** "(team standard)", or a link back to it once you picked another number. */
function StandardNote({ o, st }: { o: Any; st: Any }) {
  if (!st?.generation) return null;
  if (o.testsPicked && o.testsPerTicket !== st.generation.testsPerTicket)
    return (
      <>
        {' '}
        ·{' '}
        <a href="#" onClick={resetToTeamStandard}>
          use the team standard ({st.generation.testsPerTicket})
        </a>
      </>
    );
  return <>{' (team standard)'}</>;
}

function TestsPerIssue({ o, st }: { o: Any; st: Any }) {
  return (
    <label className="field">
      <span>
        Test cases per issue
        <StandardNote o={o} st={st} />
      </span>
      <TF
        type="number"
        min={1}
        max={15}
        value={o.testsPerTicket ?? st?.generation?.testsPerTicket ?? ''}
        onChange={(e) => {
          S.genOpts = { ...S.genOpts, testsPicked: true };
          setGenOpt('testsPerTicket', Number(e.target.value) || null);
        }}
      />
    </label>
  );
}

export function GenOptions() {
  const o = S.genOpts;
  const st = S.status;
  return (
    <>
      <div style={{ marginTop: 24 }} className="grid2">
        <label className="field">
          <span>Project key</span>
          <TF
            maxLength={8}
            placeholder="Auto, e.g. SHOP"
            value={o.projectKey}
            onChange={(e) =>
              setGenOpt('projectKey', e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())
            }
          />
        </label>
        <label className="field">
          <span>Issue size</span>
          <SF value={o.granularity} onChange={(e) => setGenOpt('granularity', e.target.value)}>
            <MenuItem value="coarse">Fewer, larger issues</MenuItem>
            <MenuItem value="balanced">Balanced</MenuItem>
            <MenuItem value="fine">Many small issues</MenuItem>
          </SF>
        </label>
        <label className="field">
          <span>Test cases</span>
          <label className="check" style={{ minHeight: 32 }}>
            <CB
              checked={o.includeTests}
              onChange={(e) => setGenOpt('includeTests', e.target.checked)}
            />{' '}
            Write test cases for every issue
          </label>
        </label>
        <TestsPerIssue o={o} st={st} />
      </div>
      <label className="field">
        <span>Extra instructions for this project (optional)</span>
        <TA
          value={o.instructions}
          onChange={(e) => setGenOpt('instructions', e.target.value)}
          placeholder="e.g. We use React + Node. Label issues frontend/backend. Add an epic for analytics."
        />
      </label>
    </>
  );
}
