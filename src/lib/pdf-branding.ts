import type jsPDF from "jspdf";

export interface PdfBranding {
  empresaNome?: string | null;
  empresaLogoUrl?: string | null;
}

/**
 * Loads an image URL and returns a base64 data URL.
 * Returns null if loading fails.
 */
export function loadImageAsBase64(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Adds company branding header to a jsPDF document.
 * Returns the Y position after the header for subsequent content.
 */
export async function addBrandingHeader(
  doc: jsPDF,
  branding: PdfBranding,
  fallbackTitle: string
): Promise<number> {
  const name = branding.empresaNome?.trim() || fallbackTitle;
  const y = 14;

  if (branding.empresaLogoUrl) {
    const logoData = await loadImageAsBase64(branding.empresaLogoUrl);
    if (logoData) {
      const logoHeight = 16;
      const logoWidth = 16;
      doc.addImage(logoData, "PNG", 14, y - 4, logoWidth, logoHeight);
      doc.setFontSize(16);
      doc.text(name, 14 + logoWidth + 4, y + 8);
      return y + logoHeight + 6;
    }
  }

  // No logo — just text
  doc.setFontSize(16);
  doc.text(name, 14, y + 8);
  return y + 14;
}
