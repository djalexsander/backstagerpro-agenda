import { describe, expect, it, vi } from "vitest";

const { printHtmlDocumentMock } = vi.hoisted(() => ({ printHtmlDocumentMock: vi.fn() }));
vi.mock("./printer-service", () => ({ printHtmlDocument: printHtmlDocumentMock }));

import { buildRentalReceiptHtml, printRentalReceipt } from "./rental-receipt-print";
import type { RentalDetail } from "./material-rental-types";

// Same formatter as rental-receipt-print.ts - Node's pt-BR ICU data uses a
// non-breaking space between "R$" and the digits, so build the expected
// string through the same Intl.NumberFormat instead of a literal with a
// regular space.
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const rental: RentalDetail = {
  id: "r1",
  empresa_id: "e1",
  cliente_id: "c1",
  numero: "LOC-2026-000042",
  status: "em_andamento",
  retirada_prevista_em: "2026-08-07T15:00:00.000Z",
  devolucao_prevista_em: "2026-08-09T15:00:00.000Z",
  responsavel_nome: "Alex",
  valor_total: 2400,
  cliente_nome: "Cliente Um",
  cliente_nome_fantasia: null,
  quantidade_itens: 1,
  quantidade_retirada: 6,
  quantidade_devolvida: 2,
  quantidade_com_cliente: 4,
  atrasada: false,
  observacoes: "Retirar às 8h",
  valor_bruto: 2400,
  desconto: 0,
  cliente: {
    id: "c1",
    tipo_pessoa: "pessoa_fisica",
    nome: "Cliente Um",
    nome_fantasia: null,
    cpf_cnpj: null,
    email: null,
    telefone: null,
    observacoes: null,
    ativo: true,
  },
  evento: null,
  itens: [
    {
      id: "item1",
      material_id: "m1",
      quantidade_contratada: 6,
      modalidade_cobranca: "fixo",
      unidades_cobranca: 1,
      valor_unitario: 2400,
      desconto: 0,
      subtotal: 2400,
      observacoes: null,
      quantidade_retirada: 6,
      quantidade_devolvida: 2,
      quantidade_com_cliente: 4,
      quantidade_pendente_retirada: 0,
      material: {
        id: "m1",
        nome: "Line Array Neo 210",
        codigo_interno: "0001",
        tipo_controle: "quantidade",
        unidade_medida: "un",
        numero_serie: null,
        numero_patrimonio: null,
        codigo_barras: null,
        identificador_unico: "abc",
      },
    },
  ],
  custodias: [],
  historico: [],
};

