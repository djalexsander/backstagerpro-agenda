import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { nowAsDatetimeLocalValue } from "@/lib/datetime";
import { registerCustodyWriteOff } from "@/lib/checkin-checkout-service";
import type { CustodyOperationView, CustodyWriteOffClassification } from "@/lib/checkin-checkout-types";

const LABELS: Record<CustodyWriteOffClassification, string> = {
  extraviado: "Perdido / extraviado",
  avariado: "Avariado sem retorno físico",
  baixado: "Baixado definitivamente",
};

export function CustodyWriteOffDialog({ open, onOpenChange, companyId, operation, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  operation: CustodyOperationView | null;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [classification, setClassification] = useState<CustodyWriteOffClassification>("extraviado");
  const [justification, setJustification] = useState("");
  const [note, setNote] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open || !operation) return;
    setQuantity(operation.tipo_controle === "individual" ? 1 : operation.quantidade_pendente);
    setClassification("extraviado");
    setJustification("");
    setNote("");
    setEffectiveAt(nowAsDatetimeLocalValue());
    setClientUuid(crypto.randomUUID());
  }, [open, operation]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!operation) throw new Error("Custódia inválida.");
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > operation.quantidade_pendente) {
        throw new Error("Informe uma quantidade válida, limitada ao saldo pendente.");
      }
      if (!justification.trim()) throw new Error("Informe o motivo da baixa.");
      if (!effectiveAt) throw new Error("Informe a data e hora efetivas.");
      return registerCustodyWriteOff(companyId, {
        custodyId: operation.id, quantity, classification, justification, note,
        effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : null,
        clientUuid,
      });
    },
    onSuccess: async () => {
      await onSaved();
      onOpenChange(false);
      toast({ title: "Baixa de custódia registrada" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível registrar a baixa", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Baixar item sem retorno físico</DialogTitle>
          <DialogDescription>
            Esta operação encerra a quantidade perdida ou avariada, registra auditoria e não devolve saldo ao estoque.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1"><Label>Classificação *</Label><Select value={classification} onValueChange={(value) => setClassification(value as CustodyWriteOffClassification)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Quantidade * (pendente: {operation?.quantidade_pendente ?? 0})</Label><Input type="number" min={1} max={operation?.quantidade_pendente ?? 1} disabled={operation?.tipo_controle === "individual"} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
          <div className="space-y-1"><Label>Motivo *</Label><Textarea value={justification} onChange={(event) => setJustification(event.target.value)} /></div>
          <div className="space-y-1"><Label>Data/hora efetiva *</Label><Input type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /></div>
          <div className="space-y-1"><Label>Observação</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button><Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar baixa</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
