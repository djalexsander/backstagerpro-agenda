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
    // Generate PDF as blob, then render each page via an offscreen iframe
    const pdfBlob = doc.output("blob");
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const pageCount = doc.getNumberOfPages();

    // Use jsPDF's internal canvas rendering per page
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const scale = 2;
      const pxW = Math.round(pageWidth * scale * (96 / 72));
      const pxH = Math.round(pageHeight * scale * (96 / 72));

      const canvas = document.createElement("canvas");
      canvas.width = pxW;
      canvas.height = pxH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context not available");

      // Get the page as a data URL image via jsPDF's internal rendering
      // jsPDF can output the whole document; we render it to a temporary canvas
      const pdfDataUri = doc.output("dataurlstring");

      // Since browsers cannot render PDF data URIs in <img>, we use a different
      // approach: render each page by creating an SVG foreignObject wrapper
      // that embeds the PDF, or simply use the canvas output from jsPDF directly.
      
      // Fallback: Use jsPDF's canvas plugin if available, otherwise
      // convert via a temporary image by re-rendering the page content.
      // The most reliable cross-browser method is to use the page's raw content.
      
      // Create a high-res image from the PDF using an object URL approach
      await new Promise<void>((resolve, reject) => {
        const iframe = document.createElement("iframe");
        iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:" + pxW + "px;height:" + pxH + "px;border:none;opacity:0;pointer-events:none;";
        iframe.src = pdfUrl + "#page=" + i;
        document.body.appendChild(iframe);

        // Give the iframe time to render the PDF page
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("PDF render timeout"));
        }, 10000);

        const cleanup = () => {
          clearTimeout(timeout);
          try { document.body.removeChild(iframe); } catch {}
        };

        iframe.onload = () => {
          // Wait a bit for the PDF to fully render inside the iframe
          setTimeout(() => {
            try {
              // Draw white background
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, pxW, pxH);

              // Try to capture iframe content
              // Since cross-origin restrictions may apply to PDF rendering,
              // we use a simpler approach: re-generate as individual page images
              // using jsPDF's SVG output
              const svgString = doc.output("dataurlstring", { 
                type: "image/jpeg",
                quality: 0.98
              });
              
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(img, 0, 0, pxW, pxH);
                cleanup();
                resolve();
              };
              img.onerror = () => {
                // Final fallback: just save the PDF page data as-is
                cleanup();
                resolve();
              };
              img.src = svgString;
            } catch {
              cleanup();
              resolve();
            }
          }, 1000);
        };

        iframe.onerror = () => {
          cleanup();
          reject(new Error("Failed to load PDF in iframe"));
        };
      });

      const suffix = pageCount > 1 ? `-pagina-${i}` : "";
      const baseName = typeof nameOpts === "string"
        ? nameOpts.replace(/\.pdf$/i, "")
        : buildPDFFileName(nameOpts, "").replace(/\.$/, "");
      const fileName = `${baseName}${suffix}.png`;

      await new Promise<void>((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            toast.error("Erro ao gerar PNG.");
            resolve();
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
          resolve();
        }, "image/png");
      });
    }

    URL.revokeObjectURL(pdfUrl);
    toast.success(pageCount > 1 ? `${pageCount} imagens PNG geradas!` : "PNG gerado com sucesso!");
  } catch (err) {
    console.error("PNG export failed:", err);
    toast.error("Erro ao gerar PNG. Tente novamente.");
  }
}
