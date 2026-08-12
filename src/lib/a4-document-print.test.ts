import { describe, expect, it } from "vitest";
import { buildA4DocumentHtml } from "./a4-document-print";

describe("buildA4DocumentHtml", () => {
  it("builds a semantic A4 document with company, title, issue time and table data", () => {
    const html = buildA4DocumentHtml({
      companyName: "Backstage Pro",
      title: "Relatório financeiro",
      subtitle: "Agosto de 2026",
      metrics: [{ label: "Total", value: "R$ 100,00" }],
      sections: [{ columns: ["Evento", "Valor"], rows: [["Festival", "R$ 100,00"]] }],
    });

    expect(html).toContain("size: A4 portrait");
    expect(html).toContain("Backstage Pro");
    expect(html).toContain("Relatório financeiro");
    expect(html).toContain("Emitido em");
    expect(html).toContain("Festival");
  });

  it("escapes user-controlled values", () => {
    const html = buildA4DocumentHtml({
      companyName: "<Empresa>",
      title: "Relatório",
      sections: [{ columns: ["Nome"], rows: [["<script>alert(1)</script>"]] }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
