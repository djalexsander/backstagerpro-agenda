import { CUSTODY_PURPOSE_LABELS } from "./checkin-checkout-domain";
import type {
  CustodyBalanceOption,
  CustodyCondition,
  CustodyPurpose,
  CustodyResponsibleType,
} from "./checkin-checkout-types";
import { MATERIAL_QR_PREFIX } from "./material-identification";
import type { RentalStatus } from "./material-rental-types";
import {
  buildOndeEstaAgoraSummary,
  formatDateTime,
  formatEventDate,
  situacaoBadgeTone,
  TRACEABILITY_SITUACAO_LABELS,
  type OndeEstaAgoraLine,
  type SituacaoBadgeTone,
} from "./material-traceability-domain";
import type {
  TraceabilityOpenCustody,
  TraceabilitySearchResult,
  TraceabilitySituacao,
} from "./material-traceability-types";
import type {
  ScannerReadContext,
  ScannerRemotoSessao,
  ScannerRemotoTipoOperacao,
} from "./scanner-remoto-types";

/**
 * Mesma decisão checkout-vs-checkin que registrar_leitura_scanner_remoto já
 * aplica no servidor para sessões 'misto' (20260818170000_scanner_remoto_
 * realtime.sql): checkout só quando o material não tem nenhuma custódia
 * aberta; sessões 'checkout'/'checkin' puras não dependem disso, o tipo já
 * está fixado na sessão. Usada só para decidir qual modal de confirmação
 * mostrar no cliente antes de registrar - o servidor continua sendo a
 * autoridade; se o estado mudar entre a identificação e a confirmação (outra
 * leitura fechou a custódia nesse meio-tempo), o RPC resolve pelo estado
 * real no momento do registro, não pelo que este cliente adivinhou aqui.
 */
export function detectScannerRemotoOperation(
  tipoOperacao: ScannerRemotoTipoOperacao,
  hasOpenCustody: boolean,
): "checkout" | "checkin" {
  if (tipoOperacao === "checkout") return "checkout";
  if (tipoOperacao === "checkin") return "checkin";
  return hasOpenCustody ? "checkin" : "checkout";
}

/**
 * Quantidade máxima para um check-out por Scanner Remoto: o saldo do
 * material na localização de origem fixada na sessão - mesma regra que
 * apply_stock_movement já valida no servidor ("Saldo insuficiente na
 * localização de origem"), só antecipada aqui para o modal de confirmação.
 */
export function maxScannerRemotoCheckoutQuantity(
  saldos: CustodyBalanceOption[],
  originLocationId: string | null,
): number {
  return saldos.find((saldo) => saldo.localizacao_id === originLocationId)?.quantidade ?? 0;
}

/**
 * Sessão "automática" (E3): tipo_operacao='misto' aberta sem nenhum contexto
 * operacional. É o sinal para o fluxo read-only da E4 (identificar + mostrar
 * contexto atual, sem movimentar nada).
 *
 * Uma sessão 'misto' *configurada* (pelo formulário "Nova sessão configurada")
 * tem origem/destino/responsável/finalidade preenchidos e continua no fluxo
 * antigo submitScan -> registerRead -> registrar_leitura_scanner_remoto, que
 * movimenta na hora. Sessões explicitamente 'checkout'/'checkin' também.
 */
export function isNeutralScannerSession(
  session: Pick<
    ScannerRemotoSessao,
    | "tipo_operacao"
    | "localizacao_origem_id"
    | "localizacao_destino_id"
    | "responsavel_tipo"
    | "responsavel_id"
    | "finalidade"
    | "referencia_tipo"
    | "referencia_id"
  >,
): boolean {
  return (
    session.tipo_operacao === "misto" &&
    session.localizacao_origem_id == null &&
    session.localizacao_destino_id == null &&
    session.responsavel_tipo == null &&
    session.responsavel_id == null &&
    session.finalidade == null &&
    session.referencia_tipo == null &&
    session.referencia_id == null
  );
}

/**
 * Um código lido bate com este material? Mesma convenção de identificadores
 * de custodyIdentifierCandidates()/materialMatchesCustodyIdentifier()
 * (checkin-checkout-domain.ts): match exato (case-insensitive) contra id,
 * identificador_unico, código de barras, código interno, patrimônio ou série;
 * se o código vier com o prefixo do QR (BACKSTAGE-PRO:MATERIAL:...), tenta de
 * novo sem o prefixo. buscar_rastreabilidade_materiais não devolve
 * conteudo_qr_code no shape da busca - o QR completo é coberto pelo servidor
 * (que casa conteudo_qr_code) e, aqui, pelo caminho do prefixo -> identificador_unico.
 */
