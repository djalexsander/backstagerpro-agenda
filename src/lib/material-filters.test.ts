import { describe, expect, it } from "vitest";
import {
  filterAndSortMaterials,
  paginateMaterials,
  type MaterialFilters,
} from "./material-filters";
import type { MaterialWithRelations } from "./material-types";

function material(
  id: string,
  overrides: Partial<MaterialWithRelations> = {},
): MaterialWithRelations {
  return {
    id,
    empresa_id: "company",
    categoria_id: "audio",
    codigo_interno: `MAT-${id}`,
    identificador_unico: `550e8400-e29b-41d4-a716-${id.padStart(12, "0")}`,
    codigo_barras: null,
    tipo_identificacao: "qr_code",
    conteudo_qr_code: null,
    identificacao_gerada_em: null,
    identificacao_gerada_por: null,
    status_identificacao: "nao_gerada",
    nome: `Material ${id}`,
    descricao: null,
    marca: null,
    modelo: null,
    numero_serie: null,
    numero_patrimonio: null,
    tipo_controle: "quantidade",
    quantidade: 1,
    unidade_medida: "unidade",
    localizacao: "Galpão A",
    valor_aquisicao: null,
    valor_reposicao: null,
    valor_locacao_padrao: null,
    data_aquisicao: null,
    fornecedor: null,
    observacoes: null,
    status_operacional: "disponivel",
    justificativa_status: null,
    ativo: true,
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
    created_by: null,
    updated_by: null,
    categoria: {
      id: "audio",
      empresa_id: "company",
      nome: "Áudio",
      descricao: null,
      ativo: true,
      created_at: "2026-07-30T00:00:00Z",
      updated_at: "2026-07-30T00:00:00Z",
      created_by: null,
      updated_by: null,
    },
    fotos: [],
    ...overrides,
  };
}

const filters: MaterialFilters = {
  search: "",
  categoryId: "todos",
  status: "todos",
  active: "todos",
  sortField: "nome",
  sortDirection: "asc",
};

describe("material list filters", () => {
  const rows = [
    material("2", {
      nome: "Cabo XLR",
      codigo_interno: "CAB-10",
      numero_patrimonio: "PAT-9",
      numero_serie: "SER-9",
      quantidade: 20,
    }),
    material("1", {
      nome: "Mesa digital",
      codigo_interno: "MIX-1",
      categoria_id: "mixers",
      localizacao: "Estúdio",
      ativo: false,
      status_operacional: "avariado",
    }),
  ];

  it("searches names and every official material identifier", () => {
    rows[0].codigo_barras = "BSP-BAR-001";
    rows[0].conteudo_qr_code =
      "BACKSTAGE-PRO:MATERIAL:550e8400-e29b-41d4-a716-000000000002";

    for (const search of [
      "cabo",
      "CAB-10",
      "PAT-9",
      "SER-9",
      "BSP-BAR-001",
      "550e8400-e29b-41d4-a716-000000000002",
      "BACKSTAGE-PRO:MATERIAL:550e8400-e29b-41d4-a716-000000000002",
    ]) {
      expect(filterAndSortMaterials(rows, { ...filters, search })).toHaveLength(
        1,
      );
    }
  });

  it("combines category, status and active filters", () => {
    expect(
      filterAndSortMaterials(rows, {
        ...filters,
        categoryId: "mixers",
        status: "avariado",
        active: "inativos",
      }).map((row) => row.id),
    ).toEqual(["1"]);
  });

  it("sorts quantities and paginates safely", () => {
    const sorted = filterAndSortMaterials(rows, {
      ...filters,
      sortField: "quantidade",
      sortDirection: "desc",
    });
    expect(sorted.map((row) => row.id)).toEqual(["2", "1"]);
    expect(paginateMaterials(sorted, 2, 1)).toMatchObject({
      page: 2,
      pageCount: 2,
      rows: [expect.objectContaining({ id: "1" })],
    });
  });
});
