import { FormEvent, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Loader2,
  ListRestart,
  PackageCheck,
  RotateCcw,
  ScanLine,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CompanyContextSelector } from "@/components/company/CompanyContextSelector";
import { MaterialPhotoImage } from "@/components/materials/MaterialPhotoImage";
import { CheckoutDialog } from "@/components/checkin-checkout/CheckoutDialog";
import { CheckinDialog } from "@/components/checkin-checkout/CheckinDialog";
import { CancelCheckoutDialog } from "@/components/checkin-checkout/CancelCheckoutDialog";
import { CustodyHistoryDialog } from "@/components/checkin-checkout/CustodyHistoryDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useCheckinCheckout } from "@/hooks/useCheckinCheckout";
import { MODULE_KEYS } from "@/constants/module-keys";
import { listStockCompaniesForMaster } from "@/lib/stock-service";
import { hasCompanyOperationalAccess } from "@/lib/access-control";
import { getCustodyPermissions } from "@/lib/checkin-checkout-permissions";
import {
  CUSTODY_PURPOSE_LABELS,
  CUSTODY_STATUS_LABELS,
  getCustodyMaterialActions,
  normalizeCustodyScan,
} from "@/lib/checkin-checkout-domain";
import {
  listCustodyOperations,
  searchCustodyMaterials,
} from "@/lib/checkin-checkout-service";
import type {
  CustodyFilters,
  CustodyMaterialSearchResult,
  CustodyOperationView,
  CustodyPurpose,
  CustodyStatus,
} from "@/lib/checkin-checkout-types";

const PAGE_SIZE = 10;
const INITIAL_FILTERS: CustodyFilters = {
  search: "",
  status: "todos",
  purpose: "todos",
  responsible: "",
  executorId: "",
  locationId: "",
  dateFrom: "",
  dateTo: "",
};

function Pagination({ page, total, onPageChange }: { page: number; total: number; onPageChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-3 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</Button>
      <span>{page} de {pages}</span>
      <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Próxima</Button>
    </div>
  );
}

function dueBadge(operation: CustodyOperationView) {
  if (!operation.previsao_retorno) return <span>—</span>;
  const due = new Date(operation.previsao_retorno);
  const overdue = due.getTime() < Date.now() && ["aberta", "parcial"].includes(operation.status);
  return <Badge variant={overdue ? "destructive" : "outline"}>{due.toLocaleString("pt-BR")}</Badge>;
}

