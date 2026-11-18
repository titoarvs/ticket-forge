# Ticket Forge: purpose, users and features

> **Source and status of this page.** Everything here comes from the project's App Context and the project notes (issue TF-115). Anything the source does not confirm is marked **TBD**, not guessed. The location and format of this document (this Markdown file in `docs/`) are a proposal and still need to be confirmed with the product owner before publishing.

## How to read this page

- **TBD** means "to be decided or confirmed". It is never a value. Don't quote a TBD item as fact.
- **Issue keys** such as `TF-24` point to the ticket in the tracker where the feature was specified.
- **Status labels** are `Live`, `Beta`, `Planned` or `TBD`. The App Context does not give a release status for any feature, so every feature below is **TBD** until the product owner confirms it. (The tracker marks TF-71, TF-80 and TF-89 as Done. Done in the tracker is not treated here as proof of "Live".)

## 1. Purpose

Ticket Forge (TF) is our AI-assisted backlog and delivery workspace. Teams keep their projects in one place: epics, tickets, files and activity. The AI helps write the backlog, test cases and project documents. The same app covers test automation, linking a code repository, builds and pull requests, and paid subscriptions.

A formal one-line product summary: **TBD**.

### Target user groups

| Group | Who they are |
|---|---|
| **Owner** | The person who creates the account on the first visit to a new instance. |
| **Super Admin** | The administrator role set up for testing. It has the admin area. |
| **Workspace users** | People who join through an invitation. What they can do depends on the custom role they are given. |

## 2. Access rules

| Role | What it is | Access |
|---|---|---|
| **Owner** | Created on first visit (TF-9). The first user of a workspace is the Owner. | Only owners can delete a project, and they must re-enter their password to confirm (TF-89). Other Owner permissions: **TBD**. |
| **Super Admin** | The role set up for testing. | Has the admin area: settings, users, roles, invitations, AI, browser, email, templates, feature flags and PayMongo keys (TF-8, TF-10 to TF-15, TF-59 to TF-70, TF-90). Other Super Admin permissions: **TBD**. |
| **Custom roles** | Roles that admins create, edit and delete (TF-14, TF-15). Workspace users get their permissions from the custom role assigned to them. | The permissions of each custom role are set by the admin who creates it. The full list of permissions: **TBD**. |
| **All other roles** | Role names other than Super Admin: **TBD**. | Permissions: **TBD**. |

The full permission matrix: **TBD** (out of scope for this document).

## 3. Feature catalogue

Each row lists what the feature does, what it uses, and its status. "Uses" names the data, settings or services the feature depends on, as far as the source says. Where the source doesn't say, it shows **TBD**.

### Access & Security (TF-E1)

| Feature | What it does | Uses | Status |
|---|---|---|---|
| Sign in and password recovery (TF-5) | Lets a user sign in with email and password, and recover a forgotten password. | Email and password; recovery details: TBD | TBD |
| Owner account setup (TF-9) | On a brand-new instance, asks for the Owner account to be created on first visit. | The first User, who becomes the Owner | TBD |
| Accept invitation (TF-6) | Lets an invited person join the workspace through their invitation. | Invitations; Roles (how a role is assigned: TBD) | TBD |

### Admin: Users, Roles, Invitations

The source lists this module without an epic key (epic: **TBD**).

| Feature | What it does | Uses | Status |
|---|---|---|---|
| List and send invitations (TF-10, TF-11) | Shows invitations and sends new ones. Shows a sending state, and blocks duplicate invites for the same email (TF-87). | Invitations; Roles; the email service | TBD |
| Resend or revoke a pending invitation (TF-87) | Resends or revokes an invitation that is still pending. | Invitations | TBD |
| List and update users (TF-12) | Shows the users of the workspace and lets an admin update them. | Users; Roles | TBD |
| Remove a user and reset a user's password (TF-13) | Lets an admin remove a user or reset that user's password. | Users | TBD |
| List and create roles (TF-14) | Shows roles and lets an admin create a new one. | Roles | TBD |
| Edit and delete roles (TF-15) | Lets an admin change or delete a role. | Roles | TBD |

### Projects & Backlog Workspace (TF-E2)

