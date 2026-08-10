import { describe, expect, it } from "vitest";
import { buildRentalReceiptHtml } from "./rental-receipt-print";
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
      recebimentos: [],
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
});
