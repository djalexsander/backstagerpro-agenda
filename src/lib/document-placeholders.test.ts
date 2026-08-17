import { describe, expect, it, vi } from "vitest";
import {
  FINANCIAL_DOCUMENT_PLACEHOLDERS,
  resolveDocumentTemplateContent,
  type DocumentEventData,
  type DocumentFinancialData,
} from "./document-placeholders";

const event: DocumentEventData = {
  name: "Festival Backstage",
  date: "2026-08-17",
  city: "São Paulo",
  venue: "Arena Central",
  artist: "Banda Teste",
  show_time: "21:30:00",
  observations: "Passagem de som às 17h",
};

const financial: DocumentFinancialData = {
  cache: 12500.5,
  transport: 850,
  food: 320.25,
  lodging: 640,
};

const currentDate = new Date(2026, 7, 17, 12, 0, 0);

async function render(
  templateContent: string,
  financialData: DocumentFinancialData | null = financial,
) {
  return resolveDocumentTemplateContent({
    templateContent,
    event,
    companyName: "Backstage Produções",
    loadFinancial: vi.fn().mockResolvedValue(financialData),
    currentDate,
  });
}

describe("document placeholder resolution", () => {
  it("fills the cache placeholder after financial data resolves", async () => {
    expect(await render("Cachê: {{cache}}"))
      .toBe("Cachê: R$ 12.500,50");
  });

  it("fills the transport placeholder", async () => {
    expect(await render("Transporte: {{transporte}}"))
      .toBe("Transporte: R$ 850,00");
  });

  it("fills every other currently supported financial placeholder", async () => {
    const output = await render("{{alimentacao}} | {{hospedagem}}");

    expect(output).toBe("R$ 320,25 | R$ 640,00");
    expect(FINANCIAL_DOCUMENT_PLACEHOLDERS).toEqual([
      "{{cache}}",
      "{{transporte}}",
      "{{alimentacao}}",
      "{{hospedagem}}",
    ]);
  });

  it("formats a real zero instead of turning it into an empty value", async () => {
    const zeroes: DocumentFinancialData = {
      cache: 0,
      transport: 0,
      food: 0,
      lodging: 0,
    };

    expect(await render(FINANCIAL_DOCUMENT_PLACEHOLDERS.join(" | "), zeroes))
      .toBe("R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00");
  });

  it("keeps the established empty behavior when no financial row exists", async () => {
    expect(await render("{{cache}}/{{transporte}}/{{alimentacao}}/{{hospedagem}}", null))
      .toBe("///");
  });

  it("preserves all non-financial placeholders", async () => {
    const output = await render(
      "{{evento_nome}}|{{evento_data}}|{{evento_cidade}}|{{evento_local}}|" +
      "{{artista}}|{{horario_show}}|{{empresa_nome}}|{{data_atual}}|{{observacoes}}",
    );

    expect(output).toBe(
      "Festival Backstage|17/08/2026|São Paulo|Arena Central|Banda Teste|" +
      "21:30:00|Backstage Produções|17/08/2026|Passagem de som às 17h",
    );
  });

  it("waits for finance and returns one resolved content for persistence, preview and export", async () => {
    let releaseFinancial!: (value: DocumentFinancialData) => void;
    const loadFinancial = vi.fn(() => new Promise<DocumentFinancialData>((resolve) => {
      releaseFinancial = resolve;
    }));
    let settled = false;
    const contentPromise = resolveDocumentTemplateContent({
      templateContent: "{{evento_nome}} — {{cache}}",
      event,
      companyName: "Backstage Produções",
      loadFinancial,
      currentDate,
    }).then((content) => {
      settled = true;
      return content;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    releaseFinancial(financial);
    const finalContent = await contentPromise;
    const persistedDocument = { conteudo_final: finalContent };
    const previewContent = persistedDocument.conteudo_final;
    const exportContent = persistedDocument.conteudo_final;

    expect(loadFinancial).toHaveBeenCalledTimes(1);
    expect(persistedDocument.conteudo_final).toBe("Festival Backstage — R$ 12.500,50");
    expect(previewContent).toBe(finalContent);
    expect(exportContent).toBe(finalContent);
    expect(finalContent).not.toMatch(/{{[^}]+}}/);
  });
});
