import type {
  MaterialOperationalStatus,
  MaterialWithRelations,
} from "./material-types";

export type MaterialActiveFilter = "ativos" | "inativos" | "todos";
export type MaterialSortField =
  | "nome"
  | "codigo"
  | "categoria"
  | "quantidade"
  | "status"
  | "localizacao";

export interface MaterialFilters {
  search: string;
  categoryId: string;
  status: MaterialOperationalStatus | "todos";
  location: string;
  active: MaterialActiveFilter;
  sortField: MaterialSortField;
  sortDirection: "asc" | "desc";
}

function searchableText(material: MaterialWithRelations): string {
  return [
    material.nome,
    material.codigo_interno,
    material.identificador_unico,
    material.codigo_barras,
    material.conteudo_qr_code,
    material.numero_patrimonio,
    material.numero_serie,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("pt-BR");
}

function sortValue(
  material: MaterialWithRelations,
  field: MaterialSortField,
): string | number {
  if (field === "codigo") return material.codigo_interno;
  if (field === "categoria") return material.categoria?.nome ?? "";
  if (field === "quantidade") return material.quantidade;
  if (field === "status") return material.status_operacional;
  if (field === "localizacao") return material.localizacao ?? "";
  return material.nome;
}

export function filterAndSortMaterials(
  materials: MaterialWithRelations[],
  filters: MaterialFilters,
): MaterialWithRelations[] {
  const search = filters.search.trim().toLocaleLowerCase("pt-BR");
  const location = filters.location.trim().toLocaleLowerCase("pt-BR");

  return materials
    .filter((material) => {
      if (search && !searchableText(material).includes(search)) return false;
      if (
        filters.categoryId !== "todos" &&
        material.categoria_id !== filters.categoryId
      ) {
        return false;
      }
      if (
        filters.status !== "todos" &&
        material.status_operacional !== filters.status
      ) {
        return false;
      }
      if (
        location &&
        !(material.localizacao ?? "")
          .toLocaleLowerCase("pt-BR")
          .includes(location)
      ) {
        return false;
      }
      if (filters.active === "ativos" && !material.ativo) return false;
      if (filters.active === "inativos" && material.ativo) return false;
      return true;
    })
    .sort((left, right) => {
      const leftValue = sortValue(left, filters.sortField);
      const rightValue = sortValue(right, filters.sortField);
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "pt-BR", {
              sensitivity: "base",
              numeric: true,
            });
      return filters.sortDirection === "asc" ? comparison : -comparison;
    });
}

export function paginateMaterials<T>(
  rows: T[],
  page: number,
  pageSize: number,
): { rows: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: safePage,
    pageCount,
  };
}