| Feature | What it does | Uses | Status |
|---|---|---|---|
| Create a project (TF-7) | Creates a new project. | Projects | TBD |
| Open the project workspace (TF-16) | Opens a project and leads to its workspace. | Project: epics, tickets, files, activity | TBD |
| Edit project details (TF-17) | Changes the details of a project. | Projects | TBD |
| Delete a project (TF-18, TF-89) | Deletes a project. Owner only, and the password must be re-entered. | Owner role; password confirmation | TBD (tracker: TF-89 Done) |
| Ticket details side panel (TF-2, TF-76) | Opens ticket details in a side panel. | Tickets | TBD |
| Backlog status and assignee (TF-4) | Sets a ticket's backlog status and assignee. | Tickets; Users | TBD |
| Ticket versions (TF-71) | Saves a version of the ticket on each status change. Lets you view, compare (diff) and restore versions. | Tickets; ticket versions (history) | TBD (tracker: Done) |
| Attach UI references to tickets (TF-80) | Attaches UI references to a ticket so the AI can generate ticket content from them. | Tickets; the AI provider | TBD (tracker: Done) |
| Project version check (TF-19) | Checks the project version for changes. | Project version | TBD |
| Activity (TF-20) | Shows the activity of a project. | Project activity | TBD |
| Changes (TF-21) | Shows the changes made in a project. | Project changes | TBD |
| Notifications: list and mark as read (TF-22, TF-23) | Lists a user's notifications and marks them as read. | Notifications (read or unread state) | TBD |
| Responsive sidenav (TF-83) | Shows the side navigation as a rail on tablets and as a drawer on phones. | Sidenav | TBD |
| App version in the sidebar (TF-77, TF-84) | Shows the app version as `v<major.minor.patch>` in the sidebar. | App version | TBD |
| Release notes (TF-78) | Shows release notes. Content: **TBD**. | TBD | TBD |
| FAQ chatbot with release announcement robot (TF-86) | Answers FAQs and announces releases. | TBD | TBD |

### AI Generation & Documents (TF-E3)

| Feature | What it does | Uses | Status |
|---|---|---|---|
| Generate backlog from requirements (TF-24) | Creates backlog content with AI from the requirements. | The AI provider; Epics; Tickets | TBD |
| Add features with AI (TF-1) | Adds features to the backlog with AI. | The AI provider | TBD |
| Add layers (TF-26) | Adds layers to a project. See "Layers" in the glossary. | Project | TBD |
| Batch test cases (TF-25) | Generates test cases in a batch. | The AI provider; Tickets | TBD |
| Generate and download PSD, FBD, ARD and Agent document (TF-27 to TF-34) | Generates each document with AI and downloads each one as a Word file (`.docx`). | The AI provider; document templates | TBD |
| Export backlog to files (TF-35) | Exports the backlog to files. File formats: **TBD**. | Epics; Tickets | TBD |
| Per-project document templates (TF-36 to TF-38) | Lets a project view its templates, save a customized version and reset it to the default. | Templates (project overrides and admin defaults) | TBD |
| Coding specs per epic, with overlap detection (TF-99) | Creates coding specs for each epic and detects overlaps between them. | Epics; coding specs | TBD |
| Document upload that parses PDF (TF-82) | Uploads documents, and parses PDF files. | Project files and documents | TBD |

### Testing & Automation (TF-E4)

| Feature | What it does | Uses | Status |
|---|---|---|---|
| Test plan (TF-39) | Holds the test plan of a project. | Project test plan and tests | TBD |
| Select tests (TF-40) | Chooses which tests to include. | Project test plan and tests | TBD |
| Build a test repository with AI (TF-41) | Creates a test repository with AI. | The AI provider; Project test plan and tests | TBD |
| Run test automation (TF-42) | Runs the automated tests. | The browser automation engine; project routes and credentials | TBD |
| Install browser automation (TF-43) | Installs the browser automation engine. | The browser automation engine | TBD |
| Automation status (TF-44) | Shows the status of the automation engine. | The browser automation engine | TBD |
| Open a run output file (TF-45) | Opens an output file from a run. | Automation runs (output files) | TBD |
| View and save project credentials (TF-46) | Shows and saves the credentials used for tests. | Project credentials | TBD |
| Create a credentials session (TF-47) | Creates a session from the saved credentials. | Project credentials | TBD |
| Detect the login page (TF-48) | Finds the login page of the tested app. | The browser automation engine | TBD |
| Test the login with saved credentials (TF-49) | Checks that the saved credentials can sign in. | Project credentials; the browser automation engine | TBD |
| List and view failure screenshots (TF-50, TF-51) | Lists failure screenshots, and shows one of them. | Automation runs (failure screenshots) | TBD |
| List and save project routes (TF-52, TF-53) | Lists the routes of the tested app and saves them. | Project routes | TBD |

### Code & Delivery Integration (TF-E5)

| Feature | What it does | Uses | Status |
|---|---|---|---|
| Browse and update project code (TF-54, TF-55) | Browses the project's code and updates it. | The code repository host (host: TBD) | TBD |
| Sync the repository (TF-56) | Syncs the project with its repository. | The code repository host | TBD |
| Project context: view and update (TF-57) | Shows the project context and lets you update it. | Project context | TBD |
| Trigger a build (TF-3) | Starts a build. | The code repository host; Builds | TBD |
| Generate pull request info (TF-58) | Generates the details for a pull request. | The code repository host; PRs | TBD |
| Auto-update ticket status on code completion (TF-79) | Moves a ticket's status automatically when its code is complete. | Tickets; the code repository host | TBD |
| Separate local config folders per user and repository (TF-102) | Keeps local configuration folders apart for each user and each repository. | Local config folders | TBD |

