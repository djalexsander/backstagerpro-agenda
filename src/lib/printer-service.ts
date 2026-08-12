import { invoke } from "@tauri-apps/api/core";
import { supabase } from "@/integrations/supabase/client";
import { isTauri } from "@/features/update/UpdateService";
import { getTerminalPrinterOverride, type TerminalPrinterOverride } from "./terminal-printer-config";
import type {
  PrintImageJob,
  PrinterConfig,
  PrinterPurpose,
  SavePrinterConfigInput,
  SystemPrinter,
} from "./printer-types";

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

const MISSING_PRINTER_MESSAGES: Record<PrinterPurpose, string> = {
  etiqueta: "Nenhuma impressora de etiquetas configurada. Configure em Configurações > Impressoras.",
  cupom: "Nenhuma impressora de cupom configurada. Configure em Configurações > Impressoras.",
  documento: "Nenhuma impressora de documentos configurada. Configure em Configurações > Impressoras.",
};

// Matches ConfiguracoesImpressoras.tsx's own DEFAULT_FORMAT.cupom (58mm) -
// only used before any width has ever been configured/overridden, so the
// two must agree or a brand-new setup would show one width in the settings
// screen while actually printing at another.
const DEFAULT_PRINT_SIZE: Record<PrinterPurpose, { widthMm: number; heightMm?: number }> = {
  etiqueta: { widthMm: 50, heightMm: 30 },
  cupom: { widthMm: 58 },
  documento: { widthMm: 210, heightMm: 297 },
};

/** Pure resolver shared by every print surface. Inactive rows and blank
 * printer names are deliberately equivalent to a missing configuration. */
export function resolveConfiguredPrinter(
  configs: PrinterConfig[],
  purpose: PrinterPurpose,
): PrinterConfig | null {
  return configs.find(
    (config) => config.finalidade === purpose && config.ativo && Boolean(config.nome_impressora?.trim()),
  ) ?? null;
}

function terminalOverrideAsPrinterConfig(
  companyId: string,
  purpose: PrinterPurpose,
  override: TerminalPrinterOverride,
): PrinterConfig {
  return {
    id: `terminal-override:${purpose}`,
    empresa_id: companyId,
    finalidade: purpose,
    nome_impressora: override.printerName,
    formato: override.format || null,
    largura_mm: override.widthMm,
    altura_mm: override.heightMm,
    orientacao: override.orientation,
    ativo: true,
    configuracoes: {},
    perfil_bobina_padrao_id: override.bobinaProfileId,
  };
}

/**
 * Layers this terminal's local override (terminal-printer-config.ts, never
 * synced) on top of the company-wide default loaded from Supabase. A
 * terminal that has never saved its own selection for this purpose
 * transparently falls back to resolveConfiguredPrinter, so existing
 * single-terminal companies keep working exactly as before. This is the
 * function every print entry point should resolve "which printer" through -
 * see getConfiguredPrinter below, the only caller.
 */
export function resolveEffectivePrinterConfig(
  companyId: string,
  configs: PrinterConfig[],
  purpose: PrinterPurpose,
): PrinterConfig | null {
  const override = getTerminalPrinterOverride(companyId, purpose);
  if (override) return terminalOverrideAsPrinterConfig(companyId, purpose, override);
  return resolveConfiguredPrinter(configs, purpose);
}

/** Canonical, tenant-scoped lookup for the configured printer by purpose. */
export async function getConfiguredPrinter(
  companyId: string,
  purpose: PrinterPurpose,
): Promise<PrinterConfig> {
  const config = resolveEffectivePrinterConfig(companyId, await listPrinterConfigs(companyId), purpose);
  if (!config) throw new Error(MISSING_PRINTER_MESSAGES[purpose]);
  return config;
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
    _perfil_bobina_padrao_id: input.bobinaProfileId ?? undefined,
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
 * a native printing plugin/crate. Silent printing itself is handled by the
 * existing GDI command used by printHtmlBatch below.
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

async function waitForDocumentAssets(document: Document, root: ParentNode = document): Promise<void> {
  if (document.fonts?.ready) await document.fonts.ready;
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    if (image.complete) return;
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
      return;
    }
    await new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }));
}

/** Browser/PWA print transport. `srcdoc` inherits the parent origin, so the
 * iframe remains accessible without opening a popup or another browser
 * window. The frame is removed after `print()` returns. */
