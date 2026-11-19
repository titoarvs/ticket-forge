'use client';
import type { Any } from '../core';

export const TYPES = ['Story', 'Task', 'Bug', 'Spike'];
export const REASONING: [string, string, string][] = [
  [
    'fast',
    'Fast & consistent',
    'No extended thinking. The AI follows these rules directly: quickest, most predictable results. Recommended.',
  ],
  ['balanced', 'Balanced', 'Some thinking for unusual or complex documents.'],
  [
    'thorough',
    'Thorough',
    'Thinks deeply before answering. Slower and uses more of your AI usage or credits.',
  ],
];
/**
 * Corporate test standards: picking one fills the Test management fields (each can then be
 * changed).
 */
export const TM_STANDARDS: [string, string, string][] = [
  [
    'istqb',
    'ISTQB',
    'Formal test cases: preconditions, numbered steps, expected result per step, test data.',
  ],
  [
    'xray',
    'Xray for Jira',
    'Step tables (action · data · expected) on every test, linked to requirements.',
  ],
  ['bdd', 'BDD (Cucumber)', 'Gherkin scenarios in business language: Given · When · Then.'],
  [
    'browserstack',
    'BrowserStack TM',
    'Concise step tests with tags; expected result on the last step.',
  ],
  ['custom', 'Company standard', 'Your own rules: change any field below.'],
];
export const TM_PRESETS: Record<string, Any> = {
  istqb: {
    format: 'steps',
    titleFormat: 'TC: Verify <behaviour> when <condition>',
    stepsMin: 3,
    stepsMax: 12,
    expectedEveryStep: true,
    testData: true,
    preconditions: true,
    labels: 'functional, negative, boundary, security, usability, performance',
  },
  xray: {
    format: 'steps',
    titleFormat: 'Verify <behaviour> when <condition>',
    stepsMin: 2,
    stepsMax: 8,
    expectedEveryStep: true,
    testData: true,
    preconditions: true,
    labels: 'smoke, regression, security, ui, api, integration, negative, edge',
  },
  bdd: {
    format: 'gherkin',
    titleFormat: '<Actor> can <goal>',
    gherkinStyle: 'declarative',
    preconditions: true,
    labels: 'smoke, regression, wip, negative, edge',
  },
  browserstack: {
    format: 'steps',
    titleFormat: '<Feature>: <behaviour>',
    stepsMin: 2,
    stepsMax: 6,
    expectedEveryStep: false,
    testData: false,
    preconditions: true,
    labels: 'smoke, sanity, regression, p1, p2, p3',
  },
};
