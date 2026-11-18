import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'TicketForge · From requirements to a tested backlog and working code',
  description: 'Turn requirement documents into epics, issues, acceptance criteria and test cases, then let AI agents write the code, review it and run the tests.',
};

const FEATURES: [string, string, string][] = [
  ['📄', 'Backlog from your documents', 'Upload a PDF, Word file or notes. TicketForge drafts epics, user stories, acceptance criteria and story points, and asks you what is unclear.'],
  ['🧭', 'Plan like you do in Jira', 'Backlog with sprints, a board with your own workflow, a timeline of epics, releases and reports, all in one place.'],
  ['✅', 'Test cases and automation', 'Every issue gets test cases. Run them as Playwright tests in a real browser, here or on GitHub Actions, with self-healing scripts.'],
  ['🤖', 'AI agents that write code', 'Agents build an issue in its own branch, follow your repository’s patterns, run your checks, then open a pull request for review.'],
  ['📝', 'Documents on demand', 'Kick Off, Demo, Sign-Off and other epic documents written by agents from your epics and their issues.'],
  ['🔍', 'Reviews you can trust', 'AI code review panels, CodeRabbit findings turned into bugs, and acceptance criteria checked against every change.'],
];
const STEPS: [string, string][] = [
  ['Bring your requirements', 'Drop in a document, or start a blank project and write issues with AI.'],
  ['Shape the backlog', 'Review the epics and issues, answer the AI’s questions, plan sprints and releases.'],
  ['Build and verify', 'Let agents write the code and tests, review the diff, and ship through your pull requests.'],
];

export default function Landing() {
  return (
    <>
      <section className="mk-hero">
        <p className="mk-eyebrow">AI-powered delivery for product teams</p>
        <h1>From requirement documents to a tested backlog, and working code.</h1>
        <p className="mk-lead">TicketForge turns your documents into epics, issues, acceptance criteria and test cases, then puts AI agents to work writing the code, reviewing it and running the tests. You stay in control of every change.</p>
        <div className="mk-ctas">
          <Link href="/signup" className="btn primary lg">Start free</Link>
          <Link href="/login" className="btn lg">Sign in</Link>
        </div>
        <p className="mk-fine">Free plan available · No credit card needed to start</p>
        <div className="mk-shot" aria-hidden>
          <div className="mk-shot-bar"><i /><i /><i /><span>Backlog · Payroll v2</span></div>
          <div className="mk-shot-body">
            {[['PAY-12', 'Employee can download a payslip as PDF', 'In progress', 'b'], ['PAY-13', 'Approver sees pending salary proposals', 'To do', 'n'], ['PAY-14', '13th-month pay is computed on final pay', 'Review', 'p'], ['PAY-15', 'Statutory deductions follow the 2026 tables', 'Done', 'g']].map(([k, t, s, c]) => (
              <div key={k} className="mk-row"><code>{k}</code><span>{t}</span><em className={`mk-pill ${c}`}>{s}</em></div>))}
            <div className="mk-agent"><b>🛠️ Build agent</b> wrote 4 files on <code>tf/pay-12-payslip-pdf</code> · tests pass · ready for review</div>
          </div>
        </div>
      </section>

      <section id="features" className="mk-sec">
        <h2>Everything from the first document to the merged pull request</h2>
        <div className="mk-grid">{FEATURES.map(([icon, title, text]) => (
          <article key={title} className="mk-card"><span className="mk-ic" aria-hidden>{icon}</span><h3>{title}</h3><p>{text}</p></article>))}</div>
      </section>

      <section id="how" className="mk-sec">
        <h2>How it works</h2>
        <ol className="mk-steps">{STEPS.map(([t, d], i) => <li key={t}><span className="mk-num">{i + 1}</span><div><h3>{t}</h3><p>{d}</p></div></li>)}</ol>
      </section>

      <section className="mk-sec mk-trust">
        <div><h2>Your workspace, your data</h2>
          <p>Every company gets its own isolated workspace. Keys and tokens are encrypted, AI runs on the providers you choose (or each person’s own Claude subscription), and code changes only reach your repository through pull requests you approve.</p>
          <p className="small"><Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Use</Link></p></div>
      </section>

      <section className="mk-final">
        <h2>Ready to turn your next requirements document into a plan?</h2>
        <Link href="/signup" className="btn primary lg">Create your workspace</Link>
      </section>
    </>
  );
}
