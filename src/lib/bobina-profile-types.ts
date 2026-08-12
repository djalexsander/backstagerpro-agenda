import type { BobinaDpiMode, BobinaProfileFormInput } from "./label-layout-engine";
import type { PrinterOrientation } from "./printer-types";

// Mirrors the empresa_bobina_perfis row shape (snake_case, matching the RPC
// JSON directly) - same convention as PrinterConfig in printer-types.ts.
export interface BobinaProfile {
  id: string;
  empresa_id: string;
  nome: string;
  largura_etiqueta_mm: number;
  altura_etiqueta_mm: number;
  colunas: number;
  espacamento_horizontal_mm: number;
  espacamento_vertical_mm: number;
  margem_esquerda_mm: number;
  margem_direita_mm: number;
  margem_superior_mm: number;
  margem_inferior_mm: number;
  orientacao: PrinterOrientation;
  largura_midia_mm: number | null;
  offset_horizontal_mm: number;
  offset_vertical_mm: number;
  dpi: BobinaDpiMode;
  dpi_personalizado: number | null;
  padrao: boolean;
  ativo: boolean;
  updated_at: string;
}

export interface SaveBobinaProfileInput {
  id?: string;
  expectedUpdatedAt?: string;
  nome: string;
  larguraEtiquetaMm: number;
  alturaEtiquetaMm: number;
  colunas: number;
  espacamentoHorizontalMm: number;
  espacamentoVerticalMm: number;
  margemEsquerdaMm: number;
  margemDireitaMm: number;
  margemSuperiorMm: number;
  margemInferiorMm: number;
  orientacao: PrinterOrientation;
  larguraMidiaMm?: number | null;
  offsetHorizontalMm: number;
  offsetVerticalMm: number;
  dpi: BobinaDpiMode;
  dpiPersonalizado?: number | null;
  padrao: boolean;
}

/** A blank starting point for the profile form - one column, no gaps/margins,
 * matching the trivial single-column footprint (see legacyProfileFromModel
 * in label-layout-engine.ts). Not a brand/size preset, just a neutral zero. */
export const BLANK_BOBINA_PROFILE_INPUT: SaveBobinaProfileInput = {
  nome: "",
  larguraEtiquetaMm: 50,
  alturaEtiquetaMm: 30,
  colunas: 1,
  espacamentoHorizontalMm: 0,
  espacamentoVerticalMm: 0,
  margemEsquerdaMm: 0,
  margemDireitaMm: 0,
  margemSuperiorMm: 0,
  margemInferiorMm: 0,
  orientacao: "retrato",
  larguraMidiaMm: null,
  offsetHorizontalMm: 0,
  offsetVerticalMm: 0,
  dpi: "automatico",
  dpiPersonalizado: null,
  padrao: false,
};

/** SaveBobinaProfileInput (camelCase, form state) -> BobinaProfileFormInput
 * (snake_case, what label-layout-engine.ts's validateBobinaProfile and
 * computeSheetGeometry expect) - lets the profile form preview/validate with
 * the exact same engine the print pipeline uses, live as the user types. */
export function saveInputToLayoutInput(input: SaveBobinaProfileInput): BobinaProfileFormInput {
  return {
    nome: input.nome,
    largura_etiqueta_mm: input.larguraEtiquetaMm,
    altura_etiqueta_mm: input.alturaEtiquetaMm,
    colunas: input.colunas,
    espacamento_horizontal_mm: input.espacamentoHorizontalMm,
    espacamento_vertical_mm: input.espacamentoVerticalMm,
    margem_esquerda_mm: input.margemEsquerdaMm,
    margem_direita_mm: input.margemDireitaMm,
    margem_superior_mm: input.margemSuperiorMm,
    margem_inferior_mm: input.margemInferiorMm,
    largura_midia_mm: input.larguraMidiaMm,
    offset_horizontal_mm: input.offsetHorizontalMm,
    offset_vertical_mm: input.offsetVerticalMm,
    dpi: input.dpi,
    dpi_personalizado: input.dpiPersonalizado,
  };
}

export function bobinaProfileToFormInput(profile: BobinaProfile): SaveBobinaProfileInput {
  return {
    id: profile.id,
    expectedUpdatedAt: profile.updated_at,
    nome: profile.nome,
    larguraEtiquetaMm: Number(profile.largura_etiqueta_mm),
    alturaEtiquetaMm: Number(profile.altura_etiqueta_mm),
    colunas: Number(profile.colunas),
    espacamentoHorizontalMm: Number(profile.espacamento_horizontal_mm),
    espacamentoVerticalMm: Number(profile.espacamento_vertical_mm),
    margemEsquerdaMm: Number(profile.margem_esquerda_mm),
    margemDireitaMm: Number(profile.margem_direita_mm),
    margemSuperiorMm: Number(profile.margem_superior_mm),
    margemInferiorMm: Number(profile.margem_inferior_mm),
    orientacao: profile.orientacao,
    larguraMidiaMm: profile.largura_midia_mm != null ? Number(profile.largura_midia_mm) : null,
    offsetHorizontalMm: Number(profile.offset_horizontal_mm),
    offsetVerticalMm: Number(profile.offset_vertical_mm),
    dpi: profile.dpi,
    dpiPersonalizado: profile.dpi_personalizado != null ? Number(profile.dpi_personalizado) : null,
    padrao: profile.padrao,
  };
}
