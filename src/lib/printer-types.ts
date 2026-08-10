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
