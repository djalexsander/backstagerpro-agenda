import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, Loader2, PackageOpen, Plus, Search, Wrench } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CompanyContextSelector } from "@/components/company/CompanyContextSelector";
import { MaintenanceDetailDialog } from "@/components/equipment-maintenance/MaintenanceDetailDialog";
import { NewMaintenanceDialog } from "@/components/equipment-maintenance/NewMaintenanceDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useEquipmentMaintenance } from "@/hooks/useEquipmentMaintenance";
import { MODULE_KEYS } from "@/constants/module-keys";
import { hasCompanyOperationalAccess } from "@/lib/access-control";
import { listCustodyResponsibles } from "@/lib/checkin-checkout-service";
import { MAINTENANCE_PRIORITY_LABELS, MAINTENANCE_STATUS_LABELS, MAINTENANCE_TYPE_LABELS } from "@/lib/equipment-maintenance-domain";
import { getMaintenancePermissions } from "@/lib/equipment-maintenance-permissions";
import type { MaintenanceFilters, MaintenancePriority, MaintenanceStatus, MaintenanceType } from "@/lib/equipment-maintenance-types";
import { listStockCompaniesForMaster } from "@/lib/stock-service";

const PAGE_SIZE = 15;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const initialFilters: MaintenanceFilters = { search: "", status: "todos", type: "todos", priority: "todos", responsible: "", materialId: "", dateFrom: "", dateTo: "" };

