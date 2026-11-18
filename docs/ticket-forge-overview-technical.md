# Ticket Forge: overview and technical document

> **Source and status.** Written from the Ticket Forge App Context and the project notes (issue TF-116). There is no formal product summary or project description, so the problems solved are inferred from the app's features and workflow. Anything the source does not confirm is marked **TBD**, not guessed. Issue keys such as `TF-24` point to the ticket where a feature was specified.

## How to read this document

- **TBD** means "to be decided or confirmed". It is never a value. Don't quote a TBD item as fact.
- Part 1 is a plain-language overview for everyone. Part 2 describes each module. Part 3 links each workflow problem to the feature that solves it. The technical appendix is for engineers and anyone who needs the detail.

## 1. Overview

### Purpose

Ticket Forge is an AI-assisted backlog and delivery workspace. A project holds its epics, tickets, files and activity in one place. The AI helps write the backlog, test cases and project documents (PSD, FBD, ARD and the agent document). The same app also covers test automation, linking a code repository, builds and pull requests, and paid subscriptions through PayMongo.

A formal one-line product summary: **TBD**.

### Target users

| User group | Who they are | What they do in the app |
|---|---|---|
| **Owner** | The person who creates the account on the first visit to a new instance (TF-9). | Runs the workspace. Only owners can delete a project, and they must re-enter their password to confirm (TF-89). Other Owner permissions: **TBD**. |
| **Super Admin** | The administrator role set up for testing. | Uses the admin area: settings, users, roles, invitations, AI, browser, email, templates, feature flags and PayMongo keys. Other Super Admin permissions: **TBD**. |
| **Workspace users** | People who join through an invitation (TF-6). | Work in projects. What each person can do depends on the custom role an admin gives them. The exact permission matrix: **TBD**. |

### The workflow in one view

Ticket Forge follows a project from requirements to delivery:

1. **Requirements to epics.** Requirements go in, and the AI helps produce the backlog.
2. **Tickets.** Epics break down into tickets that the team works on in the workspace.
3. **Test cases.** Tickets get test cases, and tests can be run with browser automation.
4. **Documents.** The AI writes PSD, FBD, ARD and agent documents, which download as Word files.
5. **Delivery.** The project connects to a code repository for builds, pull requests and status updates.

Part 3 lists the problem each stage addresses and the feature that solves it.

## 2. Modules

Ticket Forge has eight modules. The list below follows the App Context.

### Access & Security (TF-E1)

Controls who can get into the app.

- **Sign in and password recovery (TF-5).** Users sign in with email and password and can recover a forgotten password.
- **Owner account setup (TF-9).** A brand-new instance asks for the Owner account to be created on the first visit.
- **Accept invitation (TF-6).** An invited person joins the workspace through their invitation.
- Routes: **TBD**.

### Admin: Users, Roles, Invitations

Lets admins manage who is in the workspace and what they can do. The source lists this module without an epic key (epic: **TBD**).

- **Invitations (TF-10, TF-11, TF-87).** List and send invitations. Resend or revoke a pending invitation. Duplicate invites for the same email are blocked, and a sending state is shown.
- **Users (TF-12, TF-13).** List and update users, remove a user and reset a user's password.
- **Roles (TF-14, TF-15).** List, create, edit and delete roles. Role names other than Super Admin: **TBD**.

### Projects & Backlog Workspace (TF-E2)

The main place where teams plan and track work.

- **Project lifecycle.** Create a project (TF-7), open the project workspace (TF-16), edit project details (TF-17) and delete a project (TF-18). Deleting is owner only and needs the password.
- **Tickets.** Ticket details open in a side panel (TF-2, TF-76). A ticket has a backlog status and an assignee (TF-4). Tickets are versioned on every status change, with view, diff and restore (TF-71). UI references can be attached to tickets for AI generation (TF-80).
- **History.** A project version check for changes (TF-19), Activity (TF-20) and Changes (TF-21).
- **Notifications.** List notifications and mark them as read (TF-22, TF-23).
- **Navigation and app info.** The side navigation is a rail on tablets and a drawer on phones (TF-83). The app version shows in the sidebar as `v<major.minor.patch>` (TF-77, TF-84). Release notes (TF-78). An FAQ chatbot with a release announcement robot (TF-86).

### AI Generation & Documents (TF-E3)

Uses the AI to write backlog content and project documents.

- **Backlog generation.** Generate a backlog from requirements (TF-24), add features with AI (TF-1) and add layers (TF-26).
- **Test cases.** Generate test cases in a batch (TF-25).
- **Documents.** Generate each of PSD, FBD, ARD and the agent document, and download each as Word (TF-27 to TF-34).
- **Export.** Export the backlog to files (TF-35). File formats: **TBD**.
- **Templates.** Each project can view its document templates, save a customized version and reset it to the default (TF-36 to TF-38).
- **Coding specs.** Coding specs per epic, with overlap detection (TF-99).
- **Document upload.** Upload documents, including PDF parsing (TF-82).

