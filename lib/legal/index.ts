// The public legal documents. Bump a `version` when a document changes; `material: true` means people must accept
// the new version before they continue using the app (see app/api/me/legal and the banner in client/AppShell.tsx).
// The texts are TEMPLATES with [placeholders]: have them reviewed by qualified counsel before relying on them.
import { TERMS } from './terms';
import { PRIVACY } from './privacy';
import { COOKIES } from './cookies';
import { LEGAL_VERSIONS, ACCEPTED_DOCS as DOCS } from './versions.js';

export type LegalDoc = 'terms' | 'privacy' | 'cookies';
export const LEGAL: Record<LegalDoc, { version: string; material: boolean; title: string; path: string; body: string }> = {
  terms: { ...LEGAL_VERSIONS.terms, title: 'Terms of Use', path: '/terms', body: TERMS },
  privacy: { ...LEGAL_VERSIONS.privacy, title: 'Privacy Policy', path: '/privacy', body: PRIVACY },
  cookies: { ...LEGAL_VERSIONS.cookies, title: 'Cookie Notice', path: '/cookies', body: COOKIES },
};
/** The documents people accept (at sign-up, invite, setup, and again when a material version changes). */
export const ACCEPTED_DOCS = DOCS as LegalDoc[];
export const currentVersions = () => Object.fromEntries(ACCEPTED_DOCS.map((d) => [d, LEGAL[d].version])) as Record<'terms' | 'privacy', string>;