export async function printHtmlInBrowser(html: string, documentName = "Impressão"): Promise<void> {
  if (isDesktopRuntime()) {
    throw new Error("A impressão pelo navegador não está disponível no aplicativo desktop.");
  }

  document.querySelectorAll("iframe[data-backstage-print-frame]").forEach((frame) => frame.remove());
  const iframe = document.createElement("iframe");
  iframe.dataset.backstagePrintFrame = "true";
  iframe.setAttribute("aria-hidden", "true");
  iframe.title = documentName;
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.right = "0";
  iframe.style.bottom = "0";

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(loadTimeout);
      iframe.remove();
      resolve();
    };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(loadTimeout);
      iframe.remove();
      reject(error instanceof Error ? error : new Error("Não foi possível abrir o diálogo de impressão."));
    };
    const loadTimeout = window.setTimeout(
      () => fail(new Error("O conteúdo de impressão não foi carregado pelo navegador.")),
      10_000,
    );

    iframe.addEventListener("load", async () => {
      try {
        const targetWindow = iframe.contentWindow;
        const targetDocument = iframe.contentDocument;
        if (!targetWindow || !targetDocument) {
          throw new Error("O navegador não disponibilizou o conteúdo para impressão.");
        }
        await waitForDocumentAssets(targetDocument);
        targetWindow.focus();
        targetWindow.print();
        // In Chromium print() blocks until the dialog closes. The zero-delay
        // cleanup also covers engines that dispatch no afterprint event.
        window.setTimeout(cleanup, 0);
      } catch (error) {
        fail(error);
      }
    }, { once: true });

    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

function extractRasterMarkup(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script").forEach((script) => script.remove());
  const styles = Array.from(parsed.head.querySelectorAll("style, link[rel='stylesheet']"))
    .map((node) => node.outerHTML)
    .join("");
  return `${styles}${parsed.body.innerHTML}`;
}

function pixelsPerMillimeter(): number {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.left = "-10000px";
  probe.style.width = "100mm";
  document.body.appendChild(probe);
  const measured = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return measured > 0 ? measured : 96 / 25.4;
}

export interface RasterizedPrintImage {
  pngBytes: Uint8Array;
  widthMm: number;
  heightMm: number;
}

/** Rasterizes either a fixed page or a variable-height document. Dynamic
 * height is measured from the laid-out DOM before capture, eliminating
 * clipping and fixed blank tails in receipt images. */
export async function rasterizeHtmlToPngImage({
  widthMm,
  heightMm,
  html,
  scale = 4,
}: {
  widthMm: number;
  heightMm?: number;
  html: string;
  scale?: number;
}): Promise<RasterizedPrintImage> {
  const { default: html2canvas } = await import("html2canvas");
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = `${widthMm}mm`;
  if (heightMm != null) container.style.height = `${heightMm}mm`;
  container.style.background = "#ffffff";
  container.style.overflow = heightMm == null ? "visible" : "hidden";
  container.className = "backstage-print-raster";
  container.innerHTML = `${extractRasterMarkup(html)}<style>
    .backstage-print-raster .sheet,
    .backstage-print-raster .print-document { margin: 0 !important; box-shadow: none !important; }
  </style>`;
  document.body.appendChild(container);
  try {
    await waitForDocumentAssets(document, container);
    const pxPerMm = pixelsPerMillimeter();
    const measuredHeightPx = Math.ceil(Math.max(container.scrollHeight, container.getBoundingClientRect().height));
    const effectiveHeightMm = heightMm ?? Math.max(measuredHeightPx / pxPerMm, 1);
    if (heightMm == null) {
      container.style.height = `${effectiveHeightMm}mm`;
      container.style.overflow = "hidden";
    }
    const canvas = await html2canvas(container, { scale, backgroundColor: "#ffffff", logging: false });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Falha ao gerar a imagem para impressão."))),
        "image/png",
      );
    });
    return {
      pngBytes: new Uint8Array(await blob.arrayBuffer()),
      widthMm,
      heightMm: effectiveHeightMm,
    };
  } finally {
    container.remove();
  }
}

/**
 * Renders a self-contained HTML fragment off-screen at its true physical
 * size (widthMm x heightMm, browser-native mm units - no manual px/DPI
 * math needed) and rasterizes it to PNG bytes via html2canvas (already an
 * existing dependency, unused elsewhere in the app until now). Used only
 * on the desktop path - the web path prints the live HTML inside the
 * disposable same-origin iframe created by printHtmlInBrowser.
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
  return (await rasterizeHtmlToPngImage({ widthMm, heightMm, html, scale })).pngBytes;
}

export interface HtmlPrintJob {
  html: string | ((layout: { widthMm: number; heightMm?: number }) => string);
  quantity?: number;
  widthMm?: number;
  heightMm?: number;
  dynamicHeight?: boolean;
  /** Splits a long rendered document into physical pages. Defaults to true
   * for the documento purpose and is ignored by the web print engine. */
  paginate?: boolean;
  /** Offscreen rasterization resolution multiplier (see
   * rasterizeHtmlToPngImage's `scale`). Only affects how crisp the
   * intermediate PNG is - physical widthMm/heightMm stay authoritative
   * either way. Defaults to rasterizeHtmlToPngImage's own default (4) when
   * omitted, unchanged for every existing caller (cupom/documento/etiqueta
   * test print). Bobina-aware label printing derives this from the
   * profile's DPI via dpiToRasterScale (label-layout-engine.ts). */
  rasterScale?: number;
}

export interface PrintHtmlBatchOptions {
  companyId: string;
  purpose: PrinterPurpose;
  documentName: string;
  jobs: HtmlPrintJob[];
  webHtml?: string | (() => string);
  configuredPrinter?: PrinterConfig;
  messages?: { notFound?: string; failed?: string };
}

