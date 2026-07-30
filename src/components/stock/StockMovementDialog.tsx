import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import {
  adjustStock,
  registerStockMovement,
} from "@/lib/stock-service";
import {
  validateStockAdjustment,
  validateStockMovement,
} from "@/lib/stock-domain";
import type {
  StockLocation,
  StockMaterial,
  StockMovementInput,
} from "@/lib/stock-types";

type Operation =
  | StockMovementInput["type"]
  | "ajuste";

const TITLES: Record<Operation, string> = {
  saldo_inicial: "Registrar saldo inicial",
  entrada: "Registrar entrada",
  saida: "Registrar saída",
  transferencia: "Registrar transferência",
  ajuste: "Ajustar saldo físico",
};

export function StockMovementDialog({
  open,
  onOpenChange,
  companyId,
  material,
  locations,
  initialOperation = "entrada",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  material: StockMaterial | null;
  locations: StockLocation[];
  initialOperation?: Operation;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [operation, setOperation] = useState<Operation>(initialOperation);
  const [quantity, setQuantity] = useState("1");
  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [reason, setReason] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("contagem física");
  const [note, setNote] = useState("");
  const [referenceDocument, setReferenceDocument] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setOperation(initialOperation);
    setQuantity(material?.tipo_controle === "individual" ? "1" : "1");
    setOriginId("");
    setDestinationId("");
    setReason("");
    setAdjustmentReason("contagem física");
    setNote("");
    setReferenceDocument("");
    setEffectiveAt("");
    setErrors({});
    setClientUuid(crypto.randomUUID());
  }, [initialOperation, material, open]);

  const activeLocations = locations.filter((location) => location.ativa);
  const originLocations = useMemo(() => {
    if (!material) return locations;
    const ids = new Set(
      material.saldos
        .filter((balance) => balance.quantidade > 0)
        .map((balance) => balance.localizacao_id),
    );
    return locations.filter((location) => ids.has(location.id));
  }, [locations, material]);
  const adjustmentLocations = useMemo(() => {
    const locationsWithBalance = new Set(
      material?.saldos
        .filter((balance) => balance.quantidade > 0)
        .map((balance) => balance.localizacao_id) ?? [],
    );
    return locations.filter(
      (location) => location.ativa || locationsWithBalance.has(location.id),
    );
  }, [locations, material]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!material) throw new Error("Selecione o material.");
      const numericQuantity = Number(quantity);
      if (operation === "ajuste") {
        const input = {
          materialId: material.id,
          locationId: destinationId,
          physicalQuantity: numericQuantity,
          reason: adjustmentReason,
          justification: reason,
          note,
          effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : null,
          clientUuid,
        };
        const validation = validateStockAdjustment(
          input,
          material.tipo_controle === "individual",
        );
        setErrors(validation);
        if (Object.keys(validation).length) {
          throw new Error("Revise os campos destacados.");
        }
        return adjustStock(companyId, input);
      }
      const input: StockMovementInput = {
        materialId: material.id,
        type: operation,
        quantity: numericQuantity,
        originLocationId: originId || null,
        destinationLocationId: destinationId || null,
        reason,
        note,
        referenceDocument,
        effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : null,
        clientUuid,
      };
      const validation = validateStockMovement(
        input,
        material.tipo_controle === "individual",
      );
      setErrors(validation);
      if (Object.keys(validation).length) {
        throw new Error("Revise os campos destacados.");
      }
      return registerStockMovement(companyId, input);
    },
    onSuccess: async () => {
      await onSaved();
      onOpenChange(false);
      toast({ title: `${TITLES[operation]} concluído` });
    },
    onError: (error: Error) =>
      toast({
        title: "Não foi possível concluir a operação",
        description: error.message,
        variant: "destructive",
      }),
  });

  const needsOrigin = operation === "saida" || operation === "transferencia";
  const needsDestination =
    operation === "entrada" ||
    operation === "transferencia" ||
    operation === "saldo_inicial" ||
    operation === "ajuste";
  const selectedBalance =
    material?.saldos.find((balance) => balance.localizacao_id === destinationId)
      ?.quantidade ?? 0;
  const physicalQuantity = Number(quantity);
  const adjustmentDifference =
    Number.isFinite(physicalQuantity) ? physicalQuantity - selectedBalance : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{TITLES[operation]}</DialogTitle>
          <DialogDescription>
            {material
              ? `${material.codigo_interno} · ${material.nome} · saldo atual ${material.quantidade}`
              : "Selecione um material na listagem."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {operation === "saldo_inicial" &&
            material?.quantidade_legada_etapa1 != null && (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Referência legada da Etapa 1:{" "}
                <strong>{material.quantidade_legada_etapa1}</strong>. Confira
                fisicamente e informe o saldo; esse valor não é aplicado
                automaticamente.
              </p>
            )}
          <div className="space-y-2">
            <Label>Operação</Label>
            <Select
              value={operation}
              onValueChange={(value) => {
                setOperation(value as Operation);
                setErrors({});
                setClientUuid(crypto.randomUUID());
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="saldo_inicial">Saldo inicial</SelectItem>
                <SelectItem value="entrada">Entrada</SelectItem>
                <SelectItem value="saida">Saída</SelectItem>
                <SelectItem value="transferencia">Transferência</SelectItem>
                <SelectItem value="ajuste">Ajuste físico</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {needsOrigin && (
            <div className="space-y-2">
              <Label>Origem</Label>
              <Select value={originId} onValueChange={setOriginId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {originLocations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.codigo} · {location.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.originLocationId && (
                <p className="text-xs text-destructive">{errors.originLocationId}</p>
              )}
            </div>
          )}
          {needsDestination && (
            <div className="space-y-2">
              <Label>{operation === "ajuste" ? "Localização" : "Destino"}</Label>
              <Select value={destinationId} onValueChange={setDestinationId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(operation === "ajuste"
                    ? adjustmentLocations
                    : activeLocations
                  ).map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.codigo} · {location.nome}
                      {!location.ativa ? " (inativa; somente redução)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(errors.destinationLocationId || errors.locationId) && (
                <p className="text-xs text-destructive">
                  {errors.destinationLocationId || errors.locationId}
                </p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label>
              {operation === "ajuste" ? "Quantidade física contada" : "Quantidade"}
            </Label>
            <Input
              type="number"
              min={operation === "ajuste" ? 0 : 1}
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            {(errors.quantity || errors.physicalQuantity) && (
              <p className="text-xs text-destructive">
                {errors.quantity || errors.physicalQuantity}
              </p>
            )}
            {operation === "ajuste" && destinationId && (
              <p className="rounded-md bg-muted p-2 text-xs">
                Saldo atual: <strong>{selectedBalance}</strong> · diferença:{" "}
                <strong>
                  {adjustmentDifference > 0 ? "+" : ""}
                  {adjustmentDifference}
                </strong>
              </p>
            )}
          </div>
          {operation === "ajuste" && (
            <div className="space-y-2">
              <Label>Motivo *</Label>
              <Select
                value={adjustmentReason}
                onValueChange={setAdjustmentReason}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[
                    "contagem física",
                    "correção de cadastro",
                    "perda",
                    "avaria",
                    "extravio",
                    "localização incorreta",
                    "outro",
                  ].map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.reason && (
                <p className="text-xs text-destructive">{errors.reason}</p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label>
              {operation === "ajuste"
                ? "Justificativa *"
                : operation === "entrada" || operation === "saida"
                  ? "Motivo *"
                  : "Motivo"}
            </Label>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            {errors.justification && (
              <p className="text-xs text-destructive">
                {errors.justification}
              </p>
            )}
            {operation !== "ajuste" && errors.reason && (
              <p className="text-xs text-destructive">{errors.reason}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Observação</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          {operation !== "ajuste" && (
            <div className="space-y-2">
              <Label>Documento de referência</Label>
              <Input
                value={referenceDocument}
                onChange={(event) => setReferenceDocument(event.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Data efetiva</Label>
            <Input
              type="datetime-local"
              value={effectiveAt}
              onChange={(event) => setEffectiveAt(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={mutation.isPending || !material}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
