import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { labelBatchTotal, labelModelToSnapshot, materialToLabelSnapshot } from "@/lib/material-label-domain";
import { openLabelPrintWindow, printLabelRequest } from "@/lib/material-label-print";
import { registerLabelPrintBatch } from "@/lib/material-label-service";
import type { LabelBatchSelection, LabelModel } from "@/lib/material-label-types";
import { LabelCanvas } from "./LabelCanvas";

export function LabelPrintDialog({ open, onOpenChange, companyId, companyName, model, items, onPrinted }: {
  open: boolean; onOpenChange: (open: boolean) => void; companyId: string; companyName: string;
  model: LabelModel | null; items: LabelBatchSelection[]; onPrinted: () => Promise<void>;
}) {
  const { toast } = useToast();
  const total = labelBatchTotal(items);
  const preview = useMemo(() => items.map((item) => ({
    key: item.material.id, quantity: item.quantity, material: materialToLabelSnapshot(item.material, companyName),
  })), [items, companyName]);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!model || !items.length || total < 1 || items.some((item) => item.quantity < 1 || item.quantity > 500)) throw new Error("Revise o modelo, os materiais e as quantidades.");
      const popup = openLabelPrintWindow();
      if (!popup) throw new Error("O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.");
      try {
        const record = await registerLabelPrintBatch(companyId, { model, items, clientUuid: crypto.randomUUID() });
        printLabelRequest(record, popup); return record;
      } catch (error) { popup.close(); throw error; }
    },
    onSuccess: async () => { await onPrinted(); toast({ title: "Lote de impressão solicitado", description: "Uma única solicitação registrou todos os materiais e snapshots." }); onOpenChange(false); },
    onError: (error: Error) => toast({ title: "Não foi possível imprimir", description: error.message, variant: "destructive" }),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>Pré-visualizar lote e imprimir</DialogTitle></DialogHeader>
    {model && <div className="space-y-4"><div className="rounded-md border p-3 text-sm"><strong>{items.length} material(is) · {total} etiqueta(s)</strong>{items.map((item) => <p key={item.material.id}>{item.material.nome} × {item.quantity}</p>)}</div>
      <div className="grid max-h-[50vh] gap-3 overflow-auto rounded-md bg-muted p-4 md:grid-cols-2">{preview.map((entry) => <div key={entry.key} className="mx-auto space-y-1"><p className="text-center text-xs font-medium">{entry.material.nome} × {entry.quantity}</p><div className="w-fit bg-white shadow"><LabelCanvas model={labelModelToSnapshot(model)} material={entry.material} scale={0.72} /></div></div>)}</div>
      <p className="text-center text-xs text-muted-foreground">A prévia e a impressão seguem a mesma ordem do lote. A escala e margens físicas finais dependem do navegador, driver e impressora.</p></div>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={!model || !items.length || total < 1 || total > 5000 || mutation.isPending} onClick={() => mutation.mutate()}><Printer className="mr-2 h-4 w-4" />{mutation.isPending ? "Preparando..." : "Registrar lote e imprimir"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
