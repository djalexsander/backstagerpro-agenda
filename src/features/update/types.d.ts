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

// Tauri plugin stubs (only available in Tauri runtime)
declare module "@tauri-apps/plugin-updater" {
  export function check(): Promise<{
    available: boolean;
    version?: string;
    downloadAndInstall: () => Promise<void>;
  } | null>;
}

declare module "@tauri-apps/plugin-process" {
  export function relaunch(): Promise<void>;
}
