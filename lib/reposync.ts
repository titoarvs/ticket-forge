// Repository sync for Test automation (local only): reads the project's local repository and
//  1. finds the app's pages from its routes (lib/routes.ts), with the source files each page is
//     built from;
//  2. works out which pages changed since the last sync (git diff, including uncommitted work);
//  3. asks the AI which existing test cases those changes affect and rewrites them (two passes:
//     pick, then rewrite);
//  4. reads the git history and asks the AI which features are already built: existing issues to
//     mark Done, and delivered work that has no issue yet (added to the backlog as Done).
// Nothing is saved here: the app shows the result for review and saves what the person applies.

export { readRepo, testCaseUpdates } from './reposync/test-case-updates';
export { builtFeatures, pageTestCases, featureDocs } from './reposync/page-test-cases';
export { builtFeatureMap } from './reposync/built-feature-map';
