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
 */
export function buildPDFFileName(opts: SmartPDFNameOptions, extension: string = ".pdf"): string {
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
  return parts.join("-") + extension;
}

/**
 * Save a jsPDF document with maximum cross-browser compatibility.
 */
export async function smartSavePDF(
  doc: { output: (type: string) => ArrayBuffer | Blob },
  nameOpts: SmartPDFNameOptions | string
): Promise<void> {
  const fileName = typeof nameOpts === "string" ? nameOpts : buildPDFFileName(nameOpts);
  const arrayBuffer = doc.output("arraybuffer") as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });

  try {
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
    if (err?.name === "AbortError") return;
    console.warn("showSaveFilePicker failed, using fallback:", err);
  }

  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
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

/**
 * Save a jsPDF document as PNG image(s).
 * Multi-page documents generate one PNG per page.
 */
export async function smartSavePNG(
  doc: any,
  nameOpts: SmartPDFNameOptions | string
): Promise<void> {
  try {
    const pageCount = doc.getNumberOfPages();
    
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      
      // Render page to canvas at 2x resolution for quality
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(pageWidth * scale * (96 / 72));
      canvas.height = Math.round(pageHeight * scale * (96 / 72));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context not available");

      // Use jsPDF's built-in canvas output
      const imgData = doc.output("datauristring", { page: i });
      
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve();
        };
        img.onerror = reject;
        img.src = imgData;
      });

      const suffix = pageCount > 1 ? `-pagina-${i}` : "";
      const baseName = typeof nameOpts === "string" 
        ? nameOpts.replace(/\.pdf$/i, "") 
        : buildPDFFileName(nameOpts, "").replace(/\.$/, "");
      const fileName = `${baseName}${suffix}.png`;

      canvas.toBlob((blob) => {
        if (!blob) {
          toast.error("Erro ao gerar PNG.");
          return;
        }
        
        try {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = fileName;
          link.style.display = "none";
          document.body.appendChild(link);
          link.click();
          setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }, 250);
        } catch {
          toast.error("Erro ao baixar o PNG.");
        }
      }, "image/png");
    }

    toast.success(pageCount > 1 ? `${pageCount} imagens PNG geradas!` : "PNG gerado com sucesso!");
  } catch (err) {
    console.error("PNG export failed:", err);
    toast.error("Erro ao gerar PNG. Tente novamente.");
  }
}
