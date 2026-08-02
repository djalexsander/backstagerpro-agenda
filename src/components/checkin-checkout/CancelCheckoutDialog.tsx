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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cancelCheckout } from "@/lib/checkin-checkout-service";
import type { CustodyOperationView } from "@/lib/checkin-checkout-types";

export function CancelCheckoutDialog({
  open,
  onOpenChange,
  companyId,
  operation,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  operation: CustodyOperationView | null;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [justification, setJustification] = useState("");
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (!open) return;
    setJustification("");
    setClientUuid(crypto.randomUUID());
  }, [open, operation]);
  const mutation = useMutation({
    mutationFn: () => {
      if (!operation || !justification.trim()) throw new Error("Informe a justificativa.");
      return cancelCheckout(companyId, {
        custodyId: operation.id,
        justification,
        clientUuid,
      });
    },
    onSuccess: async () => {
      await onSaved();
      onOpenChange(false);
      toast({ title: "Check-out cancelado e estoque estornado" });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível cancelar", description: error.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar check-out</DialogTitle>
          <DialogDescription>
            O registro não será apagado. Um estorno explícito será criado no ledger. Operações com retorno parcial não podem ser canceladas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Justificativa *</Label>
          <Textarea value={justification} onChange={(event) => setJustification(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancelar com estorno
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
