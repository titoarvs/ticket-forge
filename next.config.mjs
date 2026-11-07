/** @type {import('next').NextConfig} */
const nextConfig = {
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
