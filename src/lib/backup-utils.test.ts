import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_SYSTEM,
  BACKUP_VERSION,
  buildBackupPayload,
  getBackupSummary,
  getLastLocalBackupTime,
  normalizeBackup,
  prepareBackupForRestore,
  setLastLocalBackupTime,
  validateBackup,
  type BackupData,
} from "./backup-utils";

const tenantA = "123e4567-e89b-42d3-a456-426614174000";
const tenantB = "223e4567-e89b-42d3-a456-426614174000";

function sampleData(empresaId = tenantA): BackupData {
  return {
    eventos: [{ id: "event-1", empresa_id: empresaId }] as BackupData["eventos"],
    event_days: [
      { id: "day-1", event_id: "event-1", empresa_id: empresaId },
    ] as BackupData["event_days"],
    event_files: [
      { id: "file-1", event_id: "event-1", empresa_id: empresaId },
    ] as BackupData["event_files"],
    financials: [
      { id: "financial-1", event_id: "event-1", empresa_id: empresaId },
    ] as BackupData["financials"],
  };
}

// Includes the six 1.1 collections (P1-10), unlike sampleData() above which
// intentionally stays minimal so tests can still exercise the pre-1.1
// (undefined-collection) shape.
function sampleExtendedData(empresaId = tenantA): BackupData {
  return {
    ...sampleData(empresaId),
    clientes: [
      { id: "client-1", empresa_id: empresaId, nome: "Cliente 1" },
    ] as NonNullable<BackupData["clientes"]>,
    funcionarios: [
      { id: "employee-1", empresa_id: empresaId, nome: "Funcionário 1" },
    ] as NonNullable<BackupData["funcionarios"]>,
    event_funcionarios: [
      { id: "link-1", event_id: "event-1", funcionario_id: "employee-1", empresa_id: empresaId },
    ] as NonNullable<BackupData["event_funcionarios"]>,
    event_checklist_items: [
      { id: "check-1", event_id: "event-1", empresa_id: empresaId, categoria: "som", descricao: "Testar PA" },
    ] as NonNullable<BackupData["event_checklist_items"]>,
    document_templates: [
      { id: "template-1", empresa_id: empresaId, nome: "Contrato padrão" },
    ] as NonNullable<BackupData["document_templates"]>,
    generated_documents: [
      { id: "doc-1", empresa_id: empresaId, event_id: "event-1", nome: "Contrato Evento 1" },
    ] as NonNullable<BackupData["generated_documents"]>,
  };
}

