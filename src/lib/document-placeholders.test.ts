import { describe, expect, it, vi } from "vitest";
import {
  buildDocumentPlaceholderContext,
  COMPANY_DOCUMENT_PLACEHOLDERS,
  FINANCIAL_DOCUMENT_PLACEHOLDERS,
  resolveDocumentTemplateContent,
  type DocumentCompanyData,
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
  company?: DocumentCompanyData | null,
) {
  return resolveDocumentTemplateContent({
    templateContent,
    event,
    companyName: "Backstage Produções",
    company,
    loadFinancial: vi.fn().mockResolvedValue(financialData),
    currentDate,
  });
}

const fullCompany: DocumentCompanyData = {
  nome_empresa: "Alex Produções",
  razao_social: "Alex Produções Artísticas LTDA",
  cpf_cnpj: "12345678000190",
  email: "contato@alex.com",
  telefone: "(11) 4002-8922",
  whatsapp: "(11) 99999-0000",
  cep: "01310100",
  endereco: "Av. Paulista",
  numero: "1000",
  complemento: "Sala 12",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  estado: "SP",
};

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

describe("company placeholder resolution (Documentos <- empresa atual)", () => {
  it("fills every {{empresa_*}} placeholder from the current company data", async () => {
    const output = await render(
      COMPANY_DOCUMENT_PLACEHOLDERS.join("\n"),
      null,
      fullCompany,
    );

    expect(output).toBe(
      [
        "Alex Produções",
        "Alex Produções Artísticas LTDA",
        "12.345.678/0001-90",
        "12.345.678/0001-90",
        "(11) 4002-8922",
        "(11) 99999-0000",
        "contato@alex.com",
        "01310-100",
        "Av. Paulista, 1000, Sala 12 — Bela Vista — São Paulo/SP — CEP 01310-100",
        "Bela Vista",
        "São Paulo",
        "SP",
        "São Paulo/SP",
      ].join("\n"),
    );
  });

  it("uses the new company name over the legacy companyName fallback", async () => {
    expect(await render("{{empresa_nome}}", null, fullCompany)).toBe("Alex Produções");
  });

  it("falls back to companyName for {{empresa_nome}} when no company data is provided", async () => {
    expect(await render("{{empresa_nome}}", null)).toBe("Backstage Produções");
    expect(await render("{{empresa_nome}}", null, null)).toBe("Backstage Produções");
  });

  it("leaves optional company fields blank without keeping any {{...}} in the document", async () => {
    const output = await render(
      "Empresa: {{empresa_nome}} | CNPJ: {{empresa_cnpj}} | End.: {{empresa_endereco}} | Tel.: {{empresa_telefone}}",
      null,
      { nome_empresa: "Alex Produções" },
    );

    expect(output).toBe("Empresa: Alex Produções | CNPJ:  | End.:  | Tel.: ");
    expect(output).not.toMatch(/{{[^}]+}}/);
  });

  it("resolves partial company data (some fields present, others null)", () => {
    const context = buildDocumentPlaceholderContext({
      event,
      companyName: "Backstage Produções",
      company: { nome_empresa: null, telefone: "1140028922", cidade: "Campinas", estado: "SP" },
      financial: null,
      currentDate,
    });

    expect(context["{{empresa_nome}}"]).toBe("Backstage Produções");
    expect(context["{{empresa_telefone}}"]).toBe("1140028922");
    expect(context["{{empresa_cidade_uf}}"]).toBe("Campinas/SP");
    // endereço "completo" cai para só a cidade/UF quando não há logradouro
    expect(context["{{empresa_endereco}}"]).toBe("Campinas/SP");
    expect(context["{{empresa_cnpj}}"]).toBe("");
    expect(context["{{empresa_email}}"]).toBe("");
  });

  it("keeps {{empresa_endereco}} empty when the company has no address at all", () => {
    const context = buildDocumentPlaceholderContext({
      event,
      companyName: "Backstage Produções",
      company: { nome_empresa: "Alex Produções", telefone: "1140028922" },
      financial: null,
      currentDate,
    });

    expect(context["{{empresa_endereco}}"]).toBe("");
    expect(context["{{empresa_cidade_uf}}"]).toBe("");
  });
});
