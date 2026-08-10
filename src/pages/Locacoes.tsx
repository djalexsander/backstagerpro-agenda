import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, CalendarClock, Loader2, PackageOpen, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewRentalDialog } from "@/components/material-rentals/NewRentalDialog";
import { RentalDetailDialog } from "@/components/material-rentals/RentalDetailDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useMaterialRentals } from "@/hooks/useMaterialRentals";
import { MODULE_KEYS } from "@/constants/module-keys";
import { listCustodyResponsibles } from "@/lib/checkin-checkout-service";
import { RENTAL_STATUS_LABELS } from "@/lib/material-rental-domain";
import { getRentalPermissions } from "@/lib/material-rental-permissions";
import type { RentalFilters, RentalStatus } from "@/lib/material-rental-types";
import { listStockLocations } from "@/lib/stock-service";

const PAGE_SIZE = 12;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const initialFilters: RentalFilters = { search: "", status: "todos", customerId: "", dateFrom: "", dateTo: "", overdueOnly: false, responsible: "" };

export default function Locacoes() {
  const { role, empresaId: companyId, empresaReadOnly: readOnly, isMasterAdmin } = useAuth();
  const { hasModule, isLoading: loadingModules } = useCompanyModules(companyId);
  const moduleEnabled = hasModule(MODULE_KEYS.LOCACAO_MATERIAIS) && hasModule(MODULE_KEYS.GESTAO_MATERIAIS) && hasModule(MODULE_KEYS.CONTROLE_ESTOQUE) && hasModule(MODULE_KEYS.CHECKIN_CHECKOUT);
  const permissions = getRentalPermissions({ role, moduleEnabled, companyReadOnly: readOnly, companySelected: Boolean(companyId) });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(initialFilters);
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => setPage(1), [filters]);

  const rentalsState = useMaterialRentals({ companyId, page, pageSize: PAGE_SIZE, filters, enabled: permissions.visualizar });
  const locationsQuery = useQuery({ queryKey: ["stock-locations", companyId], queryFn: () => listStockLocations(companyId!, true), enabled: Boolean(companyId && permissions.visualizar) });
  const responsiblesQuery = useQuery({ queryKey: ["rental-responsibles", companyId], queryFn: () => listCustodyResponsibles(companyId!), enabled: Boolean(companyId && permissions.visualizar) });
  const pages = Math.max(1, Math.ceil(rentalsState.rentals.total / PAGE_SIZE));

  if (!companyId) return <div className="space-y-4"><div><h1 className="text-2xl font-bold">Locação de Materiais</h1><p className="text-muted-foreground">{isMasterAdmin ? "Sua conta master não está vinculada a uma empresa operacional." : "Nenhuma empresa vinculada à sua conta."}</p></div></div>;
  if (!loadingModules && !permissions.visualizar) return <div className="space-y-4"><div><h1 className="text-2xl font-bold">Locação de Materiais</h1><p className="text-muted-foreground">O módulo ou uma de suas dependências não está disponível.</p></div><Card className="border-amber-500/50"><CardContent className="p-4 text-sm">Locações requer Gestão de Materiais, Controle de Estoque e Check-in / Check-out ativos.</CardContent></Card></div>;

  const indicators = [
    { label: "Em andamento", value: rentalsState.indicators.em_andamento, icon: PackageOpen },
    { label: "Retiradas hoje", value: rentalsState.indicators.retiradas_hoje, icon: CalendarCheck },
    { label: "Devoluções hoje", value: rentalsState.indicators.devolucoes_hoje, icon: CalendarClock },
    { label: "Atrasadas", value: rentalsState.indicators.atrasadas, icon: AlertTriangle },
  ];

  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-bold">Locação de Materiais</h1><p className="text-muted-foreground">Reserva comercial integrada ao estoque e à custódia oficiais.</p></div>{permissions.criar && <Button onClick={() => setNewOpen(true)}><Plus className="mr-2 h-4 w-4" />Nova locação</Button>}</div>
    {readOnly && <Card className="border-amber-500/50"><CardContent className="p-3 text-sm">Empresa em modo somente leitura. Consultas permanecem disponíveis; ações comerciais e físicas estão bloqueadas.</CardContent></Card>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{indicators.map((indicator) => <Card key={indicator.label}><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">{indicator.label}</p><p className="text-2xl font-bold">{indicator.value}</p></div><indicator.icon className="h-6 w-6 text-muted-foreground" /></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle>Locações</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Número, cliente ou material" /></div>
        <Select value={filters.status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value as RentalStatus | "todos" }))}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os status</SelectItem>{Object.entries(RENTAL_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={filters.customerId || "todos"} onValueChange={(value) => setFilters((current) => ({ ...current, customerId: value === "todos" ? "" : value }))}><SelectTrigger><SelectValue placeholder="Cliente" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos os clientes</SelectItem>{rentalsState.customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.nome_fantasia || customer.nome}</SelectItem>)}</SelectContent></Select>
        <Input value={filters.responsible} onChange={(event) => setFilters((current) => ({ ...current, responsible: event.target.value }))} placeholder="Responsável" />
        <Input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
        <Input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} />
        <label className="flex items-center gap-2 rounded-md border px-3"><Checkbox checked={filters.overdueOnly} onCheckedChange={(checked) => setFilters((current) => ({ ...current, overdueOnly: checked === true }))} />Somente atrasadas</label>
        <Button variant="ghost" onClick={() => setFilters(initialFilters)}>Limpar filtros</Button>
      </div>
      {rentalsState.isLoading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Número</TableHead><TableHead>Cliente</TableHead><TableHead>Período</TableHead><TableHead>Valor</TableHead><TableHead>Status</TableHead><TableHead>Itens</TableHead><TableHead>Situação operacional</TableHead></TableRow></TableHeader><TableBody>{rentalsState.rentals.items.map((rental) => <TableRow key={rental.id} className="cursor-pointer" onClick={() => setDetailId(rental.id)}><TableCell className="font-mono font-medium">{rental.numero}</TableCell><TableCell>{rental.cliente_nome_fantasia || rental.cliente_nome}</TableCell><TableCell>{new Date(rental.retirada_prevista_em).toLocaleDateString("pt-BR")} — {new Date(rental.devolucao_prevista_em).toLocaleDateString("pt-BR")}</TableCell><TableCell>{money.format(rental.valor_total)}</TableCell><TableCell><Badge variant={rental.atrasada ? "destructive" : "secondary"}>{rental.atrasada ? "Atrasada" : RENTAL_STATUS_LABELS[rental.status]}</Badge></TableCell><TableCell>{rental.quantidade_itens}</TableCell><TableCell>{rental.quantidade_retirada} retirado · {rental.quantidade_devolvida} devolvido · {rental.quantidade_com_cliente} com cliente</TableCell></TableRow>)}{!rentalsState.rentals.items.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">Nenhuma locação encontrada.</TableCell></TableRow>}</TableBody></Table></div>}
      {rentalsState.error && <p className="text-sm text-destructive">{rentalsState.error instanceof Error ? rentalsState.error.message : "Falha ao consultar locações."}</p>}
      <div className="flex items-center justify-end gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button><span className="text-sm">{page} de {pages}</span><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Próxima</Button></div>
    </CardContent></Card>
    {companyId && <><NewRentalDialog open={newOpen} onOpenChange={setNewOpen} companyId={companyId} customers={rentalsState.customers} responsibles={responsiblesQuery.data ?? []} onCustomerCreated={rentalsState.invalidateRentals} onCreated={async (id) => { await rentalsState.invalidateRentals(); setDetailId(id); }} /><RentalDetailDialog open={Boolean(detailId)} onOpenChange={(next) => { if (!next) setDetailId(null); }} companyId={companyId} rentalId={detailId} permissions={permissions} locations={locationsQuery.data ?? []} responsibles={responsiblesQuery.data ?? []} onChanged={rentalsState.invalidateRentals} /></>}
  </div>;
}