// Includes the sixteen 1.2 operational-core collections (P1-10B) on top of
// sampleExtendedData(), one minimal row each, enough to exercise
// presence/absence and tenant-override behavior without modeling every
// real FK chain (that is what the pgTAP tests are for).
function sampleFullData(empresaId = tenantA): BackupData {
  return {
    ...sampleExtendedData(empresaId),
    categorias_materiais: [
      { id: "categoria-1", empresa_id: empresaId, nome: "Som" },
    ] as NonNullable<BackupData["categorias_materiais"]>,
    materiais: [
      { id: "material-1", empresa_id: empresaId, categoria_id: "categoria-1", codigo_interno: "SOM-001", nome: "Caixa de som", tipo_controle: "quantidade" },
    ] as NonNullable<BackupData["materiais"]>,
    estoque_localizacoes: [
      { id: "local-1", empresa_id: empresaId, codigo: "ALM01", nome: "Almoxarifado" },
    ] as NonNullable<BackupData["estoque_localizacoes"]>,
    estoque_saldos: [
      { id: "saldo-1", empresa_id: empresaId, material_id: "material-1", localizacao_id: "local-1", quantidade: 5 },
    ] as NonNullable<BackupData["estoque_saldos"]>,
    estoque_movimentacoes: [
      {
        id: "mov-1", empresa_id: empresaId, material_id: "material-1", tipo_movimentacao: "entrada",
        quantidade: 5, client_uuid: "client-uuid-1", payload_hash: "hash-1",
        saldo_total_anterior: 0, saldo_total_posterior: 5,
      },
    ] as NonNullable<BackupData["estoque_movimentacoes"]>,
    material_custodias: [
      {
        id: "custodia-1", empresa_id: empresaId, material_id: "material-1", tipo_controle: "quantidade",
        quantidade_retirada: 1, localizacao_origem_id: "local-1", movimento_saida_id: "mov-1",
        responsavel_nome: "Fulano", responsavel_tipo: "funcionario", finalidade: "uso_interno",
        condicao_saida: "boa", client_uuid: "client-uuid-2", payload_hash: "hash-2",
      },
    ] as NonNullable<BackupData["material_custodias"]>,
    material_custodia_eventos: [
      {
        id: "custodia-evt-1", empresa_id: empresaId, custodia_id: "custodia-1", material_id: "material-1",
        tipo: "checkout", quantidade: 1, executado_por: "00000000-0000-0000-0000-000000000001",
        client_uuid: "client-uuid-3", payload_hash: "hash-3",
      },
    ] as NonNullable<BackupData["material_custodia_eventos"]>,
    material_locacoes: [
      {
        id: "locacao-1", empresa_id: empresaId, cliente_id: "client-1", numero: "LOC-2026-000001",
        responsavel_nome: "Fulano", responsavel_tipo: "funcionario",
        retirada_prevista_em: "2026-01-01T00:00:00.000Z", devolucao_prevista_em: "2026-01-02T00:00:00.000Z",
        client_uuid: "client-uuid-4", payload_hash: "hash-4",
      },
    ] as NonNullable<BackupData["material_locacoes"]>,
    material_locacao_itens: [
      { id: "item-1", empresa_id: empresaId, locacao_id: "locacao-1", material_id: "material-1", quantidade_contratada: 1 },
    ] as NonNullable<BackupData["material_locacao_itens"]>,
    material_locacao_eventos: [
      {
        id: "locacao-evt-1", empresa_id: empresaId, locacao_id: "locacao-1", tipo: "criacao",
        descricao: "Locação criada", executado_por: "00000000-0000-0000-0000-000000000001",
        client_uuid: "client-uuid-5", payload_hash: "hash-5",
      },
    ] as NonNullable<BackupData["material_locacao_eventos"]>,
    manutencao_ordens: [
      {
        id: "ordem-1", empresa_id: empresaId, material_id: "material-1", numero: "MAN-2026-000001",
        tipo: "corretiva", defeito_relatado: "Não liga", tipo_controle: "quantidade", quantidade_afetada: 1,
        client_uuid: "client-uuid-6", payload_hash: "hash-6",
        created_by: "00000000-0000-0000-0000-000000000001", updated_by: "00000000-0000-0000-0000-000000000001",
      },
    ] as NonNullable<BackupData["manutencao_ordens"]>,
    manutencao_ordem_insumos: [
      { id: "insumo-1", empresa_id: empresaId, ordem_id: "ordem-1", descricao: "Fusível", created_by: "00000000-0000-0000-0000-000000000001" },
    ] as NonNullable<BackupData["manutencao_ordem_insumos"]>,
    manutencao_ordem_eventos: [
      {
        id: "ordem-evt-1", empresa_id: empresaId, ordem_id: "ordem-1", tipo: "criacao",
        descricao: "Ordem aberta", executado_por: "00000000-0000-0000-0000-000000000001",
        client_uuid: "client-uuid-7", payload_hash: "hash-7",
      },
    ] as NonNullable<BackupData["manutencao_ordem_eventos"]>,
    financeiro_lancamentos: [
      { id: "lancamento-1", empresa_id: empresaId, origem_tipo: "locacao_material", origem_id: "locacao-1", valor_original: 100 },
    ] as NonNullable<BackupData["financeiro_lancamentos"]>,
    financeiro_parcelas: [
      { id: "parcela-1", empresa_id: empresaId, lancamento_id: "lancamento-1", numero: 1, valor: 100, vencimento: "2026-01-10" },
    ] as NonNullable<BackupData["financeiro_parcelas"]>,
    financeiro_recebimentos: [
      { id: "recebimento-1", empresa_id: empresaId, lancamento_id: "lancamento-1", tipo: "recebimento", valor: 100, client_uuid: "client-uuid-8" },
    ] as NonNullable<BackupData["financeiro_recebimentos"]>,
  };
}

