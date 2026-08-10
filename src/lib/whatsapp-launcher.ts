import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/features/update/UpdateService";
import { buildWhatsAppProtocolUrl, buildWhatsAppUrl } from "@/lib/whatsapp-billing";

/**
 * Opens a WhatsApp chat with the given phone/message already filled in.
 *
 * Desktop (Tauri): tries the whatsapp:// app protocol first, via the
 * official opener plugin (registered in src-tauri/src/lib.rs, scoped for
 * this scheme in src-tauri/capabilities/default.json) - never window.open,
 * which doesn't reach a real browser from inside the Tauri webview.
 * Availability is checked first through the is_whatsapp_app_available Rust
 * command instead of just trying the protocol and catching a failure:
 * ShellExecuteExW (what the opener plugin calls under the hood) reports
 * *success* even when no app is registered for a custom scheme, because
 * Windows itself opens a "choose an app"/Store-search prompt in that case
 * and counts that as having succeeded - a rejected promise is not a signal
 * this app can rely on here. When the app isn't available, or the app
 * attempt itself throws anyway, this falls back to the wa.me link (still
 * via the opener plugin, not window.open).
 *
 * Web/PWA: always window.open(wa.me), exactly as before - there is no
 * native app to prefer.
 */
export async function openWhatsApp(phoneE164Digits: string, message: string): Promise<void> {
  const webUrl = buildWhatsAppUrl(phoneE164Digits, message);

  if (!isTauri()) {
    window.open(webUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const { openUrl } = await import("@tauri-apps/plugin-opener");
  const appAvailable = await invoke<boolean>("is_whatsapp_app_available").catch(() => false);

  if (appAvailable) {
    try {
      await openUrl(buildWhatsAppProtocolUrl(phoneE164Digits, message));
      return;
    } catch {
      // App is registered but the launch itself failed - fall through to
      // the universal wa.me link below instead of leaving the user stuck.
    }
  }

  await openUrl(webUrl);
}