### Platform & Settings (TF-E6)

| Feature | What it does | Uses | Status |
|---|---|---|---|
| Show system status (TF-59) | Shows the status of the system. | Settings | TBD |
| Read and update feature flags (TF-60) | Shows feature flags and lets an admin change them. Flags may hide features. | Feature flags | TBD |
| AI connection settings (TF-61) | Sets how the app connects to the AI provider. | The AI provider (name: TBD) | TBD |
| AI usage view (TF-62) | Shows how much AI is used. | The AI provider; usage tracking | TBD |
| AI co-pilot settings (TF-73) | Sets up the AI co-pilot. | Copilot settings | TBD |
| Test browser settings (TF-63) | Sets up the browser used for tests. | The browser automation engine | TBD |
| View email configuration (TF-64) | Shows the email settings. | The email service (provider: TBD) | TBD |
| Send a test email (TF-65) | Sends a test email. | The email service | TBD |
| Generation rules (TF-66) | Sets the rules used for generation. | Generation rules | TBD |
| Generation guide (TF-67) | Sets the guide used for generation. | Generation guide | TBD |
| Default document templates: PSD, FBD, ARD (TF-68 to TF-70) | Sets the default template for each of these documents. Projects can override them (TF-37). | Default templates | TBD |

### Billing / Subscriptions (TF-90 to TF-98, TF-100, TF-101)

| Feature | What it does | Uses | Status |
|---|---|---|---|
| PayMongo API keys in admin | Lets an admin enter the PayMongo keys. | PayMongo; Settings | TBD |
| Gateway client setup | Sets up the payment gateway client. | PayMongo | TBD |
| Plans and plan limits | Defines plans and the limits that cap usage. Plan names and prices: **TBD**. Limit values: **TBD**. | Plans; Plan limits | TBD |
| All plan tiers enabled | Makes every plan tier available. | Plans | TBD |
| Choose a payment method at checkout | Lets the customer pick how to pay. | PayMongo | TBD |
| Start a paid plan with a trial period | Starts a paid plan. A trial period applies before the first charge. Trial length: **TBD**. | PayMongo; Subscription | TBD |
| Subscription status in the workspace | Shows the subscription status. Status names: **TBD**. | Subscription | TBD |
| Cancel a subscription | Lets the customer cancel. | Subscription; PayMongo | TBD |
| Failed payment grace period | After a failed payment, the subscription goes into a grace period. Duration: **TBD**. | Subscription; PayMongo | TBD |
| Checkout and subscription UI | The screens for checkout and managing the subscription. | Subscription; PayMongo | TBD |
| Plan limits and Copilot limits display (TF-85) | Shows the plan limits and Copilot limits. | Plan limits; Copilot | TBD |

### Other items in the source

- **TF-E7 "New epic"**: a placeholder. Its scope is **TBD**, so it has no features here.

## 4. Integrations and infrastructure

| Item | What it is | Details |
|---|---|---|
| AI provider | Configurable connection, with usage tracked. | Provider name: **TBD** |
| Browser automation engine | Can be installed, status-checked and configured. | Product: **TBD** |
| Code repository host | Used for sync, code browse and update, builds and pull requests. | Host: **TBD** |
| Email service | Configurable, with a test send. | Provider: **TBD** |
| PayMongo | Payment gateway for subscriptions. | Plan names and prices: **TBD** |
| Hosting | Hosted on Vercel, plus a VPS for the backend and automation engine (TF-72, TF-75) and an AI agent layer (TF-74). | Further details: **TBD** |

API endpoint paths: **TBD** (out of scope for this document).

## 5. Glossary

| Term | Meaning |
|---|---|
| **PSD** | An AI-generated project document, exported as Word. Expansion: **TBD**. |
| **FBD** | An AI-generated project document, exported as Word. Expansion: **TBD**. |
| **ARD** | An AI-generated project document, exported as Word. Expansion: **TBD**. |
| **Agent document** | A document meant for AI coding agents. It is generated and downloaded as Word, like PSD, FBD and ARD. |
| **Layers** | Layers that are added to a project (TF-26). Exact meaning: **TBD**. |
| **Templates** | Document templates. Admins set the defaults (TF-68 to TF-70). A project can override a default (TF-37) and reset the override back to the default (TF-38). |
| **Backlog status** | The status of a ticket in the backlog. Status names: **TBD**. A status change creates a ticket version (TF-71). Code completion can move the status automatically (TF-79). |
| **Plan limits** | Limits on usage that come with a plan, including Copilot and AI use. Limit values: **TBD**. |
| **Invitation states** | Pending (can be resent or revoked) and Accepted (reached through the invitation flow). Duplicate invites for the same email are blocked (TF-87). |
| **Subscription** | A paid plan. A trial period applies before the first charge. A failed payment leads to a grace period. It can be cancelled. Status names and durations: **TBD**. |
| **Version format** | The app version is written `v<major.minor.patch>`. |
