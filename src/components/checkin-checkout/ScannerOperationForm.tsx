import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  CUSTODY_CONDITION_LABELS,
  CUSTODY_PURPOSE_LABELS,
  SELECTABLE_CUSTODY_PURPOSES,
} from "@/lib/checkin-checkout-domain";
import { searchCustodyMaterials } from "@/lib/checkin-checkout-service";
import { getMaterialRental, listMaterialRentals } from "@/lib/material-rental-service";
import { RENTAL_STATUS_LABELS } from "@/lib/material-rental-domain";
import {
  describePendingReadContext,
  isOperableRentalStatus,
  resolveRentalItemForMaterial,
  scannerOriginDestinationInvalid,
  type ScannerCheckinContext,
  type ScannerCheckoutContext,
  type ScannerOperationContext,
  type ScannerPendingRead,
} from "@/lib/scanner-remoto-domain";
import type {
  CustodyCondition,
  CustodyPurpose,
  CustodyResponsibleOption,
} from "@/lib/checkin-checkout-types";
import type { RentalFilters } from "@/lib/material-rental-types";
import type { StockLocation } from "@/lib/stock-types";

const CONDITIONS = Object.keys(CUSTODY_CONDITION_LABELS) as CustodyCondition[];

const RENTAL_QUEUE_FILTERS: RentalFilters = {
  search: "",
  status: "todos",
  customerId: "",
  dateFrom: "",
  dateTo: "",
  overdueOnly: false,
  responsible: "",
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

function ContextLines({ pendingRead }: { pendingRead: ScannerPendingRead }) {
  const context = describePendingReadContext(pendingRead.resumo, pendingRead.selectedCustody);
  return (
    <div className="rounded-md border p-2 text-sm">
      <p className="text-xs text-muted-foreground">Origem</p>
      <p className="font-medium">{context.headline}</p>
      {context.lines.length > 0 && (
        <dl className="mt-1 space-y-0.5">
          {context.lines.map((line) => (
            <div key={line.label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd className="text-right">{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ============================================================================
// CHECK-IN
// ============================================================================

function ScannerCheckinForm({
  pendingRead,
  locations,
  canCheckin,
  onCancel,
  onConfirm,
}: {
  pendingRead: ScannerPendingRead;
  locations: StockLocation[];
  canCheckin: boolean;
  onCancel: () => void;
  onConfirm: (context: ScannerOperationContext) => void;
}) {
  const custody = pendingRead.selectedCustody;
  const activeLocations = useMemo(
    () => locations.filter((location) => location.ativa),
    [locations],
  );
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [returnCondition, setReturnCondition] = useState<CustodyCondition>("bom");
  const [error, setError] = useState("");

  if (!canCheckin) {
    return (
      <BlockedNote message="Sua conta não tem permissão para check-in." onCancel={onCancel} />
    );
  }
  if (!custody) {
    return (
      <BlockedNote
        message="Este material não possui check-out em aberto para devolver."
        onCancel={onCancel}
      />
    );
  }

  const handleConfirm = () => {
    if (!destinationLocationId) {
      setError("Selecione a localização de destino.");
      return;
    }
    const context: ScannerCheckinContext = {
      operation: "checkin",
      custodyId: custody.custodia_id,
      originLocationId: custody.localizacao_origem_id,
      destinationLocationId,
      returnCondition,
      rental:
        custody.referencia_tipo === "locacao_item" && custody.locacao && custody.referencia_id
          ? { rentalId: custody.locacao.locacao_id, rentalItemId: custody.referencia_id }
          : null,
    };
    if (scannerOriginDestinationInvalid(context)) {
      setError("Origem e destino não podem ser a mesma localização.");
      return;
    }
    setError("");
    onConfirm(context);
  };

  return (
    <div className="space-y-3">
      <ContextLines pendingRead={pendingRead} />

      <div className="space-y-1.5">
        <Label>Localização de destino</Label>
        <Select value={destinationLocationId} onValueChange={setDestinationLocationId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {activeLocations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {location.codigo} · {location.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Condição de retorno</Label>
        <Select
          value={returnCondition}
          onValueChange={(value) => setReturnCondition(value as CustodyCondition)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITIONS.map((item) => (
              <SelectItem key={item} value={item}>
                {CUSTODY_CONDITION_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FieldError message={error} />
      <FormActions
        confirmLabel="Confirmar Check-in"
        onCancel={onCancel}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

// ============================================================================
// CHECK-OUT
// ============================================================================

function ScannerCheckoutForm({
  pendingRead,
  companyId,
  responsibles,
  rentalModuleEnabled,
  canCheckout,
  onCancel,
  onConfirm,
}: {
  pendingRead: ScannerPendingRead;
  companyId: string;
  responsibles: CustodyResponsibleOption[];
  rentalModuleEnabled: boolean;
  canCheckout: boolean;
  onCancel: () => void;
  onConfirm: (context: ScannerOperationContext) => void;
}) {
  const [originLocationId, setOriginLocationId] = useState("");
  const [responsibleValue, setResponsibleValue] = useState("");
  const [purpose, setPurpose] = useState<CustodyPurpose | "">("");
  const [condition, setCondition] = useState<CustodyCondition>("bom");
  const [eventId, setEventId] = useState("");
  const [rentalId, setRentalId] = useState("");
  const [error, setError] = useState("");

  // Origem: localizações onde o material tem saldo (mesma RPC read-only do
  // CheckoutDialog). Não movimenta.
  const saldosQuery = useQuery({
    queryKey: ["scanner-checkout-saldos", companyId, pendingRead.material.id],
    queryFn: () => searchCustodyMaterials(companyId, pendingRead.code),
    enabled: canCheckout,
  });
  const validOrigins = useMemo(() => {
    const match =
      (saldosQuery.data ?? []).find((item) => item.id === pendingRead.material.id) ??
      (saldosQuery.data ?? [])[0];
    return (match?.saldos ?? []).filter(
      (saldo) => saldo.quantidade > 0 && saldo.localizacao_ativa,
    );
  }, [saldosQuery.data, pendingRead.material.id]);
  const soleOrigin = validOrigins.length === 1 ? validOrigins[0] : null;
  const effectiveOriginId = soleOrigin?.localizacao_id ?? originLocationId;

  const eventsQuery = useQuery({
    queryKey: ["scanner-checkout-events", companyId],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("events")
        .select("id, name, date")
        .eq("empresa_id", companyId)
        .order("date", { ascending: true });
      if (queryError) throw queryError;
      return data;
    },
    enabled: canCheckout && purpose === "evento",
  });

  const rentalsQuery = useQuery({
    queryKey: ["scanner-checkout-rentals", companyId],
    queryFn: () =>
      listMaterialRentals({ companyId, page: 1, pageSize: 200, filters: RENTAL_QUEUE_FILTERS }),
    enabled: canCheckout && purpose === "cliente" && rentalModuleEnabled,
  });
  const operableRentals = useMemo(
    () => (rentalsQuery.data?.items ?? []).filter((rental) => isOperableRentalStatus(rental.status)),
    [rentalsQuery.data],
  );

  const rentalDetailQuery = useQuery({
    queryKey: ["scanner-checkout-rental-detail", companyId, rentalId],
    queryFn: () => getMaterialRental(companyId, rentalId),
    enabled: canCheckout && purpose === "cliente" && rentalModuleEnabled && Boolean(rentalId),
  });
  const rentalItemId = useMemo(() => {
    if (!rentalDetailQuery.data) return null;
    return resolveRentalItemForMaterial(rentalDetailQuery.data.itens, pendingRead.material.id);
  }, [rentalDetailQuery.data, pendingRead.material.id]);
  const materialNotInRental = Boolean(rentalId) && rentalDetailQuery.isSuccess && rentalItemId === null;

  if (!canCheckout) {
    return (
      <BlockedNote message="Sua conta não tem permissão para check-out." onCancel={onCancel} />
    );
  }

  const handleConfirm = () => {
    if (saldosQuery.isLoading) return;
    if (validOrigins.length === 0) {
      setError("Este material não tem saldo disponível para check-out.");
      return;
    }
    if (!effectiveOriginId) {
      setError("Selecione a localização de origem.");
      return;
    }
    const separator = responsibleValue.indexOf(":");
    const responsibleType = responsibleValue.slice(0, separator);
    const responsibleId = separator >= 0 ? responsibleValue.slice(separator + 1) : "";
    if (!responsibleType || !responsibleId) {
      setError("Selecione o responsável.");
      return;
    }
    if (!purpose) {
      setError("Selecione a finalidade.");
      return;
    }
    if (purpose === "evento" && !eventId) {
      setError("Selecione o evento.");
      return;
    }
    if (purpose === "cliente") {
      if (!rentalModuleEnabled) {
        setError("O módulo Locação de Materiais precisa estar ativo para vincular a um cliente.");
        return;
      }
      if (!rentalId) {
        setError("Selecione a locação.");
        return;
      }
      if (rentalItemId === null) {
        setError("Este material não pertence à locação selecionada.");
        return;
      }
    }

    const rentalContext =
      purpose === "cliente" && rentalId && rentalItemId
        ? { rentalId, rentalItemId }
        : null;
    const context: ScannerCheckoutContext = {
      operation: "checkout",
      originLocationId: effectiveOriginId,
      responsibleType: responsibleType as ScannerCheckoutContext["responsibleType"],
      responsibleId,
      condition,
      // Nunca 'locacao' no seletor: o operador escolhe "Cliente" e a
      // tradução para o fluxo oficial de Locação acontece na E5.
      purpose: purpose as ScannerCheckoutContext["purpose"],
      event: purpose === "evento" ? { referenceType: "evento", referenceId: eventId } : null,
      rental: rentalContext,
    };
    setError("");
    onConfirm(context);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Localização de origem</Label>
        {saldosQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Verificando saldo…
          </p>
        ) : validOrigins.length === 0 ? (
          <p className="text-sm text-destructive">
            Este material não tem saldo disponível para check-out.
          </p>
        ) : soleOrigin ? (
          <p className="rounded-md border p-2 text-sm">
            {soleOrigin.localizacao_codigo} · {soleOrigin.localizacao_nome} ({soleOrigin.quantidade})
          </p>
        ) : (
          <Select value={originLocationId} onValueChange={setOriginLocationId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {validOrigins.map((saldo) => (
                <SelectItem key={saldo.localizacao_id} value={saldo.localizacao_id}>
                  {saldo.localizacao_codigo} · {saldo.localizacao_nome} ({saldo.quantidade})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Responsável</Label>
        <Select value={responsibleValue} onValueChange={setResponsibleValue}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {responsibles.map((responsible) => (
              <SelectItem
                key={`${responsible.tipo}:${responsible.id}`}
                value={`${responsible.tipo}:${responsible.id}`}
              >
                {responsible.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Finalidade</Label>
        <Select
          value={purpose}
          onValueChange={(value) => {
            setPurpose(value as CustodyPurpose);
            setEventId("");
            setRentalId("");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {SELECTABLE_CUSTODY_PURPOSES.map((item) => (
              <SelectItem key={item} value={item}>
                {CUSTODY_PURPOSE_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {purpose === "evento" && (
        <div className="space-y-1.5">
          <Label>Evento</Label>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger>
              <SelectValue
                placeholder={eventsQuery.isLoading ? "Carregando eventos…" : "Selecione o evento"}
              />
            </SelectTrigger>
            <SelectContent>
              {(eventsQuery.data ?? []).map((event) => (
                <SelectItem key={event.id} value={event.id}>
                  {event.name} · {format(parseISO(event.date), "dd/MM/yyyy")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {purpose === "cliente" && (
        <div className="space-y-1.5">
          <Label>Locação</Label>
          {!rentalModuleEnabled ? (
            <p className="text-sm text-destructive">
              O módulo Locação de Materiais precisa estar ativo para vincular a um cliente.
            </p>
          ) : (
            <>
              <Select value={rentalId} onValueChange={setRentalId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={rentalsQuery.isLoading ? "Carregando locações…" : "Selecione a locação"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {operableRentals.map((rental) => (
                    <SelectItem key={rental.id} value={rental.id}>
                      {rental.numero} · {rental.cliente_nome_fantasia || rental.cliente_nome} ·{" "}
                      {RENTAL_STATUS_LABELS[rental.status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {materialNotInRental && (
                <p className="text-xs text-destructive">
                  Este material não pertence à locação selecionada.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Condição na saída</Label>
        <Select value={condition} onValueChange={(value) => setCondition(value as CustodyCondition)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITIONS.map((item) => (
              <SelectItem key={item} value={item}>
                {CUSTODY_CONDITION_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FieldError message={error} />
      <FormActions
        confirmLabel="Confirmar Check-out"
        confirmDisabled={materialNotInRental}
        onCancel={onCancel}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

// ============================================================================
// Shared bits
// ============================================================================

function BlockedNote({ message, onCancel }: { message: string; onCancel: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-destructive">{message}</p>
      <Button type="button" size="sm" variant="outline" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

function FormActions({
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="button" disabled={confirmDisabled} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
}

// E5: estado "pronto" - o operationContext já está montado e validado. Aqui o
// "Confirmar" REGISTRA a movimentação (onExecute -> registrar_leitura_scanner_
// remoto com o contexto). Sucesso: o pai limpa o pendingRead (este componente
// desmonta). Erro: onExecute rejeita, a mensagem aparece aqui e a leitura
// continua pendente para retry.
function ScannerOperationReady({
  context,
  onExecute,
  onEditAgain,
}: {
  context: ScannerOperationContext;
  onExecute: (context: ScannerOperationContext) => Promise<void>;
  onEditAgain: () => void;
}) {
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const isCheckin = context.operation === "checkin";

  const handleExecute = async () => {
    setExecuting(true);
    setError("");
    try {
      await onExecute(context);
      // sucesso: o pai limpa o pendingRead e este componente desmonta.
    } catch (executeError) {
      setError(
        executeError instanceof Error
          ? executeError.message
          : "Não foi possível registrar a operação.",
      );
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
      <p className="font-medium">
        {isCheckin ? "Check-in pronto" : "Check-out pronto"}
      </p>
      <p className="text-muted-foreground">
        Confira o contexto e confirme para registrar a movimentação.
      </p>
      <FieldError message={error} />
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onEditAgain}
          disabled={executing}
        >
          Refazer
        </Button>
        <Button type="button" onClick={handleExecute} disabled={executing}>
          {executing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isCheckin ? (
            "Confirmar Check-in"
          ) : (
            "Confirmar Check-out"
          )}
        </Button>
      </div>
    </div>
  );
}

// E4.5/E5: monta o contexto da operação escolhida (check-in ou check-out) e,
// quando pronto, executa a movimentação na confirmação final.
export function ScannerOperationForm({
  pendingRead,
  companyId,
  locations,
  responsibles,
  rentalModuleEnabled,
  canCheckout,
  canCheckin,
  onCancel,
  onConfirm,
  onEditAgain,
  onExecute,
}: {
  pendingRead: ScannerPendingRead;
  companyId: string;
  locations: StockLocation[];
  responsibles: CustodyResponsibleOption[];
  rentalModuleEnabled: boolean;
  canCheckout: boolean;
  canCheckin: boolean;
  onCancel: () => void;
  onConfirm: (context: ScannerOperationContext) => void;
  onEditAgain: () => void;
  onExecute: (context: ScannerOperationContext) => Promise<void>;
}) {
  const readyContext = pendingRead.operationContext;

  if (readyContext) {
    return (
      <ScannerOperationReady
        context={readyContext}
        onExecute={onExecute}
        onEditAgain={onEditAgain}
      />
    );
  }

  if (pendingRead.selectedOperation === "checkin") {
    return (
      <ScannerCheckinForm
        pendingRead={pendingRead}
        locations={locations}
        canCheckin={canCheckin}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }

  return (
    <ScannerCheckoutForm
      pendingRead={pendingRead}
      companyId={companyId}
      responsibles={responsibles}
      rentalModuleEnabled={rentalModuleEnabled}
      canCheckout={canCheckout}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
