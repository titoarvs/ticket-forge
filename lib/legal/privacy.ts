// Privacy Policy: a template with [placeholders]. Have it reviewed by qualified counsel before use.
export const PRIVACY = `This Privacy Policy explains how [Company name] ("we", "us") collects and uses personal data when you use TicketForge (the "Service"). Contact: [Contact email], [Address], [Country]. [Data protection officer, if appointed: name and email.]

## 1. Our role
- For **account, billing and usage data** we are the *controller*.
- For **content your workspace puts into the Service** (projects, issues, documents, comments, files, test results), your organisation is the controller and we act as its *processor*, following its instructions. [Data processing agreement available on request.]

## 2. What we collect
- **Account data:** name, email address, password (stored as a salted hash, never in plain text), role, workspace memberships, and the versions of these terms you accepted.
- **Workspace content:** everything you and your teammates create or upload, including requirement documents, files, screenshots of automated tests, and AI prompts and outputs.
- **Connected accounts:** tokens you choose to connect (GitHub, GitLab, AI provider keys, a Claude subscription token, a remote browser address). They are stored encrypted and used only for the features you turn on.
- **Usage and technical data:** sign-in sessions (with browser type and IP address), AI usage records (task, model, size, cost estimate), and security logs.
- **Billing data:** plan, invoices and payment status. Card details are entered on and processed by Stripe; we never see or store full card numbers.

## 3. Why we use it (and our legal basis)
- To provide and secure the Service, including AI features you use (performance of our contract with you).
- To bill paid plans and keep financial records (contract; legal obligation).
- To send service emails such as invitations, password resets and important notices (contract; legitimate interests).
- To prevent abuse, investigate incidents and improve reliability (legitimate interests).
- We do **not** sell personal data, and we do not use your workspace content to train AI models. [Confirm with your AI providers' terms.]

## 4. Who we share it with (subprocessors)
- Hosting and database: [Vercel / your server provider], [Supabase].
- Email delivery: [SendGrid / your SMTP provider].
- Payments: Stripe.
- AI providers your workspace uses (for example Anthropic, OpenAI, Google), only for the requests you make.
- Integrations you connect (GitHub, GitLab, CodeRabbit, remote browser providers).
- Authorities, where required by law.
[Keep an up-to-date list of subprocessors and their locations.]

## 5. International transfers
Our providers may process data outside your country. Where required, we use appropriate safeguards such as standard contractual clauses. [Details.]

## 6. How long we keep it
- Account data: while your account exists, then deleted within [30] days of deletion.
- Workspace content: while the workspace exists, then deleted within [30] days of deletion (backups overwritten within [N] days).
- Sign-in sessions: up to 30 days. Password reset links: 2 hours. Cached AI answers: up to the period set by the workspace.
- Billing records: as long as tax law requires ([N] years).

## 7. Your rights
Depending on where you live (for example under the GDPR or the Philippine Data Privacy Act of 2012), you can ask to access, correct, delete or export your personal data, object to or restrict some processing, and withdraw consent. For workspace content, contact your workspace administrator first. To exercise your rights, email [Contact email]. You may also complain to your data protection authority.

## 8. Security
We use encryption in transit (HTTPS), encryption at rest for stored keys and tokens, row-level access controls between workspaces, hashed passwords and limited staff access. No system is perfectly secure; we will notify affected customers of a personal data breach as the law requires.

## 9. Children
The Service is not intended for children under [16].

## 10. Cookies
We use only the storage needed to run the Service. See our [Cookie Notice](/cookies).

## 11. Changes
We will post changes here, update the version and date, and tell you in the app or by email when changes are material.
`;
