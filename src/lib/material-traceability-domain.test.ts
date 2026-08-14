import { describe, expect, it } from "vitest";
import {
  buildOndeEstaAgoraSummary,
  describeTimelineEntry,
  formatDateTime,
  situacaoBadgeTone,
  TRACEABILITY_SITUACAO_LABELS,
} from "./material-traceability-domain";
import type { TraceabilitySituacao, TraceabilityTimelineEntry } from "./material-traceability-types";

describe("situacaoBadgeTone", () => {
  it("disponivel is success", () => {
    expect(situacaoBadgeTone("disponivel")).toBe("success");
  });
  it("em_manutencao is warning", () => {
    expect(situacaoBadgeTone("em_manutencao")).toBe("warning");
  });
  it("locado/emprestado are neutral (custody open, not a problem)", () => {
    expect(situacaoBadgeTone("locado")).toBe("neutral");
    expect(situacaoBadgeTone("emprestado")).toBe("neutral");
  });
  it("manually-flagged statuses are destructive", () => {
    expect(situacaoBadgeTone("avariado")).toBe("destructive");
    expect(situacaoBadgeTone("extraviado")).toBe("destructive");
    expect(situacaoBadgeTone("baixado")).toBe("destructive");
  });
});

describe("formatDateTime", () => {
  it("returns an em-dash placeholder for null/undefined", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
  it("formats a real timestamp to something other than the placeholder", () => {
    expect(formatDateTime("2026-08-14T18:42:00Z")).not.toBe("—");
  });
});

describe("buildOndeEstaAgoraSummary", () => {
  it("disponivel with a balance shows the location and no return info when the material was never checked out", () => {
    const resumo: TraceabilitySituacao = {
      situacao: "disponivel",
      localizacoes: [{ localizacao_id: "l1", localizacao_codigo: "EST-A", localizacao_nome: "Estoque Principal" }],
      ultimo_retorno_em: null,
      ultimo_retorno_recebido_por: null,
    };
    const summary = buildOndeEstaAgoraSummary(resumo);
    expect(summary.headline).toBe("Disponível");
    expect(summary.linhas).toEqual([{ label: "Localização", value: "Estoque Principal" }]);
  });

  it("disponivel with no stock balance falls back to an explicit empty-stock message, not a blank field", () => {
    const resumo: TraceabilitySituacao = {
      situacao: "disponivel",
      localizacoes: [],
      ultimo_retorno_em: "2026-08-14T03:20:00Z",
      ultimo_retorno_recebido_por: "Carlos",
    };
    const summary = buildOndeEstaAgoraSummary(resumo);
    expect(summary.linhas[0]).toEqual({ label: "Localização", value: "Sem saldo em estoque" });
    expect(summary.linhas).toEqual(
      expect.arrayContaining([{ label: "Recebido por", value: "Carlos" }]),
    );
  });

  it("locado with a linked rental surfaces the rental number, client, and an overdue marker", () => {
    const resumo: TraceabilitySituacao = {
      situacao: "locado",
      custodia_id: "c1",
      custodia_status: "aberta",
      finalidade: "locacao",
      retirada_em: "2026-08-14T18:42:00Z",
      previsao_retorno: "2026-08-16T08:00:00Z",
      atrasado: true,
      retirado_por: "João da Silva",
      liberado_por: "Alex",
      locacao: { locacao_id: "r1", locacao_numero: "LOC-2026-000234", cliente_id: "cl1", cliente_nome: "Empresa XYZ" },
    };
    const summary = buildOndeEstaAgoraSummary(resumo);
    expect(summary.headline).toBe("Locado");
    expect(summary.linhas).toEqual(
      expect.arrayContaining([
        { label: "Locação", value: "LOC-2026-000234" },
        { label: "Cliente", value: "Empresa XYZ" },
        { label: "Retirado por", value: "João da Silva" },
        { label: "Liberado por", value: "Alex" },
      ]),
    );
    expect(summary.linhas.find((linha) => linha.label === "Previsão de retorno")?.value).toContain("Atrasado");
  });

  it("emprestado without a linked rental omits the locação/cliente lines entirely", () => {
    const resumo: TraceabilitySituacao = {
      situacao: "emprestado",
      custodia_id: "c2",
      custodia_status: "aberta",
      finalidade: "uso_interno",
      retirada_em: "2026-08-14T10:00:00Z",
      previsao_retorno: null,
      atrasado: false,
      retirado_por: "Maria",
      liberado_por: "Alex",
      locacao: null,
    };
    const summary = buildOndeEstaAgoraSummary(resumo);
    expect(summary.headline).toBe("Emprestado");
    expect(summary.linhas.some((linha) => linha.label === "Locação")).toBe(false);
    expect(summary.linhas.some((linha) => linha.label === "Previsão de retorno")).toBe(false);
  });

  it("em_manutencao surfaces the OS number and status", () => {
    const resumo: TraceabilitySituacao = {
      situacao: "em_manutencao",
      manutencao_numero: "MAN-2026-000123",
      manutencao_status: "em_manutencao",
      manutencao_aberta_em: "2026-08-14T09:00:00Z",
      manutencao_previsao_conclusao_em: null,
      manutencao_responsavel_nome: null,
    };
    const summary = buildOndeEstaAgoraSummary(resumo);
    expect(summary.headline).toBe("Em manutenção");
    expect(summary.linhas).toEqual(
      expect.arrayContaining([{ label: "Ordem de serviço", value: "MAN-2026-000123" }]),
    );
  });

  it("a manually-set status (avariado) surfaces the justificativa when present", () => {
    const resumo: TraceabilitySituacao = { situacao: "avariado", justificativa_status: "Caiu durante o transporte" };
    const summary = buildOndeEstaAgoraSummary(resumo);
    expect(summary.headline).toBe(TRACEABILITY_SITUACAO_LABELS.avariado);
    expect(summary.linhas).toEqual([{ label: "Justificativa", value: "Caiu durante o transporte" }]);
  });

  it("a manually-set status without justificativa renders no extra lines (never invents one)", () => {
    const resumo: TraceabilitySituacao = { situacao: "baixado", justificativa_status: null };
    const summary = buildOndeEstaAgoraSummary(resumo);
    expect(summary.linhas).toEqual([]);
  });
});

describe("describeTimelineEntry", () => {
  it("describes a checkout tied to a rental with client and who released it", () => {
    const entry: TraceabilityTimelineEntry = {
      data: "2026-08-14T18:42:00Z",
      tipo: "checkout",
      detalhes: {
        responsavel_nome: "João Silva",
        locacao_numero: "LOC-2026-000123",
        cliente_nome: "Empresa X",
        executor_nome: "Alex",
      },
    };
    expect(describeTimelineEntry(entry)).toBe(
      "Retirado por João Silva · Locação LOC-2026-000123 · Cliente: Empresa X · Liberado por Alex",
    );
  });

  it("describes a checkout with no rental link (plain loan) without a locação/cliente segment", () => {
    const entry: TraceabilityTimelineEntry = {
      data: "2026-08-14T10:00:00Z",
      tipo: "checkout",
      detalhes: { responsavel_nome: "Maria", executor_nome: "Alex" },
    };
    expect(describeTimelineEntry(entry)).toBe("Retirado por Maria · Liberado por Alex");
  });

  it("describes a checkin with who received it", () => {
    const entry: TraceabilityTimelineEntry = {
      data: "2026-08-16T02:15:00Z",
      tipo: "checkin",
      detalhes: { executor_nome: "Carlos" },
    };
    expect(describeTimelineEntry(entry)).toBe("Recebido por Carlos");
  });

  it("describes a maintenance opening without duplicating the OS prefix already in the number", () => {
    const entry: TraceabilityTimelineEntry = {
      data: "2026-08-20T00:00:00Z",
      tipo: "manutencao_aberta",
      detalhes: { numero: "MAN-2026-000123", defeito_relatado: "Conector danificado" },
    };
    expect(describeTimelineEntry(entry)).toBe("MAN-2026-000123 · Conector danificado");
  });

  it("describes an RFID tag deactivation with its reason", () => {
    const entry: TraceabilityTimelineEntry = {
      data: "2026-08-20T00:00:00Z",
      tipo: "rfid_tag_desativada",
      detalhes: { epc: "AABBCCDD11223344", motivo_desativacao: "Tag danificada" },
    };
    expect(describeTimelineEntry(entry)).toBe("EPC AABBCCDD11223344 · Tag danificada");
  });

  it("describes a stock movement not sourced from checkin/checkout", () => {
    const entry: TraceabilityTimelineEntry = {
      data: "2026-08-01T00:00:00Z",
      tipo: "movimentacao_estoque",
      detalhes: { tipo_movimentacao: "entrada", localizacao_destino_nome: "Estoque Principal" },
    };
    expect(describeTimelineEntry(entry)).toBe("entrada · Para: Estoque Principal");
  });
});
