'use client';

// Coding specs: one AI coding prompt per ticket of an epic, with its acceptance criteria and the
// files or modules it is expected to touch. Specs that touch the same file or module are flagged,
// and the project's setting blocks or warns when they are marked ready. AI-produced changes linked
// to a spec are accepted only after a required reviewer approves them.

export { openSpecs } from './Specs/open-specs';