export default function CheckinCheckout() {
  const {
    role,
    empresaId: authenticatedCompanyId,
    empresaReadOnly,
    isMasterAdmin,
  } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const masterCompanyId = isMasterAdmin ? searchParams.get("empresa") ?? "" : "";
  const { data: masterCompanies = [], isLoading: loadingMasterCompanies } = useQuery({
    queryKey: ["stock-master-companies"],
    queryFn: listStockCompaniesForMaster,
    enabled: isMasterAdmin,
  });
  const selectedMasterCompany = masterCompanies.find((company) => company.id === masterCompanyId);
  const companyId = isMasterAdmin ? selectedMasterCompany?.id ?? null : authenticatedCompanyId;
  const selectedPlan = selectedMasterCompany?.planos as
    | { periodicidade: string | null; ativo: boolean }
    | null
    | undefined;
  const effectiveReadOnly = isMasterAdmin
    ? selectedMasterCompany
      ? !hasCompanyOperationalAccess({
          ...selectedMasterCompany,
          plan_periodicity: selectedPlan?.periodicidade ?? null,
          plan_active: selectedPlan?.ativo ?? null,
        })
      : true
    : empresaReadOnly;
  const { hasModule, isLoading: loadingModules } = useCompanyModules(companyId);
  const moduleEnabled =
    hasModule(MODULE_KEYS.CHECKIN_CHECKOUT) &&
    hasModule(MODULE_KEYS.GESTAO_MATERIAIS) &&
    hasModule(MODULE_KEYS.CONTROLE_ESTOQUE);
  const permissions = getCustodyPermissions({
    role,
    moduleEnabled,
    companyReadOnly: effectiveReadOnly,
    companySelected: Boolean(companyId),
  });

  const [openPage, setOpenPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFilters, setHistoryFilters] = useState(INITIAL_FILTERS);
  const [scannerValue, setScannerValue] = useState("");
  const [searchResults, setSearchResults] = useState<CustodyMaterialSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [checkoutMaterial, setCheckoutMaterial] = useState<CustodyMaterialSearchResult | null>(null);
  const [checkinOperation, setCheckinOperation] = useState<CustodyOperationView | null>(null);
  const [cancelOperation, setCancelOperation] = useState<CustodyOperationView | null>(null);
  const [historyOperation, setHistoryOperation] = useState<CustodyOperationView | null>(null);
  const scannerRef = useRef<HTMLInputElement>(null);

  const {
    openOperations,
    history,
    indicators,
    responsibles,
    locations,
    isLoading,
    error,
    invalidateCustody,
  } = useCheckinCheckout({
    companyId,
    openPage,
    historyPage,
    pageSize: PAGE_SIZE,
    historyFilters,
    accessEnabled: permissions.visualizar,
  });

  useEffect(() => setHistoryPage(1), [historyFilters]);

  const selectMasterCompany = (nextCompanyId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("empresa", nextCompanyId);
    setSearchParams(next, { replace: true });
    setSearchResults([]);
    setScannerValue("");
    setCheckoutMaterial(null);
    setCheckinOperation(null);
    setCancelOperation(null);
    setHistoryOperation(null);
  };

  const executeSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!companyId) return;
    const normalized = normalizeCustodyScan(scannerValue);
    if (!normalized) {
      scannerRef.current?.focus();
      return;
    }
    setSearching(true);
    setSearchMessage("");
    try {
      const results = await searchCustodyMaterials(companyId, normalized);
      setSearchResults(results);
      if (!results.length) setSearchMessage("Nenhum material encontrado para essa leitura.");
    } catch (searchError) {
      setSearchMessage(searchError instanceof Error ? searchError.message : "Falha ao buscar material.");
    } finally {
      setSearching(false);
    }
  };

  const refreshAfterOperation = async () => {
    await invalidateCustody();
    if (companyId && scannerValue.trim()) {
      setSearchResults(await searchCustodyMaterials(companyId, scannerValue));
    }
  };

  const openCheckinFromSearch = async (
    material: CustodyMaterialSearchResult,
    custodyId: string,
  ) => {
    if (!companyId) return;
    setSearching(true);
    try {
      const page = await listCustodyOperations({
        companyId,
        page: 1,
        pageSize: 100,
        filters: { ...INITIAL_FILTERS, search: material.codigo_interno },
        onlyOpen: true,
      });
      const operation = page.items.find((item) => item.id === custodyId);
      if (operation) setCheckinOperation(operation);
      else setSearchMessage("A operação aberta foi atualizada. Faça uma nova leitura.");
    } finally {
      setSearching(false);
    }
  };

  const companySelector = isMasterAdmin ? (
    <Card>
      <CardContent className="max-w-xl p-4">
        <CompanyContextSelector
          companies={masterCompanies}
          value={masterCompanyId}
          onValueChange={selectMasterCompany}
          disabled={loadingMasterCompanies}
        />
      </CardContent>
    </Card>
  ) : null;

  if (!companyId && !loadingMasterCompanies) {
    return (
      <div className="space-y-4">
        <div><h1 className="text-2xl font-bold">Check-in / Check-out</h1><p className="text-muted-foreground">Selecione explicitamente a empresa para operar em contexto Master.</p></div>
        {companySelector}
      </div>
    );
  }

  if (!loadingModules && !permissions.visualizar) {
    return (
      <div className="space-y-4">
        <div><h1 className="text-2xl font-bold">Check-in / Check-out</h1><p className="text-muted-foreground">A empresa selecionada não possui acesso ao módulo e suas dependências.</p></div>
        {companySelector}
        <Card className="border-amber-500/50"><CardContent className="p-4 text-sm text-muted-foreground">Check-in / Check-out requer Gestão de Materiais e Controle de Estoque ativos. Nenhuma consulta operacional foi habilitada.</CardContent></Card>
      </div>
    );
  }

  const userResponsibles = responsibles.filter((item) => item.tipo === "usuario");
  const purposes = Object.keys(CUSTODY_PURPOSE_LABELS) as CustodyPurpose[];
  const statuses = Object.keys(CUSTODY_STATUS_LABELS) as CustodyStatus[];
  const updateFilter = <K extends keyof CustodyFilters>(key: K, value: CustodyFilters[K]) =>
    setHistoryFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Check-in / Check-out</h1>
        <p className="text-muted-foreground">Custódia física integrada ao saldo e ao ledger oficial.</p>
      </div>
      {companySelector}

      <Card className="border-primary/30">
        <CardHeader><CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5" /> Escanear ou buscar material</CardTitle></CardHeader>
        <CardContent>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={executeSearch}>
            <Input
              ref={scannerRef}
              autoFocus
              className="h-12 text-base"
              value={scannerValue}
              onChange={(event) => setScannerValue(event.target.value)}
              placeholder="UUID, QR, código de barras, código interno, patrimônio, série ou nome"
              autoComplete="off"
            />
            <Button className="h-12" disabled={searching} type="submit">
              {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
              Identificar
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Scanners USB/Bluetooth funcionam como teclado: mantenha o cursor no campo e finalize com Enter.</p>
          {searchMessage && <p className="mt-3 rounded-md border border-amber-500/40 p-3 text-sm">{searchMessage}</p>}
          {!!searchResults.length && (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {searchResults.map((material) => {
                const actions = getCustodyMaterialActions(material);
                return (
                  <Card key={material.id}>
                    <CardContent className="flex gap-3 p-4">
                      <MaterialPhotoImage path={material.foto_path} alt={material.nome} className="h-20 w-20 shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{material.nome}</p>
                        <p className="text-sm text-muted-foreground">{material.codigo_interno} · {material.numero_patrimonio || material.numero_serie || material.codigo_barras || material.identificador_unico}</p>
                        <p className="mt-1 text-sm">Disponível: <strong>{actions.available}</strong> · Em custódia: <strong>{actions.pending}</strong></p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {actions.canCheckout && permissions.checkout && <Button size="sm" onClick={() => setCheckoutMaterial(material)}>Check-out</Button>}
                          {actions.canCheckin && permissions.checkin && material.custodias_abertas.map((custody) => (
                            <Button key={custody.id} size="sm" variant="outline" onClick={() => openCheckinFromSearch(material, custody.id)}>
                              Check-in · {custody.responsavel_nome} ({custody.quantidade_pendente})
                            </Button>
                          ))}
                          {!actions.canCheckout && !actions.canCheckin && <Badge variant="secondary">Sem ação válida</Badge>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ["Itens atualmente fora", indicators.itens_fora, PackageCheck],
          ["Previstos para hoje", indicators.previstos_hoje, CalendarClock],
          ["Atrasados", indicators.atrasados, AlertTriangle],
          ["Ocorrências / avarias", indicators.ocorrencias, ShieldAlert],
        ] as [string, number, LucideIcon][]).map(([label, value, Icon]) => (
          <Card key={String(label)}><CardContent className="flex items-center justify-between p-4"><div><p className="text-sm text-muted-foreground">{String(label)}</p><p className="text-2xl font-bold">{Number(value)}</p></div><Icon className="h-6 w-6 text-muted-foreground" /></CardContent></Card>
        ))}
      </div>

      {error && <Card className="border-destructive/50"><CardContent className="p-4 text-sm text-destructive">{error instanceof Error ? error.message : "Não foi possível carregar as operações."}</CardContent></Card>}

      <Tabs defaultValue="abertas">
        <TabsList><TabsTrigger value="abertas">Operações em aberto</TabsTrigger><TabsTrigger value="historico">Histórico</TabsTrigger></TabsList>
        <TabsContent value="abertas">
          <Card>
            <CardContent className="p-4">
              {isLoading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : !openOperations.items.length ? <p className="p-8 text-center text-muted-foreground">Nenhum material está em custódia.</p> : (
                <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Qtd.</TableHead><TableHead>Responsável</TableHead><TableHead>Saída</TableHead><TableHead>Previsão</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>
                  {openOperations.items.map((operation) => <TableRow key={operation.id}><TableCell><p className="font-medium">{operation.material_nome}</p><p className="text-xs text-muted-foreground">{operation.material_codigo} · {operation.localizacao_origem_nome}</p></TableCell><TableCell>{operation.quantidade_pendente} / {operation.quantidade_retirada}</TableCell><TableCell>{operation.responsavel_nome}</TableCell><TableCell>{new Date(operation.retirada_em).toLocaleString("pt-BR")}</TableCell><TableCell>{dueBadge(operation)}</TableCell><TableCell><Badge variant="outline">{CUSTODY_STATUS_LABELS[operation.status]}</Badge></TableCell><TableCell className="text-right"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Histórico completo" onClick={() => setHistoryOperation(operation)}><ListRestart className="h-4 w-4" /></Button>{permissions.checkin && <Button size="sm" onClick={() => setCheckinOperation(operation)}><ClipboardCheck className="mr-1 h-4 w-4" /> Check-in</Button>}{permissions.cancelar && operation.status === "aberta" && operation.quantidade_devolvida === 0 && <Button size="icon" variant="ghost" title="Cancelar com estorno" onClick={() => setCancelOperation(operation)}><RotateCcw className="h-4 w-4" /></Button>}</div></TableCell></TableRow>)}
                </TableBody></Table></div>
              )}
              <Pagination page={openPage} total={openOperations.total} onPageChange={setOpenPage} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="historico">
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1"><Label>Material</Label><Input value={historyFilters.search} onChange={(event) => updateFilter("search", event.target.value)} /></div>
                <div className="space-y-1"><Label>Responsável</Label><Input value={historyFilters.responsible} onChange={(event) => updateFilter("responsible", event.target.value)} /></div>
                <div className="space-y-1"><Label>Usuário executor</Label><Select value={historyFilters.executorId || "todos"} onValueChange={(value) => updateFilter("executorId", value === "todos" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem>{userResponsibles.map((item) => <SelectItem key={item.id} value={item.id}>{item.nome}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label>Status</Label><Select value={historyFilters.status} onValueChange={(value) => updateFilter("status", value as CustodyFilters["status"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem>{statuses.map((item) => <SelectItem key={item} value={item}>{CUSTODY_STATUS_LABELS[item]}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label>Finalidade</Label><Select value={historyFilters.purpose} onValueChange={(value) => updateFilter("purpose", value as CustodyFilters["purpose"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todas</SelectItem>{purposes.map((item) => <SelectItem key={item} value={item}>{CUSTODY_PURPOSE_LABELS[item]}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label>Localização de saída</Label><Select value={historyFilters.locationId || "todas"} onValueChange={(value) => updateFilter("locationId", value === "todas" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas</SelectItem>{locations.map((item) => <SelectItem key={item.id} value={item.id}>{item.codigo} · {item.nome}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label>De</Label><Input type="date" value={historyFilters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} /></div>
                <div className="space-y-1"><Label>Até</Label><Input type="date" value={historyFilters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} /></div>
              </div>
              {!history.items.length ? <p className="p-8 text-center text-muted-foreground">Nenhuma operação encontrada.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Responsável</TableHead><TableHead>Executor</TableHead><TableHead>Finalidade</TableHead><TableHead>Quantidades</TableHead><TableHead>Saída</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Histórico</TableHead></TableRow></TableHeader><TableBody>{history.items.map((operation) => <TableRow key={operation.id}><TableCell><p className="font-medium">{operation.material_nome}</p><p className="text-xs text-muted-foreground">{operation.material_codigo}</p></TableCell><TableCell>{operation.responsavel_nome}</TableCell><TableCell>{operation.executor_nome}</TableCell><TableCell>{CUSTODY_PURPOSE_LABELS[operation.finalidade]}</TableCell><TableCell>{operation.quantidade_devolvida} devolvida(s) de {operation.quantidade_retirada}</TableCell><TableCell>{new Date(operation.retirada_em).toLocaleString("pt-BR")}</TableCell><TableCell><Badge variant="outline">{CUSTODY_STATUS_LABELS[operation.status]}</Badge></TableCell><TableCell className="text-right"><Button size="icon" variant="ghost" title="Histórico completo" onClick={() => setHistoryOperation(operation)}><ListRestart className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>}
              <Pagination page={historyPage} total={history.total} onPageChange={setHistoryPage} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {companyId && <CheckoutDialog open={!!checkoutMaterial} onOpenChange={(open) => !open && setCheckoutMaterial(null)} companyId={companyId} material={checkoutMaterial} responsibles={responsibles} onSaved={refreshAfterOperation} />}
      {companyId && <CheckinDialog open={!!checkinOperation} onOpenChange={(open) => !open && setCheckinOperation(null)} companyId={companyId} operation={checkinOperation} locations={locations} onSaved={refreshAfterOperation} />}
      {companyId && <CancelCheckoutDialog open={!!cancelOperation} onOpenChange={(open) => !open && setCancelOperation(null)} companyId={companyId} operation={cancelOperation} onSaved={refreshAfterOperation} />}
      {companyId && <CustodyHistoryDialog open={!!historyOperation} onOpenChange={(open) => !open && setHistoryOperation(null)} companyId={companyId} operation={historyOperation} />}
    </div>
  );
}