export function traceabilityMatchesScan(item: TraceabilitySearchResult, scan: string): boolean {
  const normalized = scan.trim().toLocaleLowerCase("pt-BR");
  if (!normalized) return false;
  const prefix = MATERIAL_QR_PREFIX.toLocaleLowerCase("pt-BR");
  const stripped = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
  const candidates = [
    item.id,
    item.identificador_unico,
    item.codigo_barras,
    item.codigo_interno,
    item.numero_patrimonio,
    item.numero_serie,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLocaleLowerCase("pt-BR"));
  return (
    candidates.includes(normalized) || (stripped !== null && candidates.includes(stripped))
  );
}

/**
 * Escolhe qual resultado de buscar_rastreabilidade_materiais corresponde ao
 * código lido. Prioriza um match exato de identificador; se não houver, um
 * único resultado é confiável (o servidor faz o próprio match exato, inclusive
 * EPC/RFID, que não vem neste shape). Vários resultados sem match exato = não
 * identificado.
 */
export function pickTraceabilityMatch(
  items: TraceabilitySearchResult[],
  scan: string,
): TraceabilitySearchResult | null {
  const exact = items.find((item) => traceabilityMatchesScan(item, scan));
  if (exact) return exact;
  return items.length === 1 ? items[0] : null;
}

/**
 * Contexto de check-in montado na E4.5 - só estado React, nada gravado. A
 * origem NÃO é escolhida: é derivada da custódia. `rental` só aparece quando a
 * custódia é de locação (referencia_tipo='locacao_item'), guardando os IDs que
 * a futura E5 usará em registrar_devolucao_locacao_material.
 */
export interface ScannerCheckinContext {
  operation: "checkin";
  custodyId: string;
  /** localizacao_origem_id da custódia (de onde o material saiu) - informativo/E5. */
  originLocationId: string | null;
  destinationLocationId: string;
  returnCondition: CustodyCondition;
  rental: { rentalId: string; rentalItemId: string } | null;
}

/**
 * Contexto de check-out montado na E4.5 - só estado React, nada gravado.
 * `purpose` nunca é 'locacao' (o operador escolhe "Cliente" e a tradução para
 * o fluxo oficial de Locação é E5). `event` só com purpose='evento';
 * `rental` só com purpose='cliente'.
 */
export interface ScannerCheckoutContext {
  operation: "checkout";
  originLocationId: string;
  responsibleType: CustodyResponsibleType;
  responsibleId: string;
  condition: CustodyCondition;
  purpose: Exclude<CustodyPurpose, "locacao">;
  event: { referenceType: "evento"; referenceId: string } | null;
  rental: { rentalId: string; rentalItemId: string } | null;
}

export type ScannerOperationContext = ScannerCheckinContext | ScannerCheckoutContext;

export interface ScannerPendingRead {
  /** Código normalizado que foi lido. */
  code: string;
  /** Material identificado (linha de buscar_rastreabilidade_materiais). */
  material: TraceabilitySearchResult;
  /** resumo_situacao_material - já vem junto do material, hasteado por conveniência. */
  resumo: TraceabilitySituacao;
  /**
   * A custódia aberta específica desta leitura (0/1 custódia = automático;
   * várias, só material por quantidade = escolhida pelo operador via
   * CheckinOriginDialog).
   */
  selectedCustody: TraceabilityOpenCustody | null;
  /** Operação que o operador escolheu na E4 - a movimentação em si é E5/E6. */
  selectedOperation: "checkout" | "checkin" | null;
  /**
   * Contexto pronto da E4.5 (campos preenchidos e validados). Ainda NÃO
   * grava nada - E5/E6 é que traduz isto em RPC.
   */
  operationContext: ScannerOperationContext | null;
}

/** Status de locação que aceitam retirada, mesma lista do fluxo oficial. */
export const OPERABLE_RENTAL_STATUSES: RentalStatus[] = [
  "reservada",
  "pronta_retirada",
  "em_andamento",
  "parcialmente_devolvida",
];

export function isOperableRentalStatus(status: RentalStatus): boolean {
  return OPERABLE_RENTAL_STATUSES.includes(status);
}

/**
 * Resolve o material_locacao_itens.id do material escaneado dentro dos itens
 * de uma locação. null = o material não pertence à locação (bloqueia a
 * confirmação, com a mensagem "Este material não pertence à locação
 * selecionada.").
 */
export function resolveRentalItemForMaterial(
  itens: { id: string; material: { id: string } }[],
  materialId: string,
): string | null {
  return itens.find((item) => item.material.id === materialId)?.id ?? null;
}

/**
 * Origem = destino sem sentido: só bloqueia um check-in cuja localização de
 * destino escolhida é a MESMA de onde o material saiu (movimentação no-op).
 * Check-out não tem destino, então nunca bloqueia aqui. Backend inalterado -
 * validação puramente client-side.
 */
