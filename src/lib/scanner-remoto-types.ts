// ============================================================================
// SCANNER REMOTO — TIPOS CENTRAIS
// ============================================================================
//
// scanner_remoto_sessoes/scanner_remoto_leituras e as RPCs desta migration
// (20260818090000_scanner_remoto_realtime.sql) ainda não existem nos tipos
// gerados do Supabase - mesmo padrão já usado por rfid-types.ts/
// user-module-permissions-service.ts: sem instância local de Postgres/
// Supabase CLI para regenerar src/integrations/supabase/types.ts, os
// formatos de linha são declarados aqui à mão e ficam defasados até a
// migration ser aplicada e os tipos regenerados.
//
// responsavel/finalidade/condicao reaproveitam os mesmos enums de
// check-in/check-out (checkin-checkout-types.ts) em vez de redeclarados -
// são exatamente os mesmos conceitos, só escolhidos uma vez por sessão em
// vez de uma vez por operação.

import type {
  CustodyCondition,
  CustodyPurpose,
  CustodyResponsibleType,
} from "./checkin-checkout-types";

export type ScannerRemotoTipoOperacao = "checkout" | "checkin" | "misto";

export const SCANNER_REMOTO_TIPO_OPERACAO_LABELS: Record<ScannerRemotoTipoOperacao, string> = {
  checkout: "Somente check-out",
  checkin: "Somente check-in",
  misto: "Automático (detecta por material)",
};

export type ScannerRemotoSessaoStatus = "aberta" | "encerrada" | "cancelada";

export type ScannerRemotoAcao = "checkout" | "checkin" | "nao_encontrado" | "erro";

export const SCANNER_REMOTO_ACAO_LABELS: Record<ScannerRemotoAcao, string> = {
  checkout: "Check-out",
  checkin: "Check-in",
  nao_encontrado: "Não encontrado",
  erro: "Erro",
};

/** Espelha public.scanner_remoto_sessoes. */
export interface ScannerRemotoSessao {
  id: string;
  empresa_id: string;
  tipo_operacao: ScannerRemotoTipoOperacao;
  responsavel_tipo: CustodyResponsibleType | null;
  responsavel_id: string | null;
  finalidade: CustodyPurpose | null;
  condicao: CustodyCondition;
  localizacao_origem_id: string | null;
  localizacao_destino_id: string | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  titulo: string | null;
  observacao: string | null;
  status: ScannerRemotoSessaoStatus;
  criado_por: string;
  aberta_em: string;
  encerrada_em: string | null;
  encerrada_por: string | null;
  created_at: string;
  updated_at: string;
}

/** Pequeno resultado estruturado gravado em cada leitura - nunca a fonte de autoridade, só um resumo para exibição imediata. */
export interface ScannerRemotoLeituraResultado {
  mensagem: string;
  material_nome?: string | null;
  sqlstate?: string | null;
}

/** Espelha o retorno de listar_leituras_scanner_remoto (join leve com materiais.nome). */
export interface ScannerRemotoLeitura {
  id: string;
  sessao_id: string;
  lido_por: string;
  codigo_lido: string;
  material_id: string | null;
  material_nome: string | null;
  acao_executada: ScannerRemotoAcao;
  custodia_id: string | null;
  resultado: ScannerRemotoLeituraResultado | null;
  created_at: string;
}

export interface StartScannerRemotoSessionInput {
  tipoOperacao: ScannerRemotoTipoOperacao;
  condicao: CustodyCondition;
  /** Obrigatório quando tipoOperacao é 'checkout' ou 'misto'. */
  responsibleType?: CustodyResponsibleType | null;
  responsibleId?: string | null;
  purpose?: CustodyPurpose | null;
  originLocationId?: string | null;
  /** Obrigatório quando tipoOperacao é 'checkin' ou 'misto'. */
  destinationLocationId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  observacao?: string;
  titulo?: string;
  clientUuid: string;
}

export interface RegisterScannerRemotoReadInput {
  sessaoId: string;
  codigoLido: string;
  clientUuid: string;
}
