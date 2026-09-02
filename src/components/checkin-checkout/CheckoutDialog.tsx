import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MaterialPhotoImage } from "@/components/materials/MaterialPhotoImage";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { registerCheckout } from "@/lib/checkin-checkout-service";
import {
  CUSTODY_CONDITION_LABELS,
  CUSTODY_PURPOSE_LABELS,
  SELECTABLE_CUSTODY_PURPOSES,
  validateCheckout,
} from "@/lib/checkin-checkout-domain";
import type {
  CustodyCondition,
  CustodyMaterialSearchResult,
  CustodyPurpose,
  CustodyResponsibleOption,
  CheckoutInput,
} from "@/lib/checkin-checkout-types";
import { nowAsDatetimeLocalValue } from "@/lib/datetime";

// 'locacao' ('Locação futura') fica fora da lista selecionável: ver
// SELECTABLE_CUSTODY_PURPOSES em checkin-checkout-domain.ts (fonte única,
// compartilhada com o Scanner Remoto).
const PURPOSES = SELECTABLE_CUSTODY_PURPOSES;
const CONDITIONS = Object.keys(CUSTODY_CONDITION_LABELS) as CustodyCondition[];

export function CheckoutDialog({
  open,
  onOpenChange,
  companyId,
  material,
  responsibles,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  material: CustodyMaterialSearchResult | null;
  responsibles: CustodyResponsibleOption[];
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [originId, setOriginId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [responsibleValue, setResponsibleValue] = useState("");
  const [purpose, setPurpose] = useState<CustodyPurpose>("uso_interno");
  const [eventId, setEventId] = useState("");
  const [condition, setCondition] = useState<CustodyCondition>("bom");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [note, setNote] = useState("");
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const balances = useMemo(
    () => material?.saldos.filter((balance) => balance.localizacao_ativa) ?? [],
    [material],
  );

  // Only fetched when the operator actually picks "Evento" - events has no
  // RPC layer of its own (unlike materials), so this queries it directly,
  // the same way Agenda.tsx already does for the same table.
  const eventsQuery = useQuery({
    queryKey: ["checkout-events", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date")
        .eq("empresa_id", companyId)
        .order("date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: open && purpose === "evento" && Boolean(companyId),
  });
  const events = eventsQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    setOriginId(balances.length === 1 ? balances[0].localizacao_id : "");
    setQuantity("1");
    setResponsibleValue("");
    setPurpose("uso_interno");
    setEventId("");
    setCondition("bom");
    setExpectedReturn("");
    setEffectiveAt(nowAsDatetimeLocalValue());
    setNote("");
    setClientUuid(crypto.randomUUID());
    setErrors({});
  }, [balances, open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!material) throw new Error("Material não selecionado.");
      const separator = responsibleValue.indexOf(":");
      const responsibleType = responsibleValue.slice(0, separator) as
        | "usuario"
        | "funcionario";
      const responsibleId = separator >= 0 ? responsibleValue.slice(separator + 1) : "";
      const input: CheckoutInput = {
        materialId: material.id,
        quantity: Number(quantity),
        originLocationId: originId,
        responsibleType,
        responsibleId,
        purpose,
        condition,
        expectedReturn: expectedReturn
          ? new Date(expectedReturn).toISOString()
          : null,
        effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : null,
        note,
        referenceType: purpose === "evento" ? "evento" : undefined,
        referenceId: purpose === "evento" ? eventId : undefined,
        clientUuid,
      };
      const validation = validateCheckout(input, material);
      setErrors(validation);
      if (Object.keys(validation).length) {
        throw new Error("Revise os campos destacados.");
      }
      return registerCheckout(companyId, input);
    },
    onSuccess: async () => {
      await onSaved();
      onOpenChange(false);
      toast({ title: "Check-out registrado" });
    },
    onError: (error: Error) =>
      toast({
        title: "Não foi possível registrar o check-out",
        description: error.message,
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check-out de material</DialogTitle>
          <DialogDescription>
            A custódia e a saída do estoque serão gravadas na mesma transação.
          </DialogDescription>
        </DialogHeader>
        {material && (
          <div className="flex gap-3 rounded-lg border p-3">
            <MaterialPhotoImage
              path={material.foto_path}
              alt={material.nome}
              className="h-20 w-20 shrink-0 rounded-md"
            />
            <div className="min-w-0">
              <p className="font-semibold">{material.nome}</p>
              <p className="text-sm text-muted-foreground">
                {material.codigo_interno} · {material.tipo_controle === "individual" ? "Individual" : "Por quantidade"}
              </p>
              <p className="mt-1 text-sm">
                Disponível: {balances.reduce((sum, item) => sum + item.quantidade, 0)} {material.unidade_medida}
              </p>
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Localização de origem *</Label>
            <Select value={originId} onValueChange={setOriginId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {balances.map((balance) => (
                  <SelectItem key={balance.localizacao_id} value={balance.localizacao_id}>
                    {balance.localizacao_codigo} · {balance.localizacao_nome} ({balance.quantidade})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.originLocationId && <p className="text-xs text-destructive">{errors.originLocationId}</p>}
          </div>
          <div className="space-y-2">
            <Label>Quantidade *</Label>
            <Input
              type="number"
              min={1}
              step={1}
              disabled={material?.tipo_controle === "individual"}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            {errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Responsável físico *</Label>
            <Select value={responsibleValue} onValueChange={setResponsibleValue}>
              <SelectTrigger><SelectValue placeholder="Selecione usuário ou funcionário" /></SelectTrigger>
              <SelectContent>
                {responsibles.map((responsible) => (
                  <SelectItem
                    key={`${responsible.tipo}:${responsible.id}`}
                    value={`${responsible.tipo}:${responsible.id}`}
                  >
                    {responsible.nome} · {responsible.detalhe}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.responsibleId && <p className="text-xs text-destructive">{errors.responsibleId}</p>}
          </div>
          <div className="space-y-2">
            <Label>Finalidade *</Label>
            <Select value={purpose} onValueChange={(value) => setPurpose(value as CustodyPurpose)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PURPOSES.map((item) => (
                  <SelectItem key={item} value={item}>{CUSTODY_PURPOSE_LABELS[item]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {purpose === "evento" && (
            <div className="space-y-2">
              <Label>Evento *</Label>
              <Select value={eventId} onValueChange={setEventId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={eventsQuery.isLoading ? "Carregando eventos..." : "Selecione o evento"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {events.map((event) => (
                    <SelectItem key={event.id} value={event.id}>
                      {event.name} · {format(parseISO(event.date), "dd/MM/yyyy")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.referenceId && <p className="text-xs text-destructive">{errors.referenceId}</p>}
            </div>
          )}
          <div className="space-y-2">
            <Label>Condição na saída *</Label>
            <Select value={condition} onValueChange={(value) => setCondition(value as CustodyCondition)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITIONS.map((item) => (
                  <SelectItem key={item} value={item}>{CUSTODY_CONDITION_LABELS[item]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="checkout-effective-at">Data/hora da retirada</Label>
            <Input id="checkout-effective-at" type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="checkout-expected-return">Previsão de retorno</Label>
            <Input id="checkout-expected-return" type="datetime-local" value={expectedReturn} onChange={(event) => setExpectedReturn(event.target.value)} />
            {errors.expectedReturn && <p className="text-xs text-destructive">{errors.expectedReturn}</p>}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Observações</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!material || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar check-out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
