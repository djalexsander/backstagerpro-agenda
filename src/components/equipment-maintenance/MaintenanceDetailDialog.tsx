import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MaterialPhotoImage } from "@/components/materials/MaterialPhotoImage";
import { useToast } from "@/hooks/use-toast";
import { addMaintenanceSupply, getMaintenanceOrder, transitionMaintenanceOrder, updateMaintenanceOrder } from "@/lib/equipment-maintenance-service";
import { getMaintenanceActions, MAINTENANCE_PRIORITY_LABELS, MAINTENANCE_STATUS_LABELS, MAINTENANCE_TYPE_LABELS } from "@/lib/equipment-maintenance-domain";
import type { CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import type { MaintenanceDetail, MaintenancePriority, MaintenanceStatus } from "@/lib/equipment-maintenance-types";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function MaintenanceDetailDialog({ open, onOpenChange, companyId, orderId, responsibles, canWrite, onChanged }: {
  open: boolean; onOpenChange: (open: boolean) => void; companyId: string; orderId: string | null;
  responsibles: CustodyResponsibleOption[]; canWrite: boolean; onChanged: () => Promise<unknown>;
}) {
  const { toast } = useToast();
  const query = useQuery({ queryKey: ["equipment-maintenance-detail", companyId, orderId], queryFn: () => getMaintenanceOrder(companyId, orderId!), enabled: open && Boolean(orderId) });
  const order = query.data;
  const actions = useMemo(() => order ? getMaintenanceActions(order) : null, [order]);
  const [diagnosis, setDiagnosis] = useState(""); const [service, setService] = useState("");
  const [exitCondition, setExitCondition] = useState(""); const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<MaintenancePriority>("normal"); const [responsible, setResponsible] = useState("");
  const [expected, setExpected] = useState(""); const [execution, setExecution] = useState("interna");
  const [supplier, setSupplier] = useState(""); const [interval, setInterval] = useState("");
  const [labor, setLabor] = useState(0); const [other, setOther] = useState(0); const [justification, setJustification] = useState("");
  const [supplyDescription, setSupplyDescription] = useState(""); const [supplyQuantity, setSupplyQuantity] = useState(1); const [supplyUnitCost, setSupplyUnitCost] = useState(0);
  useEffect(() => { if (!order) return; setDiagnosis(order.diagnostico ?? ""); setService(order.servico_executado ?? "");
    setExitCondition(order.condicao_saida ?? ""); setNotes(order.observacoes ?? ""); setPriority(order.prioridade);
    const responsibleId = order.responsavel_usuario_id ?? order.responsavel_funcionario_id;
    setResponsible(order.responsavel_tipo && responsibleId ? `${order.responsavel_tipo}:${responsibleId}` : "");
    setExpected(order.previsao_conclusao_em ? order.previsao_conclusao_em.slice(0, 16) : ""); setExecution(order.modalidade_execucao);
    setSupplier(order.fornecedor_externo ?? ""); setInterval(order.intervalo_preventivo_dias?.toString() ?? ""); setLabor(Number(order.custo_mao_obra)); setOther(Number(order.custo_outros));
  }, [order]);
  const refresh = async () => { await Promise.all([query.refetch(), onChanged()]); };
  const mutation = useMutation({ mutationFn: async (work: () => Promise<unknown>) => work(), onSuccess: async () => { await refresh(); toast({ title: "Ordem atualizada" }); }, onError: (error: Error) => toast({ title: "Falha na manutenção", description: error.message, variant: "destructive" }) });
  const selectedResponsible = responsibles.find((item) => `${item.tipo}:${item.id}` === responsible);
  const buildUpdateInput = () => ({ priority, diagnosis, service,
    responsible: selectedResponsible, expectedCompletion: expected, exitCondition, notes, execution, externalSupplier: supplier,
    preventiveIntervalDays: interval ? Number(interval) : undefined, laborCost: labor, partsCost: Number(order?.custo_pecas ?? 0), otherCost: other, clientUuid: crypto.randomUUID() });
  const save = () => { if (!order) return; mutation.mutate(() => updateMaintenanceOrder(companyId, order, buildUpdateInput())); };
  const transition = (status: MaintenanceStatus) => { if (!order) return; mutation.mutate(() => transitionMaintenanceOrder(companyId, order, status, status === "cancelada" ? justification : "")); };
  // Conclusion requires diagnóstico/serviço/condição de saída already saved on
  // the order (transicionar_ordem_manutencao/MT016 reads the persisted row,
  // not this form's local state), so "Concluir" must save first and only then
  // transition - a plain transition() here would fail against stale data.
  const missingForConclusion = useMemo(() => {
    if (!order || !["em_manutencao", "aguardando_peca"].includes(order.status)) return [];
    const missing: string[] = [];
    if (!diagnosis.trim()) missing.push("diagnóstico");
    if (!service.trim()) missing.push("serviço executado");
    if (!exitCondition.trim()) missing.push("condição de saída");
    return missing;
  }, [order, diagnosis, service, exitCondition]);
  const canConcludeNow = Boolean(order) && ["em_manutencao", "aguardando_peca"].includes(order?.status ?? "") && missingForConclusion.length === 0;
  const saveAndConclude = () => { if (!order) return; mutation.mutate(async () => {
    const updated = await updateMaintenanceOrder(companyId, order, buildUpdateInput());
    return transitionMaintenanceOrder(companyId, updated, "concluida", "");
  }); };
  const addSupply = () => { if (!order) return; mutation.mutate(() => addMaintenanceSupply(companyId, order.id, { description: supplyDescription, quantity: supplyQuantity, unit: "un", unitCost: supplyUnitCost, clientUuid: crypto.randomUUID() }).then(() => { setSupplyDescription(""); setSupplyQuantity(1); setSupplyUnitCost(0); })); };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto"><DialogHeader>
    <DialogTitle>{order ? `${order.numero} · ${order.material.nome}` : "Detalhe da manutenção"}</DialogTitle><DialogDescription>Histórico, diagnóstico, serviço, custos e indisponibilidade operacional.</DialogDescription></DialogHeader>
    {query.isLoading && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>}
    {order && <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Status</p><Badge>{MAINTENANCE_STATUS_LABELS[order.status]}</Badge></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Prioridade</p><strong>{MAINTENANCE_PRIORITY_LABELS[order.prioridade]}</strong></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Tipo</p><strong>{MAINTENANCE_TYPE_LABELS[order.tipo]}</strong></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Responsável</p><strong>{order.responsavel_nome ?? "A definir"}</strong></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Custo total</p><strong>{money.format(Number(order.custo_total))}</strong></CardContent></Card></div>
      <div className="flex gap-3 rounded-md border p-3"><MaterialPhotoImage path={order.material.foto_path} alt={order.material.nome} className="h-20 w-20 rounded-md" /><div><strong>{order.material.nome}</strong><p className="text-sm text-muted-foreground">{order.material.codigo_interno} · {order.material.numero_serie || order.material.numero_patrimonio || order.material.identificador_unico}</p><p className="mt-2 text-sm"><strong>Defeito/motivo:</strong> {order.defeito_relatado}</p></div></div>
      {/* "concluida" is deliberately excluded here: concluding requires diagnóstico/
          serviço/condição de saída to be saved first (MT016), so it lives as a guided,
          always-visible action next to those fields in the "Ordem" tab below instead of
          appearing/disappearing from this bar depending on unsaved form state. */}
      {canWrite && actions && <div className="flex flex-wrap gap-2">{actions.nextStatuses.filter((status) => status !== "cancelada" && status !== "concluida").map((status) => <Button key={status} variant="outline" disabled={mutation.isPending} onClick={() => transition(status)}>{MAINTENANCE_STATUS_LABELS[status]}</Button>)}</div>}
      <Tabs defaultValue="ordem"><TabsList><TabsTrigger value="ordem">Ordem</TabsTrigger><TabsTrigger value="insumos">Peças e insumos</TabsTrigger><TabsTrigger value="historico">Histórico</TabsTrigger></TabsList>
        <TabsContent value="ordem" className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">
          <div><Label>Prioridade</Label><Select disabled={!canWrite || !actions?.canEdit} value={priority} onValueChange={(value) => setPriority(value as MaintenancePriority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(MAINTENANCE_PRIORITY_LABELS).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Responsável/técnico</Label><Select disabled={!canWrite || !actions?.canEdit} value={responsible || "sem_responsavel"} onValueChange={(value) => setResponsible(value === "sem_responsavel" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sem_responsavel">A definir</SelectItem>{responsibles.map((item) => <SelectItem key={`${item.tipo}:${item.id}`} value={`${item.tipo}:${item.id}`}>{item.nome}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Previsão</Label><Input disabled={!canWrite || !actions?.canEdit} type="datetime-local" value={expected} onChange={(event) => setExpected(event.target.value)} /></div><div><Label>Execução</Label><Select disabled={!canWrite || !actions?.canEdit} value={execution} onValueChange={setExecution}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="interna">Interna</SelectItem><SelectItem value="externa">Externa</SelectItem></SelectContent></Select></div>
          {execution === "externa" && <div><Label>Fornecedor externo</Label><Input disabled={!canWrite || !actions?.canEdit} value={supplier} onChange={(event) => setSupplier(event.target.value)} /></div>}
          <div><Label>Intervalo preventivo (dias)</Label><Input disabled={!canWrite || !actions?.canEdit} type="number" value={interval} onChange={(event) => setInterval(event.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Diagnóstico</Label><Textarea disabled={!canWrite || !actions?.canEdit} value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} /></div><div className="sm:col-span-2"><Label>Serviço executado</Label><Textarea disabled={!canWrite || !actions?.canEdit} value={service} onChange={(event) => setService(event.target.value)} /></div>
          <div><Label>Condição de saída</Label><Input disabled={!canWrite || !actions?.canEdit} value={exitCondition} onChange={(event) => setExitCondition(event.target.value)} /></div><div><Label>Observações</Label><Input disabled={!canWrite || !actions?.canEdit} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          <div><Label>Custo de mão de obra</Label><Input disabled={!canWrite || !actions?.canEdit} type="number" min={0} step="0.01" value={labor} onChange={(event) => setLabor(Number(event.target.value))} /></div><div><Label>Outros custos</Label><Input disabled={!canWrite || !actions?.canEdit} type="number" min={0} step="0.01" value={other} onChange={(event) => setOther(Number(event.target.value))} /></div>
        </div>
        {canWrite && actions?.canEdit && <div className="flex flex-wrap items-center gap-3">
          <Button disabled={mutation.isPending} onClick={save}>Salvar dados</Button>
          {["em_manutencao", "aguardando_peca"].includes(order.status) && <Button disabled={mutation.isPending || !canConcludeNow} onClick={saveAndConclude} className="bg-emerald-600 text-white hover:bg-emerald-700"><CheckCircle2 className="mr-2 h-4 w-4" />Concluir manutenção</Button>}
          {missingForConclusion.length > 0 && <p className="text-xs text-muted-foreground">Para concluir: preencha {missingForConclusion.join(", ")}.</p>}
        </div>}
        {canWrite && actions?.nextStatuses.includes("cancelada") && <Card className="border-destructive/40"><CardHeader><CardTitle className="text-base">Cancelar ordem</CardTitle></CardHeader><CardContent className="flex gap-2"><Input value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Justificativa obrigatória" /><Button variant="destructive" disabled={!justification.trim() || mutation.isPending} onClick={() => transition("cancelada")}>Cancelar e liberar</Button></CardContent></Card>}
        </TabsContent>
        <TabsContent value="insumos" className="space-y-3"><div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/40"><th className="p-3 text-left">Descrição</th><th>Quantidade</th><th>Custo unitário</th><th>Total</th></tr></thead><tbody>{order.insumos.map((item) => <tr key={item.id} className="border-b"><td className="p-3">{item.descricao}</td><td>{item.quantidade} {item.unidade}</td><td>{money.format(Number(item.custo_unitario))}</td><td>{money.format(Number(item.custo_total))}</td></tr>)}{!order.insumos.length && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Nenhum insumo registrado.</td></tr>}</tbody></table></div>
          {canWrite && actions?.canEdit && <div className="grid gap-2 sm:grid-cols-4"><Input className="sm:col-span-2" value={supplyDescription} onChange={(event) => setSupplyDescription(event.target.value)} placeholder="Peça ou insumo" /><Input type="number" min={0.001} step="0.001" value={supplyQuantity} onChange={(event) => setSupplyQuantity(Number(event.target.value))} /><Input type="number" min={0} step="0.01" value={supplyUnitCost} onChange={(event) => setSupplyUnitCost(Number(event.target.value))} /><Button className="sm:col-span-4" disabled={!supplyDescription.trim() || mutation.isPending} onClick={addSupply}><Plus className="mr-2 h-4 w-4" />Adicionar sem movimentar estoque</Button></div>}
        </TabsContent>
        <TabsContent value="historico"><div className="space-y-2">{order.historico.map((event) => <div key={event.id} className="rounded-md border p-3"><div className="flex justify-between gap-3"><strong>{event.descricao}</strong><span className="text-xs text-muted-foreground">{new Date(event.data_efetiva).toLocaleString("pt-BR")}</span></div><p className="text-xs text-muted-foreground">{event.executor_nome}{event.status_anterior && event.status_novo ? ` · ${MAINTENANCE_STATUS_LABELS[event.status_anterior]} → ${MAINTENANCE_STATUS_LABELS[event.status_novo]}` : ""}</p></div>)}</div></TabsContent>
      </Tabs>
    </div>}
  </DialogContent></Dialog>;
}