describe("buildRentalReceiptHtml", () => {
  it("uses this exact rental's data, not a placeholder or another rental's", () => {
    const html = buildRentalReceiptHtml(rental, "Backstage Pro", "comprovante", null);
    expect(html).toContain("LOC-2026-000042");
    expect(html).toContain("Cliente Um");
    expect(html).toContain("Line Array Neo 210");
    expect(html).toContain("Backstage Pro");
  });

  it("shows quantidade_retirada for the retirada receipt and quantidade_devolvida for the devolucao receipt", () => {
    const retirada = buildRentalReceiptHtml(rental, "Backstage Pro", "retirada", null);
    expect(retirada).toContain("6 de 6");

    const devolucao = buildRentalReceiptHtml(rental, "Backstage Pro", "devolucao", null);
    expect(devolucao).toContain("2 de 6");
  });

  it("includes the financial block only when a financial summary is supplied", () => {
    const withoutFinance = buildRentalReceiptHtml(rental, "Backstage Pro", "comprovante", null);
    expect(withoutFinance).not.toContain("Situação financeira");

    const withFinance = buildRentalReceiptHtml(rental, "Backstage Pro", "comprovante", {
      id: "f1",
      origem_tipo: "locacao_material",
      origem_id: "r1",
      cliente_id: "c1",
      valor_original: 2400,
      valor_recebido: 1000,
      status: "parcial",
      vencimento: null,
      forma_pagamento: "pix",
      recebimentos: [], forma_cobranca: "a_vista", valor_estornado: 0, requer_revisao_vencimento: false, parcelas: [],
    });
    expect(withFinance).toContain("Situação financeira");
    expect(withFinance).toContain(money.format(1000));
  });

  it("escapes HTML in free-text fields to avoid breaking the printable layout", () => {
    const html = buildRentalReceiptHtml(
      { ...rental, observacoes: "<script>alert(1)</script>" },
      "Backstage Pro",
      "comprovante",
      null,
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it.each([58, 80])("uses the requested %smm width instead of hard-coding 80mm", (widthMm) => {
    const html = buildRentalReceiptHtml(rental, "Backstage Pro", "comprovante", null, { widthMm });
    expect(html).toContain(`size: ${widthMm}mm auto`);
    expect(html).toContain(`width: ${widthMm}mm`);
  });

  it("uses compact physical columns and reduced padding at 58mm", () => {
    const html = buildRentalReceiptHtml(rental, "Backstage Pro", "comprovante", null, { widthMm: 58 });

    expect(html).toContain("padding: 1.5mm 1.5mm 1.2mm");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr) 9mm 9mm 17mm");
    expect(html).toContain("column-gap: 0.6mm");
  });

  it("uses wider explicit columns at 80mm", () => {
    const html = buildRentalReceiptHtml(rental, "Backstage Pro", "comprovante", null, { widthMm: 80 });

    expect(html).toContain("padding: 1.5mm 1.4mm 1.2mm");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr) 11mm 11mm 21mm");
    expect(html).toContain("column-gap: 0.8mm");
  });

  it("uses high-contrast semibold thermal typography at 58mm", () => {
    const html = buildRentalReceiptHtml(rental, "Backstage Pro", "comprovante", null, { widthMm: 58 });

    expect(html).toContain("font-size: 10.5px; line-height: 1.25; color: #000; font-weight: 600; opacity: 1");
    expect(html).toContain(".sheet, .sheet * { color: #000; opacity: 1; }");
    expect(html).toContain("font-size: 9.25px; line-height: 1.1; font-weight: 700");
    expect(html).toContain("font-size: 9.5px; font-weight: 600");
    expect(html).toContain("font-size: 10.25px; font-weight: 600; color: #000");
  });

  it("uses the slightly larger thermal typography at 80mm without changing its grid", () => {
    const html = buildRentalReceiptHtml(rental, "Backstage Pro", "comprovante", null, { widthMm: 80 });

    expect(html).toContain("font-size: 12.25px; line-height: 1.25; color: #000; font-weight: 600; opacity: 1");
    expect(html).toContain("font-size: 10.75px; line-height: 1.1; font-weight: 700");
    expect(html).toContain("font-size: 11.25px; font-weight: 600");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr) 11mm 11mm 21mm");
  });

  it("keeps fixed material columns while allowing only a long material name to wrap", () => {
    const longName = "Sistema de line array ativo com subwoofer e acessórios para montagem externa";
    const html = buildRentalReceiptHtml(
      {
        ...rental,
        itens: [
          rental.itens[0],
          {
            ...rental.itens[0],
            id: "item2",
            material: { ...rental.itens[0].material, nome: longName },
          },
        ],
      },
      "Backstage Pro",
      "comprovante",
      null,
      { widthMm: 58 },
    );

    expect(html).toContain("Line Array Neo 210");
    expect(html).toContain(longName);
    expect(html).toMatch(/\.item-material \{[^}]*white-space: normal/);
    expect(html).toMatch(/\.item-code \{[^}]*white-space: nowrap/);
    expect(html).toMatch(/\.item-quantity \{[^}]*text-align: center[^}]*white-space: nowrap/);
    expect(html).toMatch(/\.item-subtotal \{[^}]*text-align: right[^}]*white-space: nowrap/);
  });

  it("keeps large monetary values inside dedicated right-aligned columns", () => {
    const largeValue = 1_234_567.89;
    const html = buildRentalReceiptHtml(
      {
        ...rental,
        valor_total: largeValue,
        itens: [{ ...rental.itens[0], subtotal: largeValue }],
      },
      "Backstage Pro",
      "comprovante",
      {
        id: "f-large",
        origem_tipo: "locacao_material",
        origem_id: "r1",
        cliente_id: "c1",
        valor_original: largeValue,
        valor_recebido: 123_456.78,
        status: "parcial",
        vencimento: null,
        forma_pagamento: "pix",
        recebimentos: [], forma_cobranca: "a_vista", valor_estornado: 0, requer_revisao_vencimento: false, parcelas: [],
      },
      { widthMm: 58 },
    );

    expect(html).toContain(money.format(largeValue));
    expect(html).toContain('class="item-subtotal"');
    expect(html).toContain('class="total-row"');
    expect(html).toContain('class="amount-row amount-primary"');
  });

  it.each([58, 80])("keeps long party names, a six-character code and R$ 125.450,00 structurally separated at %smm", (widthMm) => {
    const largeValue = 125_450;
    const longClientName = "Cliente Corporativo Produções Artísticas e Eventos Especiais";
    const longResponsibleName = "Alexandre Responsável Operacional de Equipamentos";
    const html = buildRentalReceiptHtml(
      {
        ...rental,
        valor_total: largeValue,
        responsavel_nome: longResponsibleName,
        cliente: { ...rental.cliente, nome: longClientName },
        itens: [
          {
            ...rental.itens[0],
            subtotal: largeValue,
            material: {
              ...rental.itens[0].material,
              nome: "Sistema profissional de line array para eventos de grande porte",
              codigo_interno: "MAT123",
            },
          },
        ],
      },
      "Backstage Pro",
      "comprovante",
      null,
      { widthMm },
    );

    expect(html).toContain(longClientName);
    expect(html).toContain(longResponsibleName);
    expect(html).toContain('<span class="item-code" role="cell">MAT123</span>');
    expect(html).toContain(`<span class="item-subtotal" role="cell">${money.format(largeValue)}</span>`);
    expect(html).toContain(`<div class="total-row"><strong>Valor total</strong><strong>${money.format(largeValue)}</strong></div>`);
    expect(html).toMatch(/\.detail-value \{[^}]*min-width: 0[^}]*overflow-wrap: anywhere/);
    expect(html).toMatch(/\.date-value \{[^}]*white-space: nowrap/);
    expect(html).toMatch(/\.item-code \{[^}]*white-space: nowrap/);
    expect(html).toMatch(/\.item-quantity \{[^}]*text-align: center/);
    expect(html).toMatch(/\.item-subtotal \{[^}]*text-align: right[^}]*white-space: nowrap/);
  });

  it("formats issue, pickup and return dates without commas or seconds", () => {
    const html = buildRentalReceiptHtml(rental, "Backstage Pro", "comprovante", null, { widthMm: 58 });
    const dates = Array.from(html.matchAll(/class="detail-value date-value">([^<]+)</g), (match) => match[1]);

    expect(dates).toHaveLength(3);
    dates.forEach((value) => expect(value).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/));
  });

  it("renders section rules below titles and ends shortly after the signature", () => {
    const html = buildRentalReceiptHtml(
      rental,
      "Backstage Pro",
      "comprovante",
      {
        id: "f1",
        origem_tipo: "locacao_material",
        origem_id: "r1",
        cliente_id: "c1",
        valor_original: 2400,
        valor_recebido: 1000,
        status: "parcial",
        vencimento: null,
        forma_pagamento: "pix",
        recebimentos: [], forma_cobranca: "a_vista", valor_estornado: 0, requer_revisao_vencimento: false, parcelas: [],
      },
    );

    expect(html).toContain('<div class="section-heading"><h3>Materiais</h3><div class="section-rule"></div></div>');
    expect(html).toContain('<div class="section-heading"><h3>Situação financeira</h3><div class="section-rule"></div></div>');
    expect(html).not.toMatch(/h3 \{[^}]*border/);
    expect(html).toContain("padding: 1.5mm 1.4mm 1.2mm");
    expect(html).toContain(".section-heading { margin: 1.5mm 0 0.5mm; }");
    expect(html).toMatch(/h3 \{[^}]*margin: 0 0 1\.2mm/);
    expect(html).toContain('<div class="signature"><div class="signature-line"></div>Assinatura do cliente</div>');
  });

  it.each([
    ["comprovante", "COMPROVANTE DE LOCAÇÃO"],
    ["retirada", "COMPROVANTE DE RETIRADA"],
    ["devolucao", "COMPROVANTE DE DEVOLUÇÃO"],
  ] as const)("uses the centered shared thermal header for %s", (kind, title) => {
    const html = buildRentalReceiptHtml(rental, "Backstage Pro", kind, null);
    expect(html).toContain('<header class="receipt-header">');
    expect(html).toContain(`<p class="receipt-title">${title}</p>`);
  });

  it.each(["comprovante", "retirada", "devolucao"] as const)("routes %s through the canonical cupom purpose", async (kind) => {
    printHtmlDocumentMock.mockResolvedValue(undefined);
    await printRentalReceipt({ companyId: "e1", rental, empresaNome: "Backstage Pro", kind, financial: null });

    const options = printHtmlDocumentMock.mock.calls.at(-1)?.[0];
    expect(options).toEqual(expect.objectContaining({
      companyId: "e1",
      purpose: "cupom",
      dynamicHeight: true,
    }));
    expect(options.html({ widthMm: 58 })).toContain("width: 58mm");
  });
});
