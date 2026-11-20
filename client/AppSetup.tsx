'use client';

// Test automation → App setup: the app's pages, its user roles with their logins, and how to sign
// in. Test scripts then read like `await app.loginAs('Admin'); await app.goto('Orders')`. Passwords
// are saved encrypted on the server, separately from the project, and are never shown again.

export { appSetup, AppSetup, setupStatus } from './AppSetup/AppSetup';