export default function Manutencoes() {
  const { role, empresaId, empresaReadOnly, isMasterAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const masterCompanyId = isMasterAdmin ? searchParams.get("empresa") ?? "" : "";
  const companiesQuery = useQuery({ queryKey: ["stock-master-companies"], queryFn: listStockCompaniesForMaster, enabled: isMasterAdmin });
  const selectedCompany = (companiesQuery.data ?? []).find((company) => company.id === masterCompanyId);
  const companyId = isMasterAdmin ? selectedCompany?.id ?? null : empresaId;
  const selectedPlan = selectedCompany?.planos as { periodicidade: string | null; ativo: boolean } | null | undefined;
  const readOnly = isMasterAdmin ? selectedCompany ? !hasCompanyOperationalAccess({ ...selectedCompany, plan_periodicity: selectedPlan?.periodicidade ?? null, plan_active: selectedPlan?.ativo ?? null }) : true : empresaReadOnly;
  const { hasModule, isLoading: loadingModules } = useCompanyModules(companyId);
  const moduleEnabled = hasModule(MODULE_KEYS.MANUTENCAO_EQUIPAMENTOS) && hasModule(MODULE_KEYS.GESTAO_MATERIAIS);
  const permissions = getMaintenancePermissions({ role, moduleEnabled, companyReadOnly: readOnly, companySelected: Boolean(companyId) });
  const [page, setPage] = useState(1); const [filters, setFilters] = useState<MaintenanceFilters>(() => ({ ...initialFilters, materialId: searchParams.get("material") ?? "" }));
  const [newOpen, setNewOpen] = useState(searchParams.get("nova") === "1"); const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => setPage(1), [filters]);
  const state = useEquipmentMaintenance({ companyId, page, pageSize: PAGE_SIZE, filters, enabled: permissions.visualizar });
  const responsiblesQuery = useQuery({ queryKey: ["maintenance-responsibles", companyId], queryFn: () => listCustodyResponsibles(companyId!), enabled: Boolean(companyId && permissions.visualizar) });
  const pages = Math.max(1, Math.ceil(state.orders.total / PAGE_SIZE));
  const selector = isMasterAdmin ? <Card><CardContent className="max-w-xl p-4"><CompanyContextSelector companies={companiesQuery.data ?? []} value={masterCompanyId} onValueChange={(id) => { const next = new URLSearchParams(searchParams); next.set("empresa", id); next.delete("nova"); next.delete("custodia"); setSearchParams(next, { replace: true }); }} disabled={companiesQuery.isLoading} /></CardContent></Card> : null;
  if (!companyId && !companiesQuery.isLoading) return <div className="space-y-4"><h1 className="text-2xl font-bold">Manutenção de Equipamentos</h1><p className="text-muted-foreground">Selecione explicitamente a empresa no contexto Master.</p>{selector}</div>;
  if (!loadingModules && !permissions.visualizar) return <div className="space-y-4"><h1 className="text-2xl font-bold">Manutenção de Equipamentos</h1>{selector}<Card className="border-amber-500/50"><CardContent className="p-4">O módulo requer Manutenção de Equipamentos e Gestão de Materiais ativos.</CardContent></Card></div>;
  const indicators = [
    ["Ordens abertas", state.indicators.abertas, ClipboardList], ["Em manutenção", state.indicators.em_manutencao, Wrench],
    ["Aguardando peça", state.indicators.aguardando_peca, PackageOpen], ["Preventivas próximas", state.indicators.preventivas_proximas, ClipboardList],
    ["Atrasadas", state.indicators.atrasadas, AlertTriangle],
  ] as const;
  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-bold">Manutenção de Equipamentos</h1><p className="text-muted-foreground">Preventivas, corretivas, inspeções e indisponibilidade operacional.</p></div>{permissions.criar && <Button onClick={() => setNewOpen(true)}><Plus className="mr-2 h-4 w-4" />Nova ordem</Button>}</div>
    {selector}{readOnly && <Card className="border-amber-500/50"><CardContent className="p-3 text-sm">Empresa em modo somente leitura. Consultas permanecem disponíveis.</CardContent></Card>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{indicators.map(([label,value,Icon]) => <Card key={label}><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div><Icon className="h-6 w-6 text-muted-foreground" /></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle>Ordens de manutenção</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Número, material, QR ou serial" /></div>
        <Select value={filters.status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value as MaintenanceStatus | "todos" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os status</SelectItem>{Object.entries(MAINTENANCE_STATUS_LABELS).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={filters.type} onValueChange={(value) => setFilters((current) => ({ ...current, type: value as MaintenanceType | "todos" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os tipos</SelectItem>{Object.entries(MAINTENANCE_TYPE_LABELS).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={filters.priority} onValueChange={(value) => setFilters((current) => ({ ...current, priority: value as MaintenancePriority | "todos" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas as prioridades</SelectItem>{Object.entries(MAINTENANCE_PRIORITY_LABELS).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Input value={filters.responsible} onChange={(event) => setFilters((current) => ({ ...current, responsible: event.target.value }))} placeholder="Responsável" /><Input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /><Input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /><Button variant="ghost" onClick={() => setFilters(initialFilters)}>Limpar filtros</Button>
      </div>
      {state.isLoading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Número</TableHead><TableHead>Material</TableHead><TableHead>Prioridade</TableHead><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead>Responsável</TableHead><TableHead>Abertura</TableHead><TableHead>Previsão</TableHead><TableHead>Custo</TableHead></TableRow></TableHeader><TableBody>{state.orders.items.map((order) => <TableRow key={order.id} className="cursor-pointer" onClick={() => setDetailId(order.id)}><TableCell className="font-mono font-medium">{order.numero}</TableCell><TableCell><strong>{order.material_nome}</strong><p className="text-xs text-muted-foreground">{order.material_codigo}</p></TableCell><TableCell>{MAINTENANCE_PRIORITY_LABELS[order.prioridade]}</TableCell><TableCell>{MAINTENANCE_TYPE_LABELS[order.tipo]}</TableCell><TableCell><Badge variant={order.atrasada ? "destructive" : "secondary"}>{order.atrasada ? "Atrasada · " : ""}{MAINTENANCE_STATUS_LABELS[order.status]}</Badge></TableCell><TableCell>{order.responsavel_nome ?? "A definir"}</TableCell><TableCell>{new Date(order.aberta_em).toLocaleDateString("pt-BR")}</TableCell><TableCell>{order.previsao_conclusao_em ? new Date(order.previsao_conclusao_em).toLocaleDateString("pt-BR") : "—"}</TableCell><TableCell>{money.format(Number(order.custo_total))}</TableCell></TableRow>)}{!state.orders.items.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">Nenhuma ordem encontrada.</TableCell></TableRow>}</TableBody></Table></div>}
      <div className="flex items-center justify-end gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button><span className="text-sm">{page} de {pages}</span><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Próxima</Button></div>
    </CardContent></Card>
    {companyId && <><NewMaintenanceDialog open={newOpen} onOpenChange={(value) => { setNewOpen(value); if (!value) { const next = new URLSearchParams(searchParams); next.delete("nova"); next.delete("custodia"); setSearchParams(next, { replace: true }); } }} companyId={companyId} responsibles={responsiblesQuery.data ?? []} custodyId={searchParams.get("custodia")} onCreated={async (id) => { await state.invalidate(); setDetailId(id); }} /><MaintenanceDetailDialog open={Boolean(detailId)} onOpenChange={(value) => { if (!value) setDetailId(null); }} companyId={companyId} orderId={detailId} responsibles={responsiblesQuery.data ?? []} canWrite={permissions.editar} onChanged={state.invalidate} /></>}
  </div>;
}
