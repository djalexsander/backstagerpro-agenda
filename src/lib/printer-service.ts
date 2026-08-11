import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/integrations/supabase/client";
import { isTauri } from "@/features/update/UpdateService";
import type { PrintImageJob, PrinterConfig, SavePrinterConfigInput, SystemPrinter } from "./printer-types";

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
 *
 * Web/PWA only. Inside the Tauri desktop shell, window.open() has no
 * popup to open (WebView2 there doesn't spawn one) and always returns
 * null - see printImagesToWindowsPrinter for the desktop replacement.
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

/**
 * Renders a self-contained HTML fragment off-screen at its true physical
 * size (widthMm x heightMm, browser-native mm units - no manual px/DPI
 * math needed) and rasterizes it to PNG bytes via html2canvas (already an
 * existing dependency, unused elsewhere in the app until now). Used only
 * on the desktop path - the web path keeps printing the live HTML/DOM
 * directly through the browser's own print pipeline (openPrintWindow).
 *
 * The container is attached to the document (off-screen via a large
 * negative offset, not display:none) because html2canvas needs a real
 * layout box to capture - detached or display:none nodes have none.
 */
export async function rasterizeHtmlToPngBytes({
  widthMm,
  heightMm,
  html,
  scale = 4,
}: {
  widthMm: number;
  heightMm: number;
  html: string;
  scale?: number;
}): Promise<Uint8Array> {
  const { default: html2canvas } = await import("html2canvas");
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = `${widthMm}mm`;
  container.style.height = `${heightMm}mm`;
  container.style.background = "#ffffff";
  container.style.overflow = "hidden";
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { scale, backgroundColor: "#ffffff", logging: false });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Falha ao gerar a imagem para impressão."))),
        "image/png",
      );
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    container.remove();
  }
}

// Must match PRINTER_NOT_FOUND in src-tauri/src/printing.rs exactly - the
// Rust side returns this bare string (not a sentence) when OpenPrinterW
// fails, so the frontend can show "impressora não encontrada" instead of
// a generic failure message.
const PRINTER_NOT_FOUND_ERROR = "NOT_FOUND";

/**
 * Sends already-rasterized page images straight to a named Windows printer
 * through the print_label_batch Tauri command (src-tauri/src/printing.rs),
 * which spools them via GDI using that printer's own default DEVMODE - no
 * window, no popup, no print dialog. Desktop-only, like listSystemPrinters.
 *
 * `messages` lets a caller override the two error strings with
 * flow-specific wording (e.g. "etiqueta" vs a generic "impressão") without
 * duplicating the invoke/error-mapping logic at every call site.
 */
export async function printImagesToWindowsPrinter(
  printerName: string,
  jobs: PrintImageJob[],
  documentName: string,
  messages?: { notFound?: string; failed?: string },
): Promise<void> {
  if (!isDesktopRuntime()) {
    throw new Error("Impressão direta só está disponível no aplicativo desktop.");
  }
  try {
    await invoke("print_label_batch", {
      printerName,
      documentName,
      jobs: jobs.map((job) => ({ pngBytes: Array.from(job.pngBytes), quantity: job.quantity })),
    });
  } catch (error) {
    const isNotFound =
      error === PRINTER_NOT_FOUND_ERROR || (error instanceof Error && error.message === PRINTER_NOT_FOUND_ERROR);
    if (isNotFound) {
      throw new Error(messages?.notFound ?? `A impressora "${printerName}" não foi encontrada no Windows.`);
    }
    const detail = typeof error === "string" ? error : error instanceof Error ? error.message : undefined;
    const base = messages?.failed ?? "Não foi possível enviar a impressão para a impressora.";
    throw new Error(detail ? `${base} ${detail}` : base);
  }
}
