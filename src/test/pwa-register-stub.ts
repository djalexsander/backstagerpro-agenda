// Test-only stand-in for the "virtual:pwa-register" module that
// vite-plugin-pwa injects at build time (see src/features/update/types.d.ts
// for the real shape). Vitest has no VitePWA plugin instance to resolve
// that virtual id, so vitest.config.ts aliases it here instead - this lets
// tests import the real src/features/update/UpdateService.ts (rather than
// mocking the whole module away) when they need its actual logic exercised.
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
