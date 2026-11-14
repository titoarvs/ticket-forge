// Playwright reads data files (browsers.json and others) at runtime, which import tracing can't see. Ship its
// whole packages with every route that drives a browser, or serverless hosting (Vercel) fails with
// "Cannot find module …/playwright-core/browsers.json".
const PLAYWRIGHT_FILES = ['./node_modules/playwright-core/**/*', './node_modules/playwright/**/*', './node_modules/@playwright/test/**/*'];
const BROWSER_ROUTES = ['/api/automation/*', '/api/admin/browser', '/api/admin/generation', '/api/projects/*/discover', '/api/projects/*/login-test', '/api/projects/*/login-detect'];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_DIST_DIR lets a test build go to its own folder, so it never replaces the build a running `next start` uses.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingIncludes: {
    ...Object.fromEntries(BROWSER_ROUTES.map((r) => [r, PLAYWRIGHT_FILES])),
    // GitHub Actions setup copies the test runner's source files into the repository.
    '/api/automation/github': [...PLAYWRIGHT_FILES, './lib/run-one.mjs', './lib/app-helpers.mjs', './lib/browser.mjs', './lib/totp.mjs', './node_modules/@playwright/test/package.json'],
  },
  // Server-only packages with native parts, WASM or data files: load them from node_modules at runtime
  // instead of bundling them.
  serverExternalPackages: [
    'pg', '@electric-sql/pglite', '@playwright/test', 'playwright', 'playwright-core', 'pdfkit', 'pdf-parse',
    'exceljs', 'docx', 'mammoth', 'nodemailer', '@anthropic-ai/sdk',
  ],
  poweredByHeader: false,
  reactStrictMode: true,
};
export default nextConfig;
