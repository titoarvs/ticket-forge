'use client';

// Administration → AI → Model routing: which model each kind of AI work uses. Tasks get a tier
// (High, Standard, Light); each tier maps to a model on every AI (Claude account, GitHub Copilot,
// each AI API). Cheap, routine work (epic outlines, questions, failure notes) runs on lighter
// models, saving usage and credits for the work that needs the best.

export { RoutingSection } from './AiRouting/RoutingSection';
