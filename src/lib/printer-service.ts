import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/integrations/supabase/client";
import { isTauri } from "@/features/update/UpdateService";
import type { PrinterConfig, SavePrinterConfigInput, SystemPrinter } from "./printer-types";

interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

function throwPrinterError(error: RpcError | null, context: string): never {
  const messages: Record<string, string> = {
    PR001: "Selecione a empresa.",
    PR002: "Finalidade de impressão inválida.",
  };
  const message = (error?.code && messages[error.code]) || error?.message || "Falha na configuração de impressão.";
  console.error(`[printer-service] ${context}`, error);
  throw new Error(message);
}

export async function listPrinterConfigs(companyId: string): Promise<PrinterConfig[]> {
  const { data, error } = await callRpc("obter_configuracoes_impressora", {
    _empresa_id: companyId,
  });
  if (error) throwPrinterError(error, "list printer configs");
  return (data ?? []) as PrinterConfig[];
}

export async function savePrinterConfig(
  companyId: string,
  input: SavePrinterConfigInput,
): Promise<PrinterConfig> {
  const { data, error } = await callRpc("salvar_configuracao_impressora", {
    _empresa_id: companyId,
    _finalidade: input.purpose,
    _nome_impressora: input.printerName || undefined,
    _formato: input.format || undefined,
    _largura_mm: input.widthMm ?? undefined,
    _altura_mm: input.heightMm ?? undefined,
    _orientacao: input.orientation ?? "retrato",
    _ativo: input.active ?? true,
    _configuracoes: input.settings ?? {},
  });
  if (error) throwPrinterError(error, "save printer config");
  return data as PrinterConfig;
}

/**
 * Reuses the exact same detection this app already relies on to tell a
 * Tauri desktop build apart from the plain web/PWA build (see
 * src/features/update/UpdateService.ts, used for the auto-update flow).
 * Gates every call below that only makes sense on desktop (system printer
 * enumeration) - the browser has no API for that and never will (see
 * listSystemPrinters).
 */
export function isDesktopRuntime(): boolean {
  return isTauri();
}

/**
 * Lists printers actually installed on this machine, via the
 * list_windows_printers Tauri command (src-tauri/src/lib.rs). That command
 * shells out to PowerShell's Win32_Printer CIM class instead of pulling in
 * a native printing plugin/crate - there is still no plugin installed, this
 * only adds enumeration, not silent printing (see openPrintWindow below,
 * still the print mechanism for the "Testar impressão" action).
 * Desktop-only: throws immediately in a browser/PWA context instead of
 * letting a real fetch/invoke fail with a confusing error, since no browser
 * exposes the OS printer list to a web page.
 */
export async function listSystemPrinters(): Promise<SystemPrinter[]> {
  if (!isDesktopRuntime()) {
    throw new Error("A lista de impressoras do sistema só está disponível no aplicativo desktop.");
  }
  const printers = await invoke<{ name: string; is_default: boolean }[]>("list_windows_printers");
  return printers.map((printer) => ({ name: printer.name, isDefault: printer.is_default }));
}

/**
 * Pure so it's trivially testable and reusable between the "load saved
 * config" effect and any future revalidation (e.g. after "Atualizar
 * lista") - matching name only, since a Windows printer's display name is
 * also its addressable identifier (there is no separate opaque driver id
 * surfaced by Win32_Printer that would be more stable than the name).
 */
export function isPrinterCurrentlyInstalled(savedPrinterName: string | null | undefined, systemPrinters: SystemPrinter[]): boolean {
  if (!savedPrinterName) return false;
  return systemPrinters.some((printer) => printer.name === savedPrinterName);
}

/**
 * Opens a popup window with the given HTML and triggers the OS print
 * dialog once it has loaded. Same pattern already proven in
 * src/lib/material-label-print.tsx for label printing - reused here for
 * cupom/receipt and any other browser-based print flow, instead of a
 * second implementation.
 */
export function openPrintWindow(html: string, windowName = "print"): Window {
  const popup = window.open("", "_blank", "popup,width=900,height=700");
  if (!popup) {
    throw new Error("O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.");
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.document.title = windowName;
  return popup;
}