async function rasterizeHtmlToPngPages({
  widthMm,
  pageHeightMm,
  html,
  scale = 2,
}: {
  widthMm: number;
  pageHeightMm: number;
  html: string;
  scale?: number;
}): Promise<RasterizedPrintImage[]> {
  const { default: html2canvas } = await import("html2canvas");
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = `${widthMm}mm`;
  container.style.background = "#ffffff";
  container.style.overflow = "visible";
  container.className = "backstage-print-raster";
  container.innerHTML = `${extractRasterMarkup(html)}<style>
    .backstage-print-raster .sheet,
    .backstage-print-raster .print-document { margin: 0 !important; box-shadow: none !important; }
  </style>`;
  document.body.appendChild(container);
  try {
    await waitForDocumentAssets(document, container);
    const source = await html2canvas(container, { scale, backgroundColor: "#ffffff", logging: false });
    const pageHeightPx = Math.max(1, Math.round(source.width * pageHeightMm / widthMm));
    const pageCount = Math.max(1, Math.ceil(source.height / pageHeightPx));
    const pages: RasterizedPrintImage[] = [];

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const page = document.createElement("canvas");
      page.width = source.width;
      page.height = pageHeightPx;
      const context = page.getContext("2d");
      if (!context) throw new Error("Não foi possível paginar o documento para impressão.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, page.width, page.height);
      const sourceY = pageIndex * pageHeightPx;
      const sourceHeight = Math.min(pageHeightPx, source.height - sourceY);
      context.drawImage(source, 0, sourceY, source.width, sourceHeight, 0, 0, source.width, sourceHeight);
      const blob = await new Promise<Blob>((resolve, reject) => page.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Falha ao gerar a página para impressão."))),
        "image/png",
      ));
      pages.push({
        pngBytes: new Uint8Array(await blob.arrayBuffer()),
        widthMm,
        heightMm: pageHeightMm,
      });
    }
    return pages;
  } finally {
    container.remove();
  }
}

function resolveJobSize(job: HtmlPrintJob, purpose: PrinterPurpose, config?: PrinterConfig) {
  const defaults = DEFAULT_PRINT_SIZE[purpose];
  return {
    widthMm: job.widthMm ?? config?.largura_mm ?? defaults.widthMm,
    heightMm: job.dynamicHeight ? undefined : job.heightMm ?? config?.altura_mm ?? defaults.heightMm,
  };
}

/** Canonical transport for one or more HTML print pages. Every purpose uses
 * the browser iframe on web and the configured Windows queue on desktop. */
export async function printHtmlBatch(options: PrintHtmlBatchOptions): Promise<void> {
  if (!options.jobs.length) return;
  if (!isDesktopRuntime()) {
    const webHtml = typeof options.webHtml === "function"
      ? options.webHtml()
      : options.webHtml ?? String(
        typeof options.jobs[0].html === "function"
          ? options.jobs[0].html(resolveJobSize(options.jobs[0], options.purpose))
          : options.jobs[0].html,
      );
    await printHtmlInBrowser(webHtml, options.documentName);
    return;
  }

  const config = options.configuredPrinter ?? await getConfiguredPrinter(options.companyId, options.purpose);
  const imageJobs: PrintImageJob[] = [];
  for (const job of options.jobs) {
    const size = resolveJobSize(job, options.purpose, config);
    const html = typeof job.html === "function" ? job.html(size) : job.html;
    if (options.purpose === "documento" && job.paginate !== false) {
      const pages = await rasterizeHtmlToPngPages({
        widthMm: size.widthMm,
        pageHeightMm: size.heightMm ?? DEFAULT_PRINT_SIZE.documento.heightMm!,
        html,
      });
      imageJobs.push(...pages.map((page) => ({
        pngBytes: page.pngBytes,
        quantity: job.quantity ?? 1,
        widthMm: page.widthMm,
        heightMm: page.heightMm,
      })));
      continue;
    }
    const raster = await rasterizeHtmlToPngImage({
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      html,
      ...(job.rasterScale ? { scale: job.rasterScale } : {}),
    });
    imageJobs.push({
      pngBytes: raster.pngBytes,
      quantity: job.quantity ?? 1,
      widthMm: raster.widthMm,
      heightMm: raster.heightMm,
    });
  }
  await printImagesToWindowsPrinter(config.nome_impressora!, imageJobs, options.documentName, options.messages);
}

export async function printHtmlDocument(
  options: Omit<PrintHtmlBatchOptions, "jobs" | "webHtml"> & HtmlPrintJob,
): Promise<void> {
  const { html, quantity, widthMm, heightMm, dynamicHeight, paginate, rasterScale, ...batch } = options;
  const webHtml = typeof html === "function"
    ? () => html(resolveJobSize({ html, widthMm, heightMm, dynamicHeight }, options.purpose))
    : html;
  await printHtmlBatch({
    ...batch,
    jobs: [{ html, quantity, widthMm, heightMm, dynamicHeight, paginate, rasterScale }],
    webHtml,
  });
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
      jobs: jobs.map((job) => ({
        pngBytes: Array.from(job.pngBytes),
        quantity: job.quantity,
        widthMm: job.widthMm,
        heightMm: job.heightMm,
      })),
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
