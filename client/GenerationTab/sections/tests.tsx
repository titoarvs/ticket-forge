'use client';
// Test cases on issues, and the Playwright automation scripts written for them.
import { TF } from '../../fields';
import type { Rules } from './use-rules';
import { NumField, CheckField, RuleLabel } from './rule-fields';

const subtle = { fontWeight: 600, color: 'var(--text-subtle)' };

function TestCasesCard({ g }: { g: Rules }) {
  return (
    <div className="card">
      <h3>Test cases</h3>
      <div className="gen-grid two">
        <NumField g={g} path="tests.perTicket" label="Test cases per ticket" min={1} max={15} />
        <NumField g={g} path="tests.maxSteps" label="Steps: at most" min={2} max={30} />
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <RuleLabel g={g} path="tests.titlePrefix">
            Titles start with
          </RuleLabel>
          <TF
            value={g.r.tests.titlePrefix}
            placeholder="e.g. Verify (leave empty for no rule)"
            onChange={(e) => g.set('tests.titlePrefix', e.target.value)}
          />
        </label>
      </div>
      <div className="gen-checks">
        <span className="small" style={subtle}>
          Always include
        </span>
        <CheckField g={g} path="tests.positive" label="A positive (happy path) test" />
        <CheckField
          g={g}
          path="tests.negative"
          label="A negative test (invalid input, not allowed)"
        />
        <CheckField g={g} path="tests.edge" label="An edge case" />
        <CheckField g={g} path="tests.preconditions" label="Fill in preconditions on every test" />
      </div>
    </div>
  );
}

function AutomationCard({ g }: { g: Rules }) {
  return (
    <div className="card">
      <h3>Automation scripts</h3>
      <div className="gen-checks">
        <CheckField
          g={g}
          path="automation.roleLocators"
          label="Prefer user-facing locators (role, label, text) over CSS"
        />
        <CheckField
          g={g}
          path="automation.noHardWaits"
          label="No fixed waits; rely on assertions"
        />
        <CheckField
          g={g}
          path="automation.oneFlow"
          label="Script only the flow the test case describes"
        />
      </div>
      <label className="field" style={{ marginTop: 8 }}>
        <RuleLabel g={g} path="automation.testDataPrefix">
          Prefix for test data the scripts create
        </RuleLabel>
        <TF
          value={g.r.automation.testDataPrefix}
          placeholder="e.g. QA (leave empty for none)"
          onChange={(e) => g.set('automation.testDataPrefix', e.target.value)}
        />
      </label>
    </div>
  );
}

export function TestsSection({ g }: { g: Rules }) {
  return (
    <div className="cards">
      <TestCasesCard g={g} />
      <AutomationCard g={g} />
    </div>
  );
}
