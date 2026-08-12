/// <reference types="vite-plugin-pwa/client" />

declare module "virtual:pwa-register" {
  export function registerSW(options?: {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: any) => void;
  }): (reloadPage?: boolean) => Promise<void>;
}

// @tauri-apps/plugin-updater and @tauri-apps/plugin-process are real
// dependencies now (see package.json) and ship their own accurate types
// (node_modules/@tauri-apps/plugin-{updater,process}/dist-js/index.d.ts) -
// the hand-written stubs that used to live here, from when these were
// dynamically imported optional packages that might not be installed, are
// gone. They'd shadowed the real Update.close()/download()/install() shape
// with an incomplete one otherwise.
