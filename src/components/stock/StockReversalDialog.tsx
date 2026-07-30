import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { reverseStockMovement } from "@/lib/stock-service";
import type { StockMovementView } from "@/lib/stock-types";

export function StockReversalDialog({
  open,
  onOpenChange,
  companyId,
  movement,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  movement: StockMovementView | null;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [justification, setJustification] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setJustification("");
    setEffectiveAt("");
    setClientUuid(crypto.randomUUID());
  }, [open, movement]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!movement) throw new Error("Movimentação não identificada.");
      if (!justification.trim()) throw new Error("Informe a justificativa.");
      return reverseStockMovement(companyId, {
        movementId: movement.id,
        justification,
        effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : null,
        clientUuid,
      });
    },
    onSuccess: async () => {
      await onSaved();
      onOpenChange(false);
      toast({ title: "Estorno registrado" });
    },
    onError: (error: Error) =>
      toast({
        title: "Não foi possível estornar",
        description: error.message,
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Estornar movimentação</DialogTitle>
          <DialogDescription>
            O registro original permanecerá imutável. Uma movimentação
            compensatória será criada e poderá falhar se não houver saldo.
          </DialogDescription>
        </DialogHeader>
        {movement && (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">
              {movement.material_codigo} · {movement.material_nome}
            </p>
            <p className="text-muted-foreground">
              {movement.tipo_movimentacao} · {movement.quantidade} unidade(s) · saldo{" "}
              {movement.saldo_total_anterior} → {movement.saldo_total_posterior}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Impacto previsto: aplicar o efeito inverso nas localizações
              originais. A confirmação será recusada se o saldo atual não
              permitir a compensação.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label>Justificativa *</Label>
          <Textarea
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Data efetiva</Label>
          <Input
            type="datetime-local"
            value={effectiveAt}
            onChange={(event) => setEffectiveAt(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending || !movement}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar estorno
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
