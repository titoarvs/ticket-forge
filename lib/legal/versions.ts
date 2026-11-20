// Current versions of the legal documents, kept in plain JS so server code (lib/auth.ts) can read
// them.
// Bump a version when its document changes. Material changes ask everyone to accept the new
// version.
export const LEGAL_VERSIONS = {
  terms: { version: '2026-11-15', material: true },
  privacy: { version: '2026-11-15', material: true },
  cookies: { version: '2026-11-15', material: false },
};
/** The documents people accept: at sign-up, setup and invite, and again after a material change. */
export const ACCEPTED_DOCS = ['terms', 'privacy'];
