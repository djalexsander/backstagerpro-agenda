import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { CUSTODY_PURPOSE_LABELS } from "@/lib/checkin-checkout-domain";
import type { CustodyOperationView } from "@/lib/checkin-checkout-types";

// Shown only when resolveCheckinOrigin finds 2+ open custodies pending for
// the identified material (checkin-checkout-domain.ts) - with a single open
// custody the caller skips this dialog and opens CheckinDialog directly.
// Each option is the full CustodyOperationView already fetched by the
// caller (listar_custodias_materiais already returns finalidade,
// localizacao_origem_nome and quantidade_pendente - no new field/RPC).
//
// referencia_tipo='evento' is enriched with the event's name/date, looked
// up only for the referencia_ids in this exact option set (never a full
// events list). referencia_tipo='locacao_item' is NOT enriched here:
// referencia_id points at material_locacao_itens, which has no identifying
// field of its own - the rental's actual identification (numero, dates,
// cliente) lives on the parent material_locacoes, a second hop away - and
// both tables' RLS additionally requires the locacao_materiais module
// ("Licensed tenant users read rentals" policy), which Check-in/Checkout's
// own module gate does not grant. A user with check-in access but no
// Locações access would silently get an empty lookup, so this was left
// alone rather than built as inconsistent-by-permission. Every other
// finalidade keeps showing localizacao_origem_nome, as before.
export function CheckinOriginDialog({
  open,
  onOpenChange,
  companyId,
  options,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  options: CustodyOperationView[];
  onSelect: (operation: CustodyOperationView) => void;
}) {
  const eventIds = Array.from(
    new Set(
      options
        .filter((option) => option.referencia_tipo === "evento" && option.referencia_id)
        .map((option) => option.referencia_id as string),
    ),
  );

  const eventsQuery = useQuery({
    queryKey: ["checkin-origin-events", companyId, eventIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date")
        .eq("empresa_id", companyId)
        .in("id", eventIds);
      if (error) throw error;
      return data;
    },
    enabled: open && Boolean(companyId) && eventIds.length > 0,
  });
  const eventsById = new Map((eventsQuery.data ?? []).map((event) => [event.id, event]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>De onde está voltando?</DialogTitle>
          <DialogDescription>
            Este material tem mais de uma custódia aberta. Selecione de qual operação ele está retornando.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map((option) => {
            const event =
              option.referencia_tipo === "evento" && option.referencia_id
                ? eventsById.get(option.referencia_id)
                : undefined;
            return (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal p-3 text-left"
                onClick={() => onSelect(option)}
              >
                <span className="font-medium">
                  {CUSTODY_PURPOSE_LABELS[option.finalidade]} ·{" "}
                  {event ? `${event.name} · ${format(parseISO(event.date), "dd/MM/yyyy")}` : option.localizacao_origem_nome}
                </span>
                <span className="text-xs text-muted-foreground">
                  {option.responsavel_nome} · {option.quantidade_pendente} pendente(s)
                </span>
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