export function scannerOriginDestinationInvalid(context: ScannerOperationContext): boolean {
  if (context.operation !== "checkin") return false;
  return (
    context.originLocationId != null &&
    context.originLocationId === context.destinationLocationId
  );
}

export interface ScannerReadDispatch {
  /** Vai no _custodia_id do RPC (revalidado lá). Só para check-in. */
  custodiaId?: string;
  /** Vai no _contexto jsonb do RPC. */
  contexto: ScannerReadContext;
}

/**
 * E5: traduz o operationContext montado na E4.5 (estado React) no payload que
 * registrar_leitura_scanner_remoto espera na confirmação final.
 *
 * - check-in: `custodiaId` (a custódia a fechar) + contexto mínimo
 *   (destino + condição). Custódia de locação NÃO manda `locacao_id` aqui - o
 *   RPC deriva a locação da própria custódia e roteia para a devolução.
 * - check-out normal: origem/responsável/finalidade/condição.
 * - check-out evento: + referencia_tipo='evento' + referencia_id.
 * - check-out cliente: + locacao_id + locacao_item_id (o RPC roteia para
 *   registrar_retirada_locacao_material; a finalidade continua 'cliente' aqui,
 *   nunca 'locacao').
 */
export function buildScannerReadDispatch(
  context: ScannerOperationContext,
): ScannerReadDispatch {
  if (context.operation === "checkin") {
    return {
      custodiaId: context.custodyId,
      contexto: {
        operation: "checkin",
        localizacao_destino_id: context.destinationLocationId,
        condicao: context.returnCondition,
      },
    };
  }
  return {
    contexto: {
      operation: "checkout",
      localizacao_origem_id: context.originLocationId,
      responsavel_tipo: context.responsibleType,
      responsavel_id: context.responsibleId,
      finalidade: context.purpose,
      condicao: context.condition,
      ...(context.event
        ? { referencia_tipo: "evento" as const, referencia_id: context.event.referenceId }
        : {}),
      ...(context.rental
        ? { locacao_id: context.rental.rentalId, locacao_item_id: context.rental.rentalItemId }
        : {}),
    },
  };
}

export interface PendingReadContext {
  headline: string;
  tone: SituacaoBadgeTone;
  lines: OndeEstaAgoraLine[];
}

/**
 * Texto pronto para o painel "Material identificado" da E4, puramente a
 * partir do resumo (resumo_situacao_material) e - quando há - da custódia
 * escolhida. Sem consulta nova: reaproveita buildOndeEstaAgoraSummary
 * (mesma função que a tela de Rastreabilidade já usa) para os estados sem
 * custódia (disponível/manutenção/status manual).
 */
export function describePendingReadContext(
  resumo: TraceabilitySituacao,
  selectedCustody: TraceabilityOpenCustody | null,
): PendingReadContext {
  if (!selectedCustody) {
    const summary = buildOndeEstaAgoraSummary(resumo);
    return {
      headline: summary.headline,
      tone: situacaoBadgeTone(resumo.situacao),
      lines: summary.linhas,
    };
  }

  const custody = selectedCustody;
  const situacao: TraceabilitySituacao["situacao"] =
    custody.locacao || custody.finalidade === "locacao"
      ? "locado"
      : custody.evento || custody.referencia_tipo === "evento"
        ? "evento"
        : "emprestado";

  const lines: OndeEstaAgoraLine[] = [];
  if (custody.locacao) {
    lines.push({ label: "Locação", value: custody.locacao.locacao_numero });
    lines.push({ label: "Cliente", value: custody.locacao.cliente_nome });
  }
  if (custody.evento) {
    lines.push({ label: "Evento", value: custody.evento.evento_nome });
    lines.push({ label: "Data do evento", value: formatEventDate(custody.evento.evento_data) });
  }
  if (custody.localizacao_origem_nome) {
    lines.push({ label: "Saiu de", value: custody.localizacao_origem_nome });
  }
  lines.push({ label: "Finalidade", value: CUSTODY_PURPOSE_LABELS[custody.finalidade] });
  lines.push({ label: "Retirado por", value: custody.retirado_por });
  lines.push({ label: "Quantidade pendente", value: String(custody.quantidade_pendente) });
  if (custody.previsao_retorno) {
    lines.push({ label: "Previsão de retorno", value: formatDateTime(custody.previsao_retorno) });
  }

  return {
    headline: situacao === "evento" ? "Em evento" : TRACEABILITY_SITUACAO_LABELS[situacao],
    tone: situacaoBadgeTone(situacao),
    lines,
  };
}
