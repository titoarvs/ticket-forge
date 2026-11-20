'use client';
// Test management: how the AI writes repository tests and builds test plans. Start from a corporate
// standard, then change any field to match the company's.
import { TF, TA, SF, MenuItem } from '../../fields';
import { TM_STANDARDS } from '../tm-presets';
import type { Rules } from './use-rules';
import { NumField, CheckField, RuleLabel } from './rule-fields';

function StandardPicker({ g }: { g: Rules }) {
  const cur = g.r.testmgmt.standard;
  return (
    <div className="tm-std" role="radiogroup" aria-label="Corporate standard">
      {TM_STANDARDS.map(([k, l, dsc]) => (
        <button
          key={k}
          role="radio"
          aria-checked={cur === k}
          className={cur === k ? 'on' : ''}
          onClick={() => g.pickStandard(k)}
        >
          <b>{l}</b>
          <span className="muted small">{dsc}</span>
        </button>
      ))}
    </div>
  );
}

/** Format, title pattern, tests per issue, steps (step tables) or Gherkin style, labels. */
function FormatFields({ g }: { g: Rules }) {
  const tm = g.r.testmgmt;
  return (
    <div className="gen-grid two" style={{ marginTop: 12 }}>
      <label className="field">
        <RuleLabel g={g} path="testmgmt.format">
          Test format
        </RuleLabel>
        <SF value={tm.format} onChange={(e) => g.setTm('format', e.target.value)}>
          <MenuItem value="steps">Step tables (action · data · expected)</MenuItem>
          <MenuItem value="gherkin">Gherkin scenarios (BDD)</MenuItem>
          <MenuItem value="both">Both: Gherkin for user behaviour, steps for the rest</MenuItem>
        </SF>
      </label>
      <label className="field">
        <RuleLabel g={g} path="testmgmt.titleFormat">
          Title pattern
        </RuleLabel>
        <TF
          value={tm.titleFormat}
          placeholder="e.g. Verify <behaviour> when <condition>"
          onChange={(e) => g.setTm('titleFormat', e.target.value)}
        />
      </label>
      <NumField g={g} path="testmgmt.perIssue" label="Tests per issue" min={1} max={20} />
      {tm.format !== 'gherkin' && (
        <div className="row" style={{ gap: 8 }}>
          <NumField g={g} path="testmgmt.stepsMin" label="Steps: at least" min={1} max={30} />
          <NumField g={g} path="testmgmt.stepsMax" label="at most" min={1} max={40} />
        </div>
      )}
      {tm.format !== 'steps' && (
        <label className="field">
          <RuleLabel g={g} path="testmgmt.gherkinStyle">
            Gherkin style
          </RuleLabel>
          <SF value={tm.gherkinStyle} onChange={(e) => g.setTm('gherkinStyle', e.target.value)}>
            <MenuItem value="declarative">Declarative: business language</MenuItem>
            <MenuItem value="imperative">Imperative: UI actions</MenuItem>
          </SF>
        </label>
      )}
      <label className="field">
        <RuleLabel g={g} path="testmgmt.labels">
          Labels allowed
        </RuleLabel>
        <TF
          value={tm.labels}
          placeholder="e.g. smoke, regression, security"
          onChange={(e) => g.setTm('labels', e.target.value)}
        />
      </label>
    </div>
  );
}

function TextRules({ g }: { g: Rules }) {
  const tm = g.r.testmgmt;
  return (
    <>
      <div className="gen-grid two">
        <label className="field">
          <RuleLabel g={g} path="testmgmt.priorityRule">
            Priority rule
          </RuleLabel>
          <TA
            rows={2}
            value={tm.priorityRule}
            onChange={(e) => g.setTm('priorityRule', e.target.value)}
          />
        </label>
        <label className="field">
          <RuleLabel g={g} path="testmgmt.planRules">
            Test plan rules
          </RuleLabel>
          <TA
            rows={2}
            value={tm.planRules}
            placeholder="e.g. Smoke ≤ 15 tests; regression includes every High-priority test"
            onChange={(e) => g.setTm('planRules', e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>Company test standard (anything else)</span>
        <TA
          rows={3}
          value={tm.custom}
          placeholder={
            'e.g. Every test names the role it runs as. Amounts use PHP with two decimals. Payroll tests use the QA-Payroll company. Never test against production data.'
          }
          onChange={(e) => g.setTm('custom', e.target.value)}
        />
      </label>
    </>
  );
}

export function TestMgmtSection({ g }: { g: Rules }) {
  const steps = g.r.testmgmt.format !== 'gherkin';
  return (
    <div className="cards">
      <div className="card wide">
        <h3>Test management</h3>
        <p className="sub">
          How the AI writes repository tests and builds test plans (Test management). Start from a
          corporate standard, then change any field to match your company’s.
        </p>
        <StandardPicker g={g} />
        <FormatFields g={g} />
        <div className="gen-checks">
          {steps && (
            <CheckField
              g={g}
              path="testmgmt.expectedEveryStep"
              label="An expected result on every step"
            />
          )}
          {steps && (
            <CheckField
              g={g}
              path="testmgmt.testData"
              label="Test data in its own column, never inside the action"
            />
          )}
          <CheckField g={g} path="testmgmt.preconditions" label="Preconditions on every test" />
        </div>
        <TextRules g={g} />
      </div>
    </div>
  );
}
