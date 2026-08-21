import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ClipboardCheck, Loader2, PackageCheck, PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CheckinDialog } from "@/components/checkin-checkout/CheckinDialog";
import { listCustodyOperationsByReference } from "@/lib/checkin-checkout-service";
import { summarizeEventCustody, type EventCustodyMaterialSummary } from "@/lib/event-custody-domain";
import type { StockLocation } from "@/lib/stock-types";

function MaterialRow({
  item,
  badge,
  action,
}: {
  item: EventCustodyMaterialSummary;
  badge: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{item.materialNome}</p>
        <p className="text-xs text-muted-foreground">{item.materialCodigo}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="outline">{badge}</Badge>
        {action}
      </div>
    </div>
  );
}

// Primeira etapa da conferência de retorno por evento: mostra o que foi
// retirado/devolvido/pendente para o evento selecionado, e permite dar
// check-in direto de um material pendente. Reaproveita o CheckinDialog e a
// RPC de check-in já existentes por inteiro (mesma validação de quantidade/
// pendente que a aba "Operações em aberto" já usa) - nenhuma lógica de
// check-in nova foi criada aqui. Leitura em lote/QR/RFID por evento continua
// fora de escopo.
export function EventCustodyPanel({
  companyId,
  canCheckin,
  locations,
}: {
  companyId: string;
  canCheckin: boolean;
  locations: StockLocation[];
}) {
  const [eventId, setEventId] = useState("");
  const [checkinOperation, setCheckinOperation] = useState<
    EventCustodyMaterialSummary["custodiasAbertas"][number] | null
  >(null);
  const queryClient = useQueryClient();

  const eventsQuery = useQuery({
    queryKey: ["checkin-checkout-events", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date")
        .eq("empresa_id", companyId)
        .order("date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: Boolean(companyId),
  });
  const events = eventsQuery.data ?? [];

  const custodyQuery = useQuery({
    queryKey: ["event-custody-operations", companyId, eventId],
    queryFn: () => listCustodyOperationsByReference(companyId, "evento", eventId),
    enabled: Boolean(companyId) && Boolean(eventId),
  });

  const summary = custodyQuery.data ? summarizeEventCustody(custodyQuery.data) : null;

  const refreshAfterCheckin = async () => {
    await queryClient.invalidateQueries({ queryKey: ["event-custody-operations", companyId, eventId] });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 p-4">
          <Label>Evento</Label>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder={eventsQuery.isLoading ? "Carregando eventos..." : "Selecione um evento"} />
            </SelectTrigger>
            <SelectContent>
              {events.map((event) => (
                <SelectItem key={event.id} value={event.id}>
                  {event.name} · {format(parseISO(event.date), "dd/MM/yyyy")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Mostra as custódias registradas com finalidade Evento vinculadas ao evento selecionado.
          </p>
        </CardContent>
      </Card>

      {!eventId && (
        <p className="p-4 text-center text-sm text-muted-foreground">
          Selecione um evento para ver os materiais retirados e pendentes de devolução.
        </p>
      )}

      {eventId && custodyQuery.isLoading && (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      )}

      {eventId && custodyQuery.error && (
        <p className="text-sm text-destructive">
          {custodyQuery.error instanceof Error ? custodyQuery.error.message : "Não foi possível carregar as custódias do evento."}
        </p>
      )}

      {eventId && summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total retirado</p><p className="text-2xl font-bold">{summary.totalRetirado}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total devolvido</p><p className="text-2xl font-bold">{summary.totalDevolvido}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total pendente</p><p className="text-2xl font-bold">{summary.totalPendente}</p></CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PackageOpen className="h-4 w-4" /> Materiais pendentes
                  <Badge variant="secondary">{summary.materiaisPendentes.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary.materiaisPendentes.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">Nenhum material pendente.</p>
                ) : (
                  summary.materiaisPendentes.map((item) => (
                    <MaterialRow
                      key={item.materialId}
                      item={item}
                      badge={`${item.quantidadePendente} pendente(s) de ${item.quantidadeRetirada}`}
                      action={
                        canCheckin && item.custodiasAbertas.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCheckinOperation(item.custodiasAbertas[0])}
                          >
                            <ClipboardCheck className="mr-1 h-4 w-4" /> Fazer check-in
                          </Button>
                        )
                      }
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PackageCheck className="h-4 w-4" /> Materiais totalmente devolvidos
                  <Badge variant="secondary">{summary.materiaisDevolvidos.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary.materiaisDevolvidos.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">Nenhum material devolvido ainda.</p>
                ) : (
                  summary.materiaisDevolvidos.map((item) => (
                    <MaterialRow
                      key={item.materialId}
                      item={item}
                      badge={`${item.quantidadeRetirada} devolvido(s)`}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <CheckinDialog
        open={!!checkinOperation}
        onOpenChange={(open) => !open && setCheckinOperation(null)}
        companyId={companyId}
        operation={checkinOperation}
        locations={locations}
        onSaved={refreshAfterCheckin}
      />
    </div>
  );
}
