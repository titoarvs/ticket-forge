// Coding several issues at once without conflicts. Before code jobs start on many issues, this
// checks which of them touch the same files or modules (their coding specs, lib/specs.ts
// findOverlaps), which collide with code jobs that are running or waiting for review, and which are
// blocked by another selected issue. It splits the issues into rounds: round 1 can run together
// now, the others should wait for the round before. Jev (when on) makes two small calls: for issues
// without a coding spec, which other selected issue most likely edits the same code (pick one), and
// for issues that share only a module, whether they will really edit the same code (yes / no). What
// Jev isn't sure about goes to the AI; when the AI fails too, the rules decide (shared module =
// conflict, no spec = can't check).

export { busyFromJobs, planParallel } from './parallel/plan-parallel';
export type { Conflict } from './parallel/plan-parallel';
export { parallelHints, checkParallel } from './parallel/parallel-hints';
