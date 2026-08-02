import { FormEvent, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, PackageCheck, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import { normalizeRentalSearch, getRentalActions, RENTAL_STATUS_LABELS } from "@/lib/material-rental-domain";
import type { RentalPermissions } from "@/lib/material-rental-permissions";
import {
  cancelMaterialRental,
  concludeMaterialRental,
  confirmMaterialRental,
  getMaterialRental,
  markMaterialRentalReady,
  registerRentalCheckin,
  registerRentalCheckout,
  removeMaterialRentalItem,
  saveMaterialRentalItem,
  searchRentalMaterials,
} from "@/lib/material-rental-service";
import type { RentalCustodyView, RentalItemView, RentalMaterialOption } from "@/lib/material-rental-types";
import type { StockLocation } from "@/lib/stock-types";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function RentalDetailDialog({
  open,
  onOpenChange,
  companyId,
  rentalId,
  permissions,
  locations,
  responsibles,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  rentalId: string | null;
  permissions: RentalPermissions;
  locations: StockLocation[];
  responsibles: CustodyResponsibleOption[];
  onChanged: () => Promise<void> | void;
}) {
  const detailQuery = useQuery({
    queryKey: ["material-rental-detail", companyId, rentalId],
    queryFn: () => getMaterialRental(companyId, rentalId!),
    enabled: open && Boolean(rentalId),
  });
  const rental = detailQuery.data;
  const actions = rental ? getRentalActions(rental) : null;
  const [busy, setBusy] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const [materials, setMaterials] = useState<RentalMaterialOption[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<RentalMaterialOption | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [scanner, setScanner] = useState("");
  const [checkoutItem, setCheckoutItem] = useState<RentalItemView | null>(null);
  const [checkinCustody, setCheckinCustody] = useState<RentalCustodyView | null>(null);
  const [locationId, setLocationId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [condition, setCondition] = useState("bom");
  const [occurrence, setOccurrence] = useState("");
  const [justification, setJustification] = useState("");
  const requestIds = useRef<Record<string, string>>({});
  const requestId = (key: string) => {
    requestIds.current[key] ??= crypto.randomUUID();
    return requestIds.current[key];
  };

  const activeLocations = locations.filter((location) => location.ativa);
  const defaultResponsible = useMemo(
    () => responsibles.find((item) => item.tipo === "usuario") ?? responsibles[0],
    [responsibles],
  );

  const refresh = async () => {
    await detailQuery.refetch();
    await onChanged();
  };
  const execute = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await operation();
      toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  };

  const searchMaterials = async (event: FormEvent) => {
    event.preventDefault();
    if (!rental) return;
    setBusy(true);
    try {
      setMaterials(await searchRentalMaterials({
        companyId,
        search: normalizeRentalSearch(materialSearch),
        withdrawalAt: rental.retirada_prevista_em,
        returnAt: rental.devolucao_prevista_em,
        excludeRentalId: rental.id,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na busca.");
    } finally {
      setBusy(false);
    }
  };

  const addItem = async () => {
    if (!rental || !selectedMaterial) return;
    await execute(
      () => saveMaterialRentalItem(companyId, {
        rentalId: rental.id,
        materialId: selectedMaterial.id,
        quantity,
        billingMode: "unidade",
        billingUnits: 1,
        unitPrice,
        discount,
        clientUuid: requestId(`item:${selectedMaterial.id}`),
      }),
      "Material adicionado à locação.",
    );
    setSelectedMaterial(null);
    setMaterials([]);
    setMaterialSearch("");
  };

  const identifyCheckoutItem = () => {
    if (!rental) return;
    const value = normalizeRentalSearch(scanner).toLocaleLowerCase("pt-BR");
    const found = rental.itens.find((item) => [
      item.material.id,
      item.material.identificador_unico,
      item.material.codigo_barras,
      item.material.codigo_interno,
      item.material.numero_patrimonio,
      item.material.numero_serie,
      item.material.nome,
    ].some((candidate) => candidate?.toLocaleLowerCase("pt-BR").includes(value)));
    if (!found || found.quantidade_pendente_retirada <= 0) {
      toast.error("Material não pertence à locação ou já foi integralmente retirado.");
      return;
    }
    setCheckoutItem(found);
    setQuantity(Math.min(1, found.quantidade_pendente_retirada));
    setResponsible(defaultResponsible ? `${defaultResponsible.tipo}:${defaultResponsible.id}` : "");
  };

  const checkout = async () => {
    if (!rental || !checkoutItem || !locationId || !responsible) return;
    const [responsibleType, responsibleId] = responsible.split(":");
    await execute(
      () => registerRentalCheckout(companyId, {
        rentalId: rental.id,
        itemId: checkoutItem.id,
        quantity,
        locationId,
        responsibleType: responsibleType as "usuario" | "funcionario",
        responsibleId,
        condition,
        clientUuid: requestId(`checkout:${checkoutItem.id}`),
      }),
      "Retirada registrada na custódia e no estoque oficial.",
    );
    setCheckoutItem(null);
    setScanner("");
  };

  const checkin = async () => {
    if (!rental || !checkinCustody || !locationId) return;
    await execute(
      () => registerRentalCheckin(companyId, {
        rentalId: rental.id,
        custodyId: checkinCustody.id,
        quantity,
        locationId,
        returnCondition: condition,
        occurrence,
        clientUuid: requestId(`checkin:${checkinCustody.id}:${checkinCustody.quantidade_devolvida}`),
      }),
      "Devolução registrada na custódia e no estoque oficial.",
    );
    setCheckinCustody(null);
    setOccurrence("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rental ? `${rental.numero} · ${rental.cliente.nome_fantasia || rental.cliente.nome}` : "Detalhe da locação"}</DialogTitle>
          <DialogDescription>Comercial, reserva e operação física em uma visão, sem duplicar estoque ou custódia.</DialogDescription>
        </DialogHeader>
        {detailQuery.isLoading && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {detailQuery.error && <p className="text-destructive">{detailQuery.error instanceof Error ? detailQuery.error.message : "Falha ao carregar."}</p>}
        {rental && actions && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Status</p><Badge variant={rental.atrasada ? "destructive" : "secondary"}>{rental.atrasada ? "Atrasada · " : ""}{RENTAL_STATUS_LABELS[rental.status]}</Badge></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Período</p><p className="text-sm font-medium">{new Date(rental.retirada_prevista_em).toLocaleString("pt-BR")}<br />até {new Date(rental.devolucao_prevista_em).toLocaleString("pt-BR")}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Responsável</p><p className="font-medium">{rental.responsavel_nome}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-lg font-bold">{money.format(rental.valor_total)}</p></CardContent></Card>
            </div>

            <div className="flex flex-wrap gap-2">
              {permissions.reservar && actions.canConfirm && <Button disabled={busy} onClick={() => execute(() => confirmMaterialRental(companyId, rental.id, requestId("confirm")), "Reserva confirmada.")}>Confirmar reserva</Button>}
              {permissions.reservar && actions.canMarkReady && <Button disabled={busy} variant="outline" onClick={() => execute(() => markMaterialRentalReady(companyId, rental.id, requestId("ready")), "Locação pronta para retirada.")}>Marcar pronta</Button>}
              {permissions.editar && actions.canConclude && <Button disabled={busy} variant="outline" onClick={() => execute(() => concludeMaterialRental(companyId, rental.id, requestId("conclude")), "Locação concluída.")}>Concluir</Button>}
            </div>

            <Tabs defaultValue="itens">
              <TabsList><TabsTrigger value="itens">Itens e reservas</TabsTrigger><TabsTrigger value="operacao">Retirada / devolução</TabsTrigger><TabsTrigger value="historico">Histórico</TabsTrigger></TabsList>
              <TabsContent value="itens" className="space-y-4">
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm"><thead><tr className="border-b bg-muted/40 text-left"><th className="p-3">Material</th><th>Contratado</th><th>Retirado</th><th>Devolvido</th><th>Com cliente</th><th>Subtotal</th><th /></tr></thead><tbody>
                    {rental.itens.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="p-3"><strong>{item.material.nome}</strong><br /><span className="text-xs text-muted-foreground">{item.material.codigo_interno}</span></td><td>{item.quantidade_contratada}</td><td>{item.quantidade_retirada}</td><td>{item.quantidade_devolvida}</td><td>{item.quantidade_com_cliente}</td><td>{money.format(item.subtotal)}</td><td>{actions.canEdit && permissions.editar && <Button size="icon" variant="ghost" aria-label="Remover item" onClick={() => execute(() => removeMaterialRentalItem(companyId, rental.id, item.id), "Item removido.")}><Trash2 className="h-4 w-4" /></Button>}</td></tr>)}
                    {!rental.itens.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Adicione ao menos um material antes de confirmar a reserva.</td></tr>}
                  </tbody></table>
                </div>
                {actions.canEdit && permissions.editar && <Card><CardHeader><CardTitle className="text-base">Adicionar material</CardTitle></CardHeader><CardContent className="space-y-3">
                  <form className="flex gap-2" onSubmit={searchMaterials}><Input value={materialSearch} onChange={(event) => setMaterialSearch(event.target.value)} placeholder="Nome, código, QR, serial ou patrimônio" /><Button type="submit" variant="outline" disabled={busy}><ScanLine className="mr-2 h-4 w-4" />Buscar</Button></form>
                  {!!materials.length && <div className="grid gap-2 md:grid-cols-2">{materials.map((material) => <button type="button" key={material.id} onClick={() => { setSelectedMaterial(material); setQuantity(1); setUnitPrice(Number(material.valor_locacao_padrao ?? 0)); }} className={`rounded-md border p-3 text-left ${selectedMaterial?.id === material.id ? "border-primary bg-primary/5" : ""}`}><strong>{material.nome}</strong><p className="text-xs text-muted-foreground">{material.codigo_interno} · físico {material.estoque_fisico} · reservado {material.reservado} · disponível {material.disponivel}</p></button>)}</div>}
                  {selectedMaterial && <div className="grid gap-3 sm:grid-cols-4"><div><Label>Quantidade</Label><Input type="number" min={1} max={selectedMaterial.tipo_controle === "individual" ? 1 : selectedMaterial.disponivel} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div><div><Label>Valor unitário</Label><Input type="number" min={0} step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value))} /></div><div><Label>Desconto</Label><Input type="number" min={0} step="0.01" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></div><div className="flex items-end"><Button className="w-full" disabled={busy || quantity > selectedMaterial.disponivel} onClick={addItem}>Adicionar</Button></div></div>}
                </CardContent></Card>}
              </TabsContent>

              <TabsContent value="operacao" className="space-y-4">
                {permissions.retirar && actions.canCheckout && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4" />Realizar retirada</CardTitle></CardHeader><CardContent className="space-y-3">
                  <div className="flex gap-2"><Input value={scanner} onChange={(event) => setScanner(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); identifyCheckoutItem(); } }} placeholder="Escaneie QR/código ou busque o material contratado" /><Button variant="outline" onClick={identifyCheckoutItem}><ScanLine className="mr-2 h-4 w-4" />Identificar</Button></div>
                  {checkoutItem && <div className="grid gap-3 sm:grid-cols-4"><div><Label>Material</Label><p className="pt-2 text-sm font-medium">{checkoutItem.material.nome}</p></div><div><Label>Quantidade</Label><Input type="number" min={1} max={checkoutItem.quantidade_pendente_retirada} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div><div><Label>Origem</Label><Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue placeholder="Local" /></SelectTrigger><SelectContent>{activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.nome}</SelectItem>)}</SelectContent></Select></div><div><Label>Responsável</Label><Select value={responsible} onValueChange={setResponsible}><SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger><SelectContent>{responsibles.map((item) => <SelectItem key={`${item.tipo}:${item.id}`} value={`${item.tipo}:${item.id}`}>{item.nome}</SelectItem>)}</SelectContent></Select></div><div><Label>Condição</Label><Input value={condition} onChange={(event) => setCondition(event.target.value)} /></div><div className="flex items-end"><Button disabled={busy || !locationId || !responsible} onClick={checkout}>Confirmar retirada</Button></div></div>}
                </CardContent></Card>}
                {permissions.devolver && actions.canCheckin && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><RotateCcw className="h-4 w-4" />Receber materiais</CardTitle></CardHeader><CardContent className="space-y-3">
                  <div className="grid gap-2">{rental.custodias.filter((custody) => ["aberta", "parcial"].includes(custody.status)).map((custody) => { const item = rental.itens.find((entry) => entry.id === custody.referencia_id); return <Button key={custody.id} variant={checkinCustody?.id === custody.id ? "default" : "outline"} className="justify-between" onClick={() => { setCheckinCustody(custody); setQuantity(custody.quantidade_pendente); }}><span>{item?.material.nome ?? custody.material_id}</span><span>Pendente: {custody.quantidade_pendente}</span></Button>; })}</div>
                  {checkinCustody && <div className="grid gap-3 sm:grid-cols-4"><div><Label>Quantidade</Label><Input type="number" min={1} max={checkinCustody.quantidade_pendente} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div><div><Label>Destino</Label><Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue placeholder="Local" /></SelectTrigger><SelectContent>{activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.nome}</SelectItem>)}</SelectContent></Select></div><div><Label>Condição de retorno</Label><Input value={condition} onChange={(event) => setCondition(event.target.value)} /></div><div><Label>Ocorrência/avaria</Label><Input value={occurrence} onChange={(event) => setOccurrence(event.target.value)} /></div><div className="flex items-end"><Button disabled={busy || !locationId} onClick={checkin}>Confirmar devolução</Button></div></div>}
                </CardContent></Card>}
                {!actions.canCheckout && !actions.canCheckin && <p className="rounded-md border p-4 text-sm text-muted-foreground">Nenhuma ação física disponível para o estado atual.</p>}
              </TabsContent>

              <TabsContent value="historico"><div className="space-y-2">{rental.historico.map((event) => <div key={event.id} className="rounded-md border p-3"><div className="flex justify-between gap-3"><strong>{event.descricao}</strong><span className="text-xs text-muted-foreground">{new Date(event.data_efetiva).toLocaleString("pt-BR")}</span></div><p className="text-xs text-muted-foreground">{event.executor_nome}</p></div>)}</div></TabsContent>
            </Tabs>

            {permissions.cancelar && actions.canCancel && <Card className="border-destructive/30"><CardContent className="space-y-2 p-4"><Label className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Cancelar e liberar reservas</Label><Textarea value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Justificativa obrigatória" /><Button variant="destructive" disabled={busy || !justification.trim()} onClick={() => execute(() => cancelMaterialRental(companyId, rental.id, justification, requestId("cancel")), "Locação cancelada; reservas liberadas.")}>Cancelar locação</Button></CardContent></Card>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