### Testing & Automation (TF-E4)

Plans tests and runs them in a browser.

- **Planning and selection.** Test plan (TF-39), select tests (TF-40) and build a test repository with AI (TF-41).
- **Running automation.** Run test automation (TF-42), install browser automation (TF-43), see the automation status (TF-44) and open a run output file (TF-45).
- **Credentials and login.** View and save project credentials (TF-46), create a credentials session (TF-47), detect the login page (TF-48) and test the login with saved credentials (TF-49).
- **Evidence.** List failure screenshots and view a single one (TF-50, TF-51).
- **Routes.** List and save project routes for testing (TF-52, TF-53).

### Code & Delivery Integration (TF-E5)

Connects a project to its code and to delivery.

- **Repository.** Browse and update project code (TF-54, TF-55), sync the repository (TF-56) and view or update the project context (TF-57).
- **Delivery.** Trigger a build (TF-3), generate pull request info (TF-58) and update a ticket's status automatically when its code is complete (TF-79).
- **Local config.** Local config folders are kept separate for each user and repository (TF-102).

### Platform & Settings (TF-E6)

The admin settings that control how the app behaves.

- **System status and feature flags.** Show system status (TF-59). Read and update feature flags (TF-60). Flags may hide features.
- **AI.** AI connection settings (TF-61), an AI usage view (TF-62) and AI co-pilot settings (TF-73).
- **Test browser.** Test browser settings (TF-63).
- **Email.** View the email configuration (TF-64) and send a test email (TF-65).
- **Generation.** Generation rules (TF-66) and a generation guide (TF-67).
- **Default templates.** Default document templates for PSD, FBD and ARD (TF-68 to TF-70).

### Billing / Subscriptions (TF-90 to TF-98, TF-100, TF-101)

Lets the product charge for use through PayMongo.

- **Admin and setup.** PayMongo API keys in admin, and the gateway client setup.
- **Plans.** Plans and plan limits, and all plan tiers enabled. Plan names and prices: **TBD**. Limit values: **TBD**.
- **Subscription flow.** Choose a payment method at checkout, start a paid plan with a trial period, see the subscription status in the workspace and cancel a subscription. Trial length and status names: **TBD**.
- **Failed payments.** A failed payment leads to a grace period. Duration: **TBD**.
- **Limits display.** Plan limits and Copilot limits are shown (TF-85).
- **Checkout and subscription UI.** The screens for checkout and managing the subscription.

### Other items in the source

- **TF-E7 "New epic"** is a placeholder. Its scope is **TBD**, so it has no section here.

## 3. Problems solved

The App Context does not state a project description, so these problems are inferred from the features and the workflow. Each row names the workflow stage, the problem, and the feature that solves it.

| Workflow stage | Problem addressed (inferred) | Feature that solves it |
|---|---|---|
| Requirements to epics | Turning raw requirements into a structured backlog by hand is slow. | Generate backlog from requirements (TF-24), add features with AI (TF-1), add layers (TF-26) and document upload with PDF parsing (TF-82). Module: AI Generation & Documents. |
| Tickets | Work needs one clear place to be tracked, and changes to a ticket are easy to lose. | Ticket details side panel (TF-2, TF-76), backlog status and assignee (TF-4), ticket versions with view, diff and restore (TF-71), UI references on tickets (TF-80) and coding specs per epic with overlap detection (TF-99). Modules: Projects & Backlog Workspace, AI Generation & Documents. |
| Test cases | Writing and running test cases takes time, and failures are hard to show. | Batch test cases (TF-25), build a test repository with AI (TF-41), run test automation (TF-42) and failure screenshots (TF-50, TF-51). Module: Testing & Automation. |
| Documents | Project documents are written by hand, in different layouts, and are hard to share. | Generate PSD, FBD, ARD and agent documents with Word download (TF-27 to TF-34), per-project templates (TF-36 to TF-38) and export backlog to files (TF-35). Module: AI Generation & Documents. |
| Delivery | The link between tickets and code is manual, so status goes out of date. | Repository sync (TF-56), trigger a build (TF-3), generate pull request info (TF-58) and auto-update ticket status on code completion (TF-79). Module: Code & Delivery Integration. |

Supporting problems that cut across the stages:

| Area | Problem addressed (inferred) | Feature that solves it |
|---|---|---|
| Access | Only the right people should reach a workspace and its projects. | Sign in and password recovery (TF-5), invitations (TF-6, TF-10, TF-11, TF-87) and custom roles (TF-14, TF-15). Modules: Access & Security, Admin. |
| Safety | A project must not be deleted by accident. | Owner-only delete with password confirmation (TF-18, TF-89). Module: Projects & Backlog Workspace. |
| Visibility | The team needs to see what changed and who did it. | Activity (TF-20), Changes (TF-21) and notifications (TF-22, TF-23). Module: Projects & Backlog Workspace. |
| Control | Admins need to tune the AI, the browser and email without code changes. | AI, browser and email settings, generation rules and guide, and feature flags (TF-59 to TF-70). Module: Platform & Settings. |
| Revenue | The product needs a way to charge users. | Plans, checkout and subscriptions with PayMongo (TF-90 to TF-98, TF-100, TF-101). Module: Billing / Subscriptions. |

