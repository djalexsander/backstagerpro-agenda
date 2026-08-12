export type PrinterPurpose = "etiqueta" | "cupom" | "documento";

export type PrinterOrientation = "retrato" | "paisagem";

export interface PrinterConfig {
  id: string;
  empresa_id: string;
  finalidade: PrinterPurpose;
  nome_impressora: string | null;
  formato: string | null;
  largura_mm: number | null;
  altura_mm: number | null;
  orientacao: PrinterOrientation;
  ativo: boolean;
  configuracoes: Record<string, unknown>;
  /** Bobina profile currently loaded on this printer (finalidade="etiqueta"
   * only; null for the other purposes). Swappable independently of the
   * printer itself - see src/lib/bobina-profile-types.ts. */
  perfil_bobina_padrao_id: string | null;
}

export interface SavePrinterConfigInput {
  purpose: PrinterPurpose;
  printerName?: string;
  format?: string;
  widthMm?: number;
  heightMm?: number;
  orientation?: PrinterOrientation;
  active?: boolean;
  settings?: Record<string, unknown>;
  bobinaProfileId?: string | null;
}

export const PRINTER_PURPOSE_LABELS: Record<PrinterPurpose, string> = {
  etiqueta: "Etiquetas",
  cupom: "Cupom / Recibo",
  documento: "Documentos / Relatórios (A4)",
};

// A printer actually installed on the machine, as reported by the OS - not
// to be confused with PrinterConfig, which is the saved preference. Desktop
// only (see listSystemPrinters in printer-service.ts).
export interface SystemPrinter {
  name: string;
  isDefault: boolean;
}

// One page (rasterized to PNG) repeated `quantity` times in a single spool
// job - see printImagesToWindowsPrinter in printer-service.ts and the
// print_label_batch Tauri command (src-tauri/src/printing.rs).
export interface PrintImageJob {
  pngBytes: Uint8Array;
  quantity: number;
  /** Physical source size. When present, the native GDI bridge preserves
   * this aspect ratio instead of stretching the bitmap to the full page. */
  widthMm?: number;
  heightMm?: number;
}
