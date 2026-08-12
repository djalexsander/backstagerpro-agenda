import type { PrinterOrientation, PrinterPurpose } from "./printer-types";

// ============================================================================
// PER-TERMINAL PRINTER SELECTION (local, not synced)
// ============================================================================
//
// Which physical printer/profile is loaded right now is, by nature, a fact
// about THIS machine - not something that belongs in a shared, company-wide
// database row. Two terminals in the same company routinely point at two
// different physical printers (e.g. Recepcao vs Estoque), and saving one
// must never silently change the other.
//
// Storing the selection in localStorage achieves that isolation for free:
// two terminals are, by construction, two different browser profiles /
// WebView2 user-data folders, so nothing written here ever crosses between
// them. No terminal registry table, no schema/migration, no server round
// trip to read or write it.
//
// empresa_impressora_config (Supabase, company-wide - see printer-service.ts)
// is preserved exactly as-is and still writable from the settings screen; it
// is now the FALLBACK a terminal resolves to before it has ever saved a
// local override of its own (see resolveEffectivePrinterConfig in
// printer-service.ts), so existing single-terminal companies keep working
// unchanged.

const OVERRIDE_KEY_PREFIX = "backstage:printer-override";

export interface TerminalPrinterOverride {
  printerName: string;
  format: string;
  widthMm: number | null;
  heightMm: number | null;
  orientation: PrinterOrientation;
  bobinaProfileId: string | null;
}

// In-memory fallback for when localStorage itself is unavailable (private
// browsing with storage disabled, policy-restricted WebView2, etc.) -
// printing still works for the rest of the current page session, it just
// doesn't survive a reload. Same try/catch-and-degrade shape already used by
// src/lib/backup-utils.ts for its own localStorage reads/writes.
const memoryFallback = new Map<string, string>();

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryFallback.set(key, value);
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    memoryFallback.delete(key);
  }
}

function overrideKey(companyId: string, purpose: PrinterPurpose): string {
  return `${OVERRIDE_KEY_PREFIX}:${companyId}:${purpose}`;
}

/** Null when this terminal has never saved its own selection for this
 * purpose (fresh install, or explicitly cleared) - callers fall back to the
 * company-wide default. A blank/whitespace-only printer name is treated the
 * same as "no override", mirroring resolveConfiguredPrinter's own
 * blank-name-is-absent rule in printer-service.ts. */
export function getTerminalPrinterOverride(companyId: string, purpose: PrinterPurpose): TerminalPrinterOverride | null {
  const raw = readStorage(overrideKey(companyId, purpose));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalPrinterOverride> | null;
    if (!parsed || !parsed.printerName || !parsed.printerName.trim()) return null;
    return {
      printerName: parsed.printerName,
      format: parsed.format ?? "",
      widthMm: parsed.widthMm ?? null,
      heightMm: parsed.heightMm ?? null,
      orientation: parsed.orientation === "paisagem" ? "paisagem" : "retrato",
      bobinaProfileId: parsed.bobinaProfileId ?? null,
    };
  } catch {
    // Corrupted/foreign value under our key (e.g. hand-edited devtools) -
    // treat as absent rather than throwing out of a read path.
    return null;
  }
}

export function saveTerminalPrinterOverride(companyId: string, purpose: PrinterPurpose, override: TerminalPrinterOverride): void {
  writeStorage(overrideKey(companyId, purpose), JSON.stringify(override));
}

export function clearTerminalPrinterOverride(companyId: string, purpose: PrinterPurpose): void {
  removeStorage(overrideKey(companyId, purpose));
}

export function hasTerminalPrinterOverride(companyId: string, purpose: PrinterPurpose): boolean {
  return getTerminalPrinterOverride(companyId, purpose) !== null;
}