## Technical appendix

This appendix is for engineers. Details the source does not confirm are marked **TBD**.

### A. Stack and infrastructure

| Item | What the source says |
|---|---|
| Web app | A Next.js (App Router) app written in React and TypeScript. Source: the repository's `package.json`. |
| Database | PostgreSQL, with an embedded PGlite database when no `DATABASE_URL` is set. Source: the repository's `package.json` and README. |
| Code layers | The UI, logic and API layers are kept separate (TF-88). |
| Hosting | Hosted on Vercel at https://automated-tickets.vercel.app/, plus a VPS for the backend and the automation engine (TF-72, TF-75). |
| AI agent layer | An AI agent layer exists (TF-74). Details: **TBD**. |
| Document output | Documents are produced as Word (`.docx`) files. |
| Other stack details | **TBD**. |

### B. Integrations

| Integration | What it does in the app | Product or provider |
|---|---|---|
| AI provider | A configurable connection used for generation. Usage is tracked and shown (TF-61, TF-62). | **TBD** |
| Browser automation engine | Can be installed, status-checked and configured. Runs the automated tests (TF-42 to TF-44, TF-63). | **TBD** |
| Code repository host | Used for repository sync, code browse and update, builds and pull requests (TF-3, TF-54 to TF-58). | **TBD** |
| Email service | Configurable, with a test send. Used for email such as invitations (TF-64, TF-65). | **TBD** |
| PayMongo | The payment gateway for subscriptions (TF-90 to TF-98). | PayMongo |

### C. Roles and permissions

| Role | Description | Permissions |
|---|---|---|
| Owner | Created on first visit (TF-9). The first user is the Owner. | Only owners can delete a project, with password confirmation (TF-89). Others: **TBD**. |
| Super Admin | The role set up for testing. | Has the admin area (TF-8, TF-10 to TF-15, TF-59 to TF-70, TF-90). Others: **TBD**. |
| Custom roles | Admins create, edit and delete them (TF-14, TF-15). Workspace users get permissions from their role. | **TBD** |
| All other roles | Role names other than Super Admin: **TBD**. | **TBD** |

The full permission matrix: **TBD**.

### D. Data entities

| Entity | Relationships | Field schema |
|---|---|---|
| Workspace | Has Users, Roles, Invitations, Settings, a Subscription/Plan and Projects. | **TBD** |
| User | Has a Role. The first user is the Owner. | **TBD** |
| Project | Has Epics, Tickets, Files/Documents, Activity, Changes and a Version. It also holds template overrides, credentials, routes, a test plan and tests, automation runs (output files and failure screenshots), repository/code, context, and builds and pull requests. | **TBD** |
| Epic | Has Tickets and coding specs. | **TBD** |
| Ticket | Has a status, an assignee, versions (history), UI references and test cases. | **TBD** |
| Notification | Belongs to a User and has a read or unread state. | **TBD** |
| Settings | Covers AI, Copilot, browser, email, generation rules and guide, feature flags, default templates and PayMongo keys. | **TBD** |

### E. API

API endpoint paths: **TBD**. The source expects these groups: auth, invitations, users, roles, projects (with tickets, documents, templates, tests, automation, credentials, screenshots, routes, code, context, build and pull request), notifications, admin settings, feature flags and billing.

### F. Glossary of terms with unconfirmed meaning

| Term | Meaning |
|---|---|
| **PSD** | An AI-generated project document, exported as Word. Expansion: **TBD**. |
| **FBD** | An AI-generated project document, exported as Word. Expansion: **TBD**. |
| **ARD** | An AI-generated project document, exported as Word. Expansion: **TBD**. |
| **Agent document** | A document meant for AI coding agents. |
| **Layers** | Layers added to a project (TF-26). Exact meaning: **TBD**. |
| **Templates** | Admin defaults (TF-68 to TF-70) that a project can override (TF-37) and reset (TF-38). |
| **Backlog status** | The status of a ticket. Status names: **TBD**. |
| **Plan limits** | Limits on usage that come with a plan, including Copilot use. Values: **TBD**. |

### G. Items marked TBD in this document

- Plan names and prices, trial length, grace period length, status names and limit values.
- The role permission matrix and role names other than Owner and Super Admin.
- Provider names: AI provider, browser automation engine, code repository host and email service.
- Field schemas for every data entity.
- API endpoint paths and routes.
- The PSD, FBD and ARD expansions, and the meaning of Layers.
- A formal product summary, and the scope of TF-E7.
