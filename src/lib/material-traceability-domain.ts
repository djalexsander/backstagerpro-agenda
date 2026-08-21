import { format, parseISO } from "date-fns";
import type {
  TraceabilitySituacao,
  TraceabilityTimelineEntry,
  TraceabilityTimelineEntryType,
} from "./material-traceability-types";

export const TRACEABILITY_SITUACAO_LABELS: Record<TraceabilitySituacao["situacao"], string> = {
  disponivel: "Disponível",
  locado: "Locado",
  emprestado: "Emprestado",
  em_manutencao: "Em manutenção",
  avariado: "Avariado",
  extraviado: "Extraviado",
  baixado: "Baixado",
};

export type SituacaoBadgeTone = "success" | "warning" | "destructive" | "neutral";

export function situacaoBadgeTone(situacao: TraceabilitySituacao["situacao"]): SituacaoBadgeTone {
  switch (situacao) {
    case "disponivel":
      return "success";
    case "locado":
    case "emprestado":
      return "neutral";
    case "em_manutencao":
      return "warning";
    case "avariado":
    case "extraviado":
    case "baixado":
      return "destructive";
    default:
      return "neutral";
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

// events.date is a plain SQL date (no time-of-day) - new Date(value) parses
// a bare date string as UTC midnight, which toLocaleString/toLocaleDateString
// then renders in the browser's local timezone, silently showing the
// previous day for any timezone behind UTC (Brazil included). parseISO
// reads it as local midnight instead - same fix Agenda.tsx already applies
// to this exact events.date column.
export function formatEventDate(value: string | null | undefined): string {
  if (!value) return "—";
  return format(parseISO(value), "dd/MM/yyyy");
}

export const TIMELINE_ENTRY_LABELS: Record<TraceabilityTimelineEntryType, string> = {
  checkout: "Check-out",
  checkin: "Check-in",
  cancelamento: "Cancelamento",
  correcao: "Correção",
  manutencao_aberta: "Manutenção aberta",
  manutencao_concluida: "Manutenção concluída",
  manutencao_cancelada: "Manutenção cancelada",
  movimentacao_estoque: "Movimentação de estoque",
  rfid_tag_vinculada: "Tag RFID vinculada",
  rfid_tag_desativada: "Tag RFID desativada",
};

/**
 * Linha de resumo por entrada da timeline - `detalhes` varia por `tipo`
 * (ver TraceabilityTimelineDetails), então cada ramo só lê os campos que a
 * migration realmente preenche para aquele tipo de evento.
 */
export function describeTimelineEntry(entry: TraceabilityTimelineEntry): string {
  const details = entry.detalhes;
  switch (entry.tipo) {
    case "checkout": {
      const parts = [`Retirado por ${details.responsavel_nome ?? "—"}`];
      if (details.locacao_numero) parts.push(`Locação ${details.locacao_numero}`);
      if (details.cliente_nome) parts.push(`Cliente: ${details.cliente_nome}`);
      if (details.evento_nome) parts.push(`Evento: ${details.evento_nome}`);
      parts.push(`Liberado por ${details.executor_nome ?? "—"}`);
      return parts.join(" · ");
    }
    case "checkin": {
      const parts = [`Recebido por ${details.executor_nome ?? "—"}`];
      if (details.locacao_numero) parts.push(`Locação ${details.locacao_numero}`);
      if (details.evento_nome) parts.push(`Evento: ${details.evento_nome}`);
      if (details.condicao) parts.push(`Condição: ${details.condicao}`);
      if (details.ocorrencia) parts.push(`Ocorrência: ${details.ocorrencia}`);
      return parts.join(" · ");
    }
    case "cancelamento":
      return details.justificativa ? `Justificativa: ${details.justificativa}` : "Check-out cancelado";
    case "correcao":
      return details.observacao ?? "Correção de histórico";
    case "manutencao_aberta":
      // details.numero já vem no formato "MAN-2026-000123" (gerado em
      // 20260802230000_equipment_maintenance_stage_five.sql) - não prefixar
      // com "OS " de novo aqui.
      return [details.numero ?? "—", details.defeito_relatado].filter(Boolean).join(" · ");
    case "manutencao_concluida":
      return [details.numero ?? "—", details.servico_executado ?? undefined].filter(Boolean).join(" · ");
    case "manutencao_cancelada":
      return details.numero ?? "—";
    case "movimentacao_estoque": {
      const parts = [String(details.tipo_movimentacao ?? "")];
      if (details.localizacao_origem_nome) parts.push(`De: ${details.localizacao_origem_nome}`);
      if (details.localizacao_destino_nome) parts.push(`Para: ${details.localizacao_destino_nome}`);
      if (details.motivo) parts.push(details.motivo);
      return parts.filter(Boolean).join(" · ");
    }
    case "rfid_tag_vinculada":
      return `EPC ${details.epc ?? "—"}`;
    case "rfid_tag_desativada":
      return [`EPC ${details.epc ?? "—"}`, details.motivo_desativacao ?? undefined].filter(Boolean).join(" · ");
    default:
      return "";
  }
}

export interface OndeEstaAgoraLine {
  label: string;
  value: string;
}

export interface OndeEstaAgoraSummary {
  headline: string;
  linhas: OndeEstaAgoraLine[];
}

/**
 * Conteúdo pronto para o bloco "ONDE ESTÁ AGORA?" (a informação mais
 * importante da tela, por pedido explícito) - uma função pura por cima do
 * `resumo` que a migration já devolve, sem nenhuma lógica de derivação nova
 * aqui além de formatação de texto.
 */
export function buildOndeEstaAgoraSummary(resumo: TraceabilitySituacao): OndeEstaAgoraSummary {
  switch (resumo.situacao) {
    case "disponivel": {
      const local = resumo.localizacoes.map((item) => item.localizacao_nome).join(", ");
      const linhas: OndeEstaAgoraLine[] = [
        { label: "Localização", value: local || "Sem saldo em estoque" },
      ];
      if (resumo.ultimo_retorno_em) {
        linhas.push({ label: "Último retorno", value: formatDateTime(resumo.ultimo_retorno_em) });
        linhas.push({ label: "Recebido por", value: resumo.ultimo_retorno_recebido_por ?? "—" });
      }
      return { headline: "Disponível", linhas };
    }
    case "locado":
    case "emprestado": {
      const linhas: OndeEstaAgoraLine[] = [];
      if (resumo.locacao) {
        linhas.push({ label: "Locação", value: resumo.locacao.locacao_numero });
        linhas.push({ label: "Cliente", value: resumo.locacao.cliente_nome });
      }
      if (resumo.evento) {
        linhas.push({ label: "Evento", value: resumo.evento.evento_nome });
        linhas.push({ label: "Data do evento", value: formatEventDate(resumo.evento.evento_data) });
      }
      linhas.push(
        { label: "Retirado por", value: resumo.retirado_por },
        { label: "Liberado por", value: resumo.liberado_por },
        { label: "Saída em", value: formatDateTime(resumo.retirada_em) },
      );
      if (resumo.previsao_retorno) {
        linhas.push({
          label: "Previsão de retorno",
          value: formatDateTime(resumo.previsao_retorno) + (resumo.atrasado ? " · Atrasado" : ""),
        });
      }
      return { headline: resumo.situacao === "locado" ? "Locado" : "Emprestado", linhas };
    }
    case "em_manutencao": {
      const linhas: OndeEstaAgoraLine[] = [
        { label: "Ordem de serviço", value: resumo.manutencao_numero },
        { label: "Status", value: resumo.manutencao_status },
      ];
      if (resumo.manutencao_previsao_conclusao_em) {
        linhas.push({ label: "Previsão de conclusão", value: formatDateTime(resumo.manutencao_previsao_conclusao_em) });
      }
      return { headline: "Em manutenção", linhas };
    }
    default:
      return {
        headline: TRACEABILITY_SITUACAO_LABELS[resumo.situacao],
        linhas: resumo.justificativa_status ? [{ label: "Justificativa", value: resumo.justificativa_status }] : [],
      };
  }
}
