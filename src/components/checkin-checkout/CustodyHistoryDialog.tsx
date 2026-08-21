import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { listCustodyEvents } from "@/lib/checkin-checkout-service";
import {
  CUSTODY_CONDITION_LABELS,
  CUSTODY_PURPOSE_LABELS,
  CUSTODY_STATUS_LABELS,
} from "@/lib/checkin-checkout-domain";
import type { CustodyOperationView } from "@/lib/checkin-checkout-types";
import { MATERIAL_STATUS_LABELS } from "@/lib/material-types";

const EVENT_LABELS = {
  checkout: "Check-out",
  checkin: "Check-in",
  cancelamento: "Cancelamento",
  correcao: "Correção",
} as const;

export function CustodyHistoryDialog({
  open,
  onOpenChange,
  companyId,
  operation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  operation: CustodyOperationView | null;
}) {
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: ["material-custody-events", companyId, operation?.id],
    queryFn: () => listCustodyEvents(companyId, operation!.id),
    enabled: open && Boolean(operation),
  });

  // referencia_tipo/referencia_id already come back on `operation` from
  // listar_custodias_materiais - this just resolves the linked event's
  // name/date for display, the same direct-query pattern CheckoutDialog.tsx
  // uses to list events (events has no RPC layer of its own).
  const linkedEvent = useQuery({
    queryKey: ["custody-linked-event", companyId, operation?.referencia_id],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("events")
        .select("id, name, date")
        .eq("empresa_id", companyId)
        .eq("id", operation!.referencia_id!)
        .maybeSingle();
      if (queryError) throw queryError;
      return data;
    },
    enabled: open && operation?.referencia_tipo === "evento" && Boolean(operation?.referencia_id),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico completo da custódia</DialogTitle>
          <DialogDescription>
            {operation ? `${operation.material_codigo} · ${operation.material_nome}` : "Operação"}
          </DialogDescription>
        </DialogHeader>
        {operation && (
          <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
            <p>Responsável: <strong>{operation.responsavel_nome}</strong></p>
            <p>Finalidade: <strong>{CUSTODY_PURPOSE_LABELS[operation.finalidade]}</strong></p>
            {operation.referencia_tipo === "evento" && linkedEvent.data && (
              <p>Evento: <strong>{linkedEvent.data.name} · {format(parseISO(linkedEvent.data.date), "dd/MM/yyyy")}</strong></p>
            )}
            <p>Condição na saída: <strong>{CUSTODY_CONDITION_LABELS[operation.condicao_saida]}</strong></p>
            <p>Status: <strong>{CUSTODY_STATUS_LABELS[operation.status]}</strong></p>
            <p>Quantidade: <strong>{operation.quantidade_devolvida} retornada(s) · {operation.quantidade_baixada} baixada(s) de {operation.quantidade_retirada}</strong></p>
            <p>Origem: <strong>{operation.localizacao_origem_nome}</strong></p>
            {operation.observacao_saida && <p className="sm:col-span-2">Observação de saída: {operation.observacao_saida}</p>}
          </div>
        )}
        {isLoading && <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Falha ao carregar histórico."}</p>}
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="outline">{EVENT_LABELS[event.tipo]}</Badge>
                <span className="text-muted-foreground">{new Date(event.data_efetiva).toLocaleString("pt-BR")}</span>
              </div>
              <p className="mt-2">Quantidade: <strong>{event.quantidade}</strong> · executado por <strong>{event.executor_nome}</strong></p>
              <p className="text-muted-foreground">
                {event.localizacao_origem_nome ? `Origem: ${event.localizacao_origem_nome}` : ""}
                {event.localizacao_destino_nome ? `Destino: ${event.localizacao_destino_nome}` : ""}
              </p>
              {event.condicao && <p>Condição: {CUSTODY_CONDITION_LABELS[event.condicao]}</p>}
              {event.ocorrencia && <p className="text-destructive">Ocorrência: {event.ocorrencia}</p>}
              {event.observacao && <p>Observação: {event.observacao}</p>}
              {event.justificativa && <p>Justificativa: {event.justificativa}</p>}
              {event.status_operacional_resultante && <p>Classificação da baixa: {MATERIAL_STATUS_LABELS[event.status_operacional_resultante]}</p>}
              {event.movimento_estoque_id
                ? <p className="mt-1 font-mono text-xs text-muted-foreground">Movimento: {event.movimento_estoque_id}</p>
                : event.tipo === "correcao" && <p className="mt-1 text-xs text-muted-foreground">Sem entrada no estoque.</p>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
