import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
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
import { registerCheckin } from "@/lib/checkin-checkout-service";
import {
  CUSTODY_CONDITION_LABELS,
  validateCheckin,
} from "@/lib/checkin-checkout-domain";
import type {
  CheckinInput,
  CustodyCondition,
  CustodyOperationView,
} from "@/lib/checkin-checkout-types";
import type { StockLocation } from "@/lib/stock-types";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { nowAsDatetimeLocalValue } from "@/lib/datetime";

const CONDITIONS = Object.keys(CUSTODY_CONDITION_LABELS) as CustodyCondition[];

export function CheckinDialog({
  open,
  onOpenChange,
  companyId,
  operation,
  locations,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  operation: CustodyOperationView | null;
  locations: StockLocation[];
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { hasModule } = useCompanyModules(companyId);
  const [quantity, setQuantity] = useState("1");
  const [destinationId, setDestinationId] = useState("");
  const [condition, setCondition] = useState<CustodyCondition>("bom");
  const [occurrence, setOccurrence] = useState("");
  const [note, setNote] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setQuantity(operation?.tipo_controle === "individual" ? "1" : "1");
    setDestinationId("");
    setCondition("bom");
    setOccurrence("");
    setNote("");
    setEffectiveAt(nowAsDatetimeLocalValue());
    setClientUuid(crypto.randomUUID());
    setErrors({});
  }, [open, operation]);

  const activeLocations = locations.filter((location) => location.ativa);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!operation) throw new Error("Operação não selecionada.");
      const input: CheckinInput = {
        custodyId: operation.id,
        quantity: Number(quantity),
        destinationLocationId: destinationId,
        returnCondition: condition,
        occurrence,
        note,
        effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : null,
        clientUuid,
      };
      const validation = validateCheckin(
        input,
        operation.quantidade_pendente,
        operation.tipo_controle === "individual",
      );
      setErrors(validation);
      if (Object.keys(validation).length) throw new Error("Revise os campos destacados.");
      return registerCheckin(companyId, input);
    },
    onSuccess: async () => {
      await onSaved();
      onOpenChange(false);
      const suggestsMaintenance = ["com_avaria", "danificado", "manutencao_necessaria"].includes(condition);
      toast({
        title: "Check-in registrado",
        description: suggestsMaintenance ? "A condição informada permite abrir uma ordem de manutenção." : undefined,
        action: suggestsMaintenance && hasModule(MODULE_KEYS.MANUTENCAO_EQUIPAMENTOS) && operation
          ? <ToastAction altText="Abrir ordem de manutenção" onClick={() => navigate(`/manutencoes?nova=1&custodia=${operation.id}`)}>Abrir manutenção</ToastAction>
          : undefined,
      });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível registrar o check-in", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check-in de material</DialogTitle>
          <DialogDescription>O retorno pode ser parcial para materiais controlados por quantidade.</DialogDescription>
        </DialogHeader>
        {operation && (
          <div className="flex gap-3 rounded-lg border p-3">
            <MaterialPhotoImage path={operation.foto_path} alt={operation.material_nome} className="h-20 w-20 shrink-0 rounded-md" />
            <div>
              <p className="font-semibold">{operation.material_nome}</p>
              <p className="text-sm text-muted-foreground">{operation.material_codigo} · responsável {operation.responsavel_nome}</p>
              <p className="mt-1 text-sm">
                Retirada {new Date(operation.retirada_em).toLocaleString("pt-BR")} · original {operation.quantidade_retirada} · já retornou {operation.quantidade_devolvida} · pendente <strong>{operation.quantidade_pendente}</strong>
              </p>
              {operation.previsao_retorno && <p className="text-sm">Previsão: {new Date(operation.previsao_retorno).toLocaleString("pt-BR")}</p>}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Quantidade devolvida *</Label>
            <Input type="number" min={1} step={1} max={operation?.quantidade_pendente} disabled={operation?.tipo_controle === "individual"} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            {errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}
          </div>
          <div className="space-y-2">
            <Label>Localização de retorno *</Label>
            <Select value={destinationId} onValueChange={setDestinationId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.codigo} · {location.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.destinationLocationId && <p className="text-xs text-destructive">{errors.destinationLocationId}</p>}
          </div>
          <div className="space-y-2">
            <Label>Condição no retorno *</Label>
            <Select value={condition} onValueChange={(value) => setCondition(value as CustodyCondition)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITIONS.map((item) => <SelectItem key={item} value={item}>{CUSTODY_CONDITION_LABELS[item]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="checkin-effective-at">Data/hora do retorno</Label>
            <Input id="checkin-effective-at" type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Ocorrência</Label>
            <Input value={occurrence} onChange={(event) => setOccurrence(event.target.value)} placeholder="Ex.: cabo ausente, case danificado" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Observações</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!operation || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar check-in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