describe("backup payload utilities", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("builds a versioned payload with period metadata", () => {
    const payload = buildBackupPayload(
      tenantA,
      "manual",
      sampleData(),
      "2026-01-01",
      "2026-01-31",
    );

    expect(payload.versao).toBe(BACKUP_VERSION);
    expect(BACKUP_VERSION).toBe("1.2"); // P1-10 bumped "1.0"->"1.1"; P1-10B bumped "1.1"->"1.2"
    expect(payload.sistema).toBe(BACKUP_SYSTEM);
    expect(payload.meta).toMatchObject({
      empresa_id: tenantA,
      tipo: "manual",
      periodo_inicio: "2026-01-01",
      periodo_fim: "2026-01-31",
    });
    expect(payload.meta.data_backup).toEqual(expect.any(String));
  });

  it("normalizes the legacy backup format", () => {
    const normalized = normalizeBackup({
      empresa_id: tenantA,
      data_backup: "2026-07-29T12:00:00.000Z",
      eventos: sampleData().eventos,
    });

    expect(normalized.meta).toEqual({
      empresa_id: tenantA,
      tipo: "manual",
      data_backup: "2026-07-29T12:00:00.000Z",
    });
    expect(normalized.data.eventos).toHaveLength(1);
    expect(normalized.data.financials).toEqual([]);
  });

  it("rejects missing tenant metadata and malformed collections", () => {
    const result = validateBackup({
      versao: "1.0",
      meta: { empresa_id: "", tipo: "manual", data_backup: "now" },
      data: {
        eventos: {},
        event_days: [],
        event_files: "invalid",
        financials: [],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/empresa_id/),
        expect.stringMatching(/eventos/),
        expect.stringMatching(/event_files/),
      ]),
    );
  });

  it("summarizes every backup collection", () => {
    const payload = buildBackupPayload(tenantA, "auto", sampleData());
    expect(getBackupSummary(payload)).toEqual({
      eventos: 1,
      eventDays: 1,
      eventFiles: 1,
      financials: 1,
      clientes: null,
      funcionarios: null,
      event_funcionarios: null,
      event_checklist_items: null,
      document_templates: null,
      generated_documents: null,
      categorias_materiais: null,
      materiais: null,
      estoque_localizacoes: null,
      estoque_saldos: null,
      estoque_movimentacoes: null,
      material_custodias: null,
      material_custodia_eventos: null,
      material_locacoes: null,
      material_locacao_itens: null,
      material_locacao_eventos: null,
      manutencao_ordens: null,
      manutencao_ordem_insumos: null,
      manutencao_ordem_eventos: null,
      financeiro_lancamentos: null,
      financeiro_parcelas: null,
      financeiro_recebimentos: null,
    });
  });

  it("summarizes the six 1.1 collections as real counts, not null, when present", () => {
    const payload = buildBackupPayload(tenantA, "auto", sampleExtendedData());
    const summary = getBackupSummary(payload);
    expect(summary.clientes).toBe(1);
    expect(summary.funcionarios).toBe(1);
    expect(summary.event_funcionarios).toBe(1);
    expect(summary.event_checklist_items).toBe(1);
    expect(summary.document_templates).toBe(1);
    expect(summary.generated_documents).toBe(1);
    // sampleExtendedData() does not add the 1.2 collections - those stay null.
    expect(summary.materiais).toBeNull();
  });

  it("summarizes the sixteen 1.2 operational-core collections as real counts, not null, when present", () => {
    const payload = buildBackupPayload(tenantA, "auto", sampleFullData());
    const summary = getBackupSummary(payload);
    expect(summary.categorias_materiais).toBe(1);
    expect(summary.materiais).toBe(1);
    expect(summary.estoque_localizacoes).toBe(1);
    expect(summary.estoque_saldos).toBe(1);
    expect(summary.estoque_movimentacoes).toBe(1);
    expect(summary.material_custodias).toBe(1);
    expect(summary.material_custodia_eventos).toBe(1);
    expect(summary.material_locacoes).toBe(1);
    expect(summary.material_locacao_itens).toBe(1);
    expect(summary.material_locacao_eventos).toBe(1);
    expect(summary.manutencao_ordens).toBe(1);
    expect(summary.manutencao_ordem_insumos).toBe(1);
    expect(summary.manutencao_ordem_eventos).toBe(1);
    expect(summary.financeiro_lancamentos).toBe(1);
    expect(summary.financeiro_parcelas).toBe(1);
    expect(summary.financeiro_recebimentos).toBe(1);
  });

  it("overrides foreign tenant IDs on every 1.1 and 1.2 collection before a restore", () => {
    const restored = prepareBackupForRestore(
      buildBackupPayload(tenantA, "manual", sampleFullData(tenantA)),
      tenantB,
    );

    expect(restored.meta.empresa_id).toBe(tenantB);
    for (const [key, rows] of Object.entries(restored.data)) {
      expect(rows, `data.${key} should have been populated by sampleFullData`).toBeDefined();
      expect((rows ?? []).every((row) => row.empresa_id === tenantB)).toBe(true);
    }
  });

  it("never turns an absent 1.1 or 1.2 collection into an empty array during restore prep", () => {
    // sampleData() (unlike sampleExtendedData()/sampleFullData()) has none
    // of the newer keys at all - this is what an old backup looks like. If
    // any of these ever became `[]` here, restore_company_backup would read
    // that as "restore this table to empty" instead of "not part of this
    // backup", wiping out live data the backup never touched.
    const restored = prepareBackupForRestore(
      buildBackupPayload(tenantA, "manual", sampleData(tenantA)),
      tenantB,
    );

    expect(restored.data.clientes).toBeUndefined();
    expect(restored.data.funcionarios).toBeUndefined();
    expect(restored.data.event_funcionarios).toBeUndefined();
    expect(restored.data.event_checklist_items).toBeUndefined();
    expect(restored.data.document_templates).toBeUndefined();
    expect(restored.data.generated_documents).toBeUndefined();
    expect(restored.data.categorias_materiais).toBeUndefined();
    expect(restored.data.materiais).toBeUndefined();
    expect(restored.data.estoque_localizacoes).toBeUndefined();
    expect(restored.data.estoque_saldos).toBeUndefined();
    expect(restored.data.estoque_movimentacoes).toBeUndefined();
    expect(restored.data.material_custodias).toBeUndefined();
    expect(restored.data.material_custodia_eventos).toBeUndefined();
    expect(restored.data.material_locacoes).toBeUndefined();
    expect(restored.data.material_locacao_itens).toBeUndefined();
    expect(restored.data.material_locacao_eventos).toBeUndefined();
    expect(restored.data.manutencao_ordens).toBeUndefined();
    expect(restored.data.manutencao_ordem_insumos).toBeUndefined();
    expect(restored.data.manutencao_ordem_eventos).toBeUndefined();
    expect(restored.data.financeiro_lancamentos).toBeUndefined();
    expect(restored.data.financeiro_parcelas).toBeUndefined();
    expect(restored.data.financeiro_recebimentos).toBeUndefined();
    // The original four are unaffected by any of this.
    expect(restored.data.eventos).toHaveLength(1);
  });

  it("normalizes a pre-1.1 payload without inventing the new collections", () => {
    const normalized = normalizeBackup({
      versao: "1.0",
      sistema: BACKUP_SYSTEM,
      meta: { empresa_id: tenantA, tipo: "manual", data_backup: "2026-08-01T00:00:00.000Z" },
      data: sampleData(tenantA),
    });

    expect(normalized.data.clientes).toBeUndefined();
    expect(normalized.data.materiais).toBeUndefined();
    expect(normalized.data.eventos).toHaveLength(1);
  });

  it("normalizes a pre-1.2 (1.1) payload without inventing the operational-core collections", () => {
    const normalized = normalizeBackup({
      versao: "1.1",
      sistema: BACKUP_SYSTEM,
      meta: { empresa_id: tenantA, tipo: "manual", data_backup: "2026-08-17T00:00:00.000Z" },
      data: sampleExtendedData(tenantA),
    });

    expect(normalized.data.clientes).toHaveLength(1);
    expect(normalized.data.materiais).toBeUndefined();
    expect(normalized.data.financeiro_lancamentos).toBeUndefined();
  });

  it("keeps 1.1 and 1.2 collections intact when normalizing an already-current payload", () => {
    const payload = buildBackupPayload(tenantA, "manual", sampleFullData(tenantA));
    const normalized = normalizeBackup(payload);

    expect(normalized.data.clientes).toHaveLength(1);
    expect(normalized.data.generated_documents).toHaveLength(1);
    expect(normalized.data.materiais).toHaveLength(1);
    expect(normalized.data.financeiro_recebimentos).toHaveLength(1);
  });

  it("accepts a payload that omits every 1.1 collection as still valid", () => {
    const result = validateBackup(buildBackupPayload(tenantA, "manual", sampleData()));
    expect(result.valid).toBe(true);
  });

  it("rejects a present-but-malformed 1.1 collection", () => {
    const payload = buildBackupPayload(tenantA, "manual", sampleExtendedData());
    // @ts-expect-error -- deliberately malformed for the test
    payload.data.clientes = { not: "an array" };

    const result = validateBackup(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/data\.clientes/)]),
    );
  });

  it("accepts a payload that omits every 1.2 operational-core collection as still valid", () => {
    const result = validateBackup(buildBackupPayload(tenantA, "manual", sampleExtendedData()));
    expect(result.valid).toBe(true);
  });

  it("rejects a present-but-malformed 1.2 collection", () => {
    const payload = buildBackupPayload(tenantA, "manual", sampleFullData());
    // @ts-expect-error -- deliberately malformed for the test
    payload.data.materiais = { not: "an array" };

    const result = validateBackup(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/data\.materiais/)]),
    );
  });

  it("refuses an invalid payload before destructive restore operations", () => {
    expect(() => prepareBackupForRestore(null, tenantB)).toThrow(
      /backup inválido/i,
    );
    expect(() => prepareBackupForRestore({}, tenantB)).toThrow(
      /estrutura não reconhecida/i,
    );
  });

  it("keeps automatic-backup timestamps isolated per tenant", () => {
    vi.spyOn(Date, "now").mockReturnValue(123456789);
    setLastLocalBackupTime(tenantA);

    expect(getLastLocalBackupTime(tenantA)).toBe(123456789);
    expect(getLastLocalBackupTime(tenantB)).toBe(0);
  });
});
