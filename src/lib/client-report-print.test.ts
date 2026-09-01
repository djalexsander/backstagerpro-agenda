import { describe, expect, it } from "vitest";
import { buildClientReportHtml } from "./client-report-print";
import type { CustomerOption, RentalListItem } from "./material-rental-types";
import type { ClientReceivableSummary } from "./financial-ledger-types";

// Same formatter as client-report-print.ts: Node's pt-BR ICU data inserts a
// non-breaking space ( ) between "R$" and the digits, so a literal
// "R$ 800,00" (regular space) would never match - format through the same
// Intl.NumberFormat instead of hardcoding the separator.
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const client: CustomerOption = {
  id: "c1",
  tipo_pessoa: "pessoa_fisica",
  nome: "Cliente Um",
  nome_fantasia: null,
  cpf_cnpj: "123.456.789-00",
  email: "cliente1@example.com",
  telefone: "11999990000",
  observacoes: null,
  ativo: true,
};

const otherClient: CustomerOption = {
  ...client,
  id: "c2",
  nome: "Cliente Dois",
};

function rental(overrides: Partial<RentalListItem>): RentalListItem {
  return {
    id: "r1",
    empresa_id: "e1",
    cliente_id: "c1",
    numero: "LOC-0001",
    status: "concluida",
    retirada_prevista_em: "2026-07-01T12:00:00.000Z",
    devolucao_prevista_em: "2026-07-03T12:00:00.000Z",
    responsavel_nome: "Alex",
    valor_total: 500,
    cliente_nome: "Cliente Um",
    cliente_nome_fantasia: null,
    quantidade_itens: 2,
    quantidade_retirada: 2,
    quantidade_devolvida: 2,
    quantidade_com_cliente: 0,
    atrasada: false,
    ...overrides,
  };
}

describe("buildClientReportHtml", () => {
  it("uses this exact client's identifying data, not another client's", () => {
    const html = buildClientReportHtml("Backstage Pro", client, [], null);
    expect(html).toContain("Cliente Um");
    expect(html).toContain("123.456.789-00");
    expect(html).toContain("cliente1@example.com");
    expect(html).not.toContain("Cliente Dois");

    const htmlForOther = buildClientReportHtml("Backstage Pro", otherClient, [], null);
    expect(htmlForOther).toContain("Cliente Dois");
  });

  it("omits cpf/telefone/email fields entirely when the client doesn't have them", () => {
    const html = buildClientReportHtml(
      "Backstage Pro",
      { ...client, cpf_cnpj: null, telefone: null, email: null },
      [],
      null,
    );
    expect(html).not.toContain("CPF/CNPJ");
    expect(html).not.toContain("Telefone");
    expect(html).not.toContain("E-mail");
  });

  it("sums the total value only from this client's rentals and excludes cancelled ones from the summary", () => {
    const rentals = [
      rental({ id: "r1", valor_total: 500, status: "concluida" }),
      rental({ id: "r2", valor_total: 300, status: "em_andamento" }),
      rental({ id: "r3", valor_total: 999, status: "cancelada" }),
    ];
    const html = buildClientReportHtml("Backstage Pro", client, rentals, null);
    expect(html).toContain(money.format(800));
    expect(html).not.toContain(money.format(1799));
  });

  it("still lists cancelled rentals in the history table even though they're excluded from the summary total", () => {
    const rentals = [rental({ id: "r3", numero: "LOC-0003", status: "cancelada" })];
    const html = buildClientReportHtml("Backstage Pro", client, rentals, null);
    expect(html).toContain("LOC-0003");
  });

  it("shows 'Financeiro não integrado' when no receivable summary is available, and real totals when it is", () => {
    const withoutFinance = buildClientReportHtml("Backstage Pro", client, [], null);
    expect(withoutFinance).toContain("Financeiro não integrado");

    const receivable: ClientReceivableSummary = {
      cliente_id: "c1",
      cliente_nome: "Cliente Um",
      cliente_nome_fantasia: null,
      total_pendente_regularizacao: 0,
      quantidade_titulos: 1,
      total_devido: 200,
      total_vencido: 0,
      proximo_vencimento: null,
    };
    const rentals = [rental({ valor_total: 500 })];
    const withFinance = buildClientReportHtml("Backstage Pro", client, rentals, receivable);
    expect(withFinance).not.toContain("Financeiro não integrado");
    expect(withFinance).toContain(money.format(200));
    expect(withFinance).toContain(money.format(300));
  });
});
