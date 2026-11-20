// Finds a web app's page routes from its source code, for Test automation → App setup.
// File-based routing: Next.js (app/ and pages/), SvelteKit, Nuxt, Remix / React Router framework
// mode, Astro, TanStack Router / TanStack Start (src/routes, checked against its generated
// routeTree.gen.ts).
// Router config: React Router (JSX and objects), Vue Router, Angular. Server: Laravel, Django,
// Rails.
// Dynamic segments become :params, e.g. /orders/:id. API routes are left out.

export { nameForPath, paramsOf, objectRoutes, jsxRoutes } from './routes/object-routes';
export { skipPath, tanstackRoutes, scanCodebase } from './routes/scan-codebase';
