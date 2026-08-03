import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MaterialPhotoImage } from "@/components/materials/MaterialPhotoImage";
import { useToast } from "@/hooks/use-toast";
import { createMaintenanceOrder, getCheckinMaintenanceSuggestion, searchMaintenanceMaterials } from "@/lib/equipment-maintenance-service";
import { MAINTENANCE_PRIORITY_LABELS, MAINTENANCE_TYPE_LABELS, normalizeMaintenanceSearch } from "@/lib/equipment-maintenance-domain";
import type { CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import type { MaintenanceExecution, MaintenanceMaterialOption, MaintenanceOrigin, MaintenancePriority, MaintenanceType } from "@/lib/equipment-maintenance-types";

export function NewMaintenanceDialog({ open, onOpenChange, companyId, responsibles, custodyId, onCreated }: {
  open: boolean; onOpenChange: (open: boolean) => void; companyId: string;
  responsibles: CustodyResponsibleOption[]; custodyId?: string | null; onCreated: (id: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [materials, setMaterials] = useState<MaintenanceMaterialOption[]>([]);
  const [material, setMaterial] = useState<MaintenanceMaterialOption | null>(null);
  const [type, setType] = useState<MaintenanceType>("corretiva");
  const [priority, setPriority] = useState<MaintenancePriority>("normal");
  const [origin, setOrigin] = useState<MaintenanceOrigin>("manual");
  const [defect, setDefect] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [responsible, setResponsible] = useState("");
  const [expected, setExpected] = useState("");
  const [entryCondition, setEntryCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [execution, setExecution] = useState<MaintenanceExecution>("interna");
  const [supplier, setSupplier] = useState("");
  const [interval, setInterval] = useState("");
  const [custodyEventId, setCustodyEventId] = useState<string | undefined>();
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setClientUuid(crypto.randomUUID());
    if (!custodyId) return;
    void getCheckinMaintenanceSuggestion(companyId, custodyId).then(async (suggestion) => {
      if (!suggestion) return;
      const options = await searchMaintenanceMaterials(companyId, suggestion.material_id);
      const found = options.find((item) => item.id === suggestion.material_id) ?? null;
      setMaterial(found); setOrigin("checkin"); setType("corretiva");
      setDefect(suggestion.defeito_relatado); setEntryCondition(suggestion.condicao);
      setQuantity(found?.tipo_controle === "individual" ? 1 : suggestion.quantidade);
      setCustodyEventId(suggestion.evento_id);
    }).catch((error: Error) => toast({ title: "Não foi possível carregar a avaria", description: error.message, variant: "destructive" }));
  }, [open, companyId, custodyId, toast]);

  const findMaterials = async () => {
    const normalized = normalizeMaintenanceSearch(search);
    if (!normalized) return;
    try { setMaterials(await searchMaintenanceMaterials(companyId, normalized)); }
    catch (error) { toast({ title: "Falha ao localizar material", description: (error as Error).message, variant: "destructive" }); }
  };
  const mutation = useMutation({
    mutationFn: async () => {
      if (!material || !defect.trim()) throw new Error("Selecione o material e informe o motivo/defeito.");
      if (execution === "externa" && !supplier.trim()) throw new Error("Informe o fornecedor externo.");
      const [responsibleType, responsibleId] = responsible ? responsible.split(":") : [];
      return createMaintenanceOrder(companyId, { materialId: material.id, type, priority, origin, defect,
        affectedQuantity: material.tipo_controle === "individual" ? 1 : quantity,
        responsibleType: responsibleType as "usuario" | "funcionario" | undefined, responsibleId,
        expectedCompletion: expected, entryCondition, notes, execution, externalSupplier: supplier,
        preventiveIntervalDays: interval ? Number(interval) : undefined, custodyEventId, clientUuid });
    },
    onSuccess: async (order) => { await onCreated(order.id); onOpenChange(false); toast({ title: "Ordem de manutenção criada" }); },
    onError: (error: Error) => toast({ title: "Não foi possível criar a ordem", description: error.message, variant: "destructive" }),
  });

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
    <DialogHeader><DialogTitle>Nova ordem de manutenção</DialogTitle><DialogDescription>A abertura torna a quantidade afetada operacionalmente indisponível, sem alterar o estoque físico.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <div className="flex gap-2"><Input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findMaterials(); } }} placeholder="Nome, código, QR, serial ou patrimônio" disabled={origin === "checkin"} /><Button variant="outline" onClick={() => void findMaterials()} disabled={origin === "checkin"}><ScanLine className="mr-2 h-4 w-4" />Localizar</Button></div>
      {!!materials.length && !material && <div className="grid gap-2 sm:grid-cols-2">{materials.map((item) => <button key={item.id} type="button" className="rounded-md border p-3 text-left hover:border-primary" onClick={() => { setMaterial(item); setQuantity(1); }}><strong>{item.nome}</strong><p className="text-xs text-muted-foreground">{item.codigo_interno} · {item.tipo_controle === "individual" ? "Individual" : `${item.quantidade} ${item.unidade_medida}`}</p></button>)}</div>}
      {material && <div className="flex items-center gap-3 rounded-md border p-3"><MaterialPhotoImage path={material.foto_path} alt={material.nome} className="h-16 w-16 rounded-md" /><div><strong>{material.nome}</strong><p className="text-sm text-muted-foreground">{material.codigo_interno} · {material.numero_serie || material.numero_patrimonio || material.identificador_unico}</p></div>{origin !== "checkin" && <Button className="ml-auto" variant="ghost" onClick={() => setMaterial(null)}>Trocar</Button>}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label>Tipo *</Label><Select value={type} onValueChange={(value) => setType(value as MaintenanceType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(MAINTENANCE_TYPE_LABELS).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Prioridade *</Label><Select value={priority} onValueChange={(value) => setPriority(value as MaintenancePriority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(MAINTENANCE_PRIORITY_LABELS).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        {material?.tipo_controle === "quantidade" && <div><Label>Quantidade afetada *</Label><Input type="number" min={1} max={material.quantidade} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>}
        <div><Label>Responsável/técnico</Label><Select value={responsible || "sem_responsavel"} onValueChange={(value) => setResponsible(value === "sem_responsavel" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sem_responsavel">A definir</SelectItem>{responsibles.map((item) => <SelectItem key={`${item.tipo}:${item.id}`} value={`${item.tipo}:${item.id}`}>{item.nome}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Previsão de conclusão</Label><Input type="datetime-local" value={expected} onChange={(event) => setExpected(event.target.value)} /></div>
        <div><Label>Execução</Label><Select value={execution} onValueChange={(value) => setExecution(value as MaintenanceExecution)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="interna">Interna</SelectItem><SelectItem value="externa">Fornecedor externo</SelectItem></SelectContent></Select></div>
        {execution === "externa" && <div><Label>Fornecedor externo *</Label><Input value={supplier} onChange={(event) => setSupplier(event.target.value)} /></div>}
        {type === "preventiva" && <div><Label>Intervalo preventivo (dias)</Label><Input type="number" min={1} max={3650} value={interval} onChange={(event) => setInterval(event.target.value)} /></div>}
        <div className="sm:col-span-2"><Label>Defeito / motivo *</Label><Textarea value={defect} onChange={(event) => setDefect(event.target.value)} /></div>
        <div><Label>Condição de entrada</Label><Input value={entryCondition} onChange={(event) => setEntryCondition(event.target.value)} /></div>
        <div><Label>Observações</Label><Input value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      </div>
    </div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={mutation.isPending || !material || !defect.trim()} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Abrir ordem</Button></DialogFooter>
  </DialogContent></Dialog>;
}
