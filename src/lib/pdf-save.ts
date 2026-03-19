import { toast } from "sonner";

/**
 * Sanitize a string for use as a filename:
 * - lowercase, replace spaces/special chars with hyphens, remove accents
 */
function sanitize(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface SmartPDFNameOptions {
  tipo: "agenda" | "evento" | "financeiro" | "financeiro-consolidado" | "financeiro-master" | string;
  evento?: string;
  cidade?: string;
  data?: string; // ISO or dd/MM/yyyy
}

/**
 * Build a professional filename from event metadata.
 * Examples:
 *   agenda-maringa-festival-20-03-2026.pdf
 *   financeiro-evento-cianorte.pdf
 */
export function buildPDFFileName(opts: SmartPDFNameOptions): string {
  const parts = [sanitize(opts.tipo)];
  if (opts.evento) parts.push(sanitize(opts.evento));
  if (opts.cidade) parts.push(sanitize(opts.cidade));
  if (opts.data) {
    try {
      const d = new Date(opts.data);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        parts.push(`${dd}-${mm}-${yyyy}`);
      }
    } catch {
      // ignore invalid dates
    }
  }
  return parts.join("-") + ".pdf";
}

/**
 * Save a jsPDF document with maximum cross-browser compatibility.
 * - Windows 11 / modern browsers: opens native "Save As" dialog via File System Access API
 * - Windows 10 / older browsers: automatic download via <a> tag fallback
 */
export async function smartSavePDF(
  doc: { output: (type: string) => ArrayBuffer | Blob },
  nameOpts: SmartPDFNameOptions | string
): Promise<void> {
  const fileName = typeof nameOpts === "string" ? nameOpts : buildPDFFileName(nameOpts);
  const arrayBuffer = doc.output("arraybuffer") as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });

  try {
    // Modern File System Access API (Chrome 86+, Edge 86+)
    if ("showSaveFilePicker" in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "PDF Document",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      toast.success("PDF salvo com sucesso!");
      return;
    }
  } catch (err: any) {
    // User cancelled the save dialog — not an error
    if (err?.name === "AbortError") {
      return;
    }
    // Any other error → fall through to legacy method
    console.warn("showSaveFilePicker failed, using fallback:", err);
  }

  // Fallback: create temporary <a> link and trigger download
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();

    // Cleanup after a short delay
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 250);

    toast.success("PDF gerado com sucesso!");
  } catch (fallbackErr) {
    console.error("PDF download failed:", fallbackErr);
    toast.error("Erro ao baixar o PDF. Tente novamente.");
  }
}
