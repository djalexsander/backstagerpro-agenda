import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Camera,
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
import { MaterialPhotoImage } from "@/components/materials/MaterialPhotoImage";
import { MaterialQrScanner } from "@/components/materials/MaterialQrScanner";
import { CheckoutDialog } from "@/components/checkin-checkout/CheckoutDialog";
import { CheckinDialog } from "@/components/checkin-checkout/CheckinDialog";
import { CheckinOriginDialog } from "@/components/checkin-checkout/CheckinOriginDialog";
import { CancelCheckoutDialog } from "@/components/checkin-checkout/CancelCheckoutDialog";
import { CustodyHistoryDialog } from "@/components/checkin-checkout/CustodyHistoryDialog";
import { CustodyWriteOffDialog } from "@/components/checkin-checkout/CustodyWriteOffDialog";
import { RentalOperationsQueue } from "@/components/checkin-checkout/RentalOperationsQueue";
import { RemoteScannerSessionsPanel } from "@/components/checkin-checkout/RemoteScannerSessionsPanel";
import { EventCustodyPanel } from "@/components/checkin-checkout/EventCustodyPanel";
import { RentalWithdrawalDialog } from "@/components/checkin-checkout/RentalWithdrawalDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useCheckinCheckout } from "@/hooks/useCheckinCheckout";
import { useCompanyRealtime } from "@/hooks/useCompanyRealtime";
import { useModulePermission } from "@/hooks/useModulePermission";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getCustodyPermissions } from "@/lib/checkin-checkout-permissions";
import {
  CUSTODY_PURPOSE_LABELS,
  CUSTODY_STATUS_LABELS,
  getCustodyMaterialActions,
  normalizeCustodyScan,
  resolveCheckinOrigin,
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
import { getRentalPermissions } from "@/lib/material-rental-permissions";

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
    empresaId: companyId,
    empresaReadOnly,
    isMasterAdmin,
  } = useAuth();
  const { hasModule, isLoading: loadingModules } = useCompanyModules(companyId);
  const moduleEnabled =
    hasModule(MODULE_KEYS.CHECKIN_CHECKOUT) &&
    hasModule(MODULE_KEYS.GESTAO_MATERIAIS) &&
    hasModule(MODULE_KEYS.CONTROLE_ESTOQUE);
  const { permission: custodyGrant } = useModulePermission({
    companyId,
    featureKey: MODULE_KEYS.CHECKIN_CHECKOUT,
    role,
  });
  const permissions = getCustodyPermissions({
    role,
    moduleEnabled,
    companyReadOnly: empresaReadOnly,
    companySelected: Boolean(companyId),
    granular: custodyGrant
      ? {
          canCreate: custodyGrant.canCreate,
          canEdit: custodyGrant.canEdit,
          canDelete: custodyGrant.canDelete,
        }
      : null,
  });
  // Locações é um módulo adicional (não exigido pelas outras abas desta
  // página) - quando não contratado, a aba "Locações" simplesmente não é
  // renderizada e o restante do Check-in/Check-out continua funcionando
  // normalmente via QR/código de barras/busca manual, igual ao RFID.
  const rentalModuleEnabled =
    moduleEnabled &&
    hasModule(MODULE_KEYS.LOCACAO_MATERIAIS);
  const rentalPermissions = getRentalPermissions({
    role,
    moduleEnabled: rentalModuleEnabled,
    companyReadOnly: empresaReadOnly,
    companySelected: Boolean(companyId),
  });

  const [openPage, setOpenPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFilters, setHistoryFilters] = useState(INITIAL_FILTERS);
  const [scannerValue, setScannerValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<CustodyMaterialSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [checkoutMaterial, setCheckoutMaterial] = useState<CustodyMaterialSearchResult | null>(null);
  const [checkinOperation, setCheckinOperation] = useState<CustodyOperationView | null>(null);
  const [checkinOriginChoices, setCheckinOriginChoices] = useState<CustodyOperationView[] | null>(null);
  const [cancelOperation, setCancelOperation] = useState<CustodyOperationView | null>(null);
  const [writeOffOperation, setWriteOffOperation] = useState<CustodyOperationView | null>(null);
  const [historyOperation, setHistoryOperation] = useState<CustodyOperationView | null>(null);
  const [detailRentalId, setDetailRentalId] = useState<string | null>(null);
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

  // Same tables Scanner Remoto (src/pages/ScannerRemoto.tsx) touches - a
  // check-in/check-out or locação change made from a phone/PWA terminal
  // shows up here without a manual reload, and vice versa. See
  // src/lib/realtime/realtime-domains.ts for what each domain invalidates.
  useCompanyRealtime(companyId, ["material_custodias", "material_locacoes", "materiais"]);

  useEffect(() => setHistoryPage(1), [historyFilters]);

  // Central identification function - manual typing, USB/Bluetooth scanner
  // (both submit the form, hitting the FormEvent branch) and the camera
  // reader (which passes its decoded text directly, see handleQrDetected)
  // all funnel through this exact same function and the exact same RPC.
  // No second identification rule was created for the camera.
  const executeSearch = async (eventOrValue?: FormEvent | string) => {
    const explicitValue = typeof eventOrValue === "string" ? eventOrValue : undefined;
    if (typeof eventOrValue !== "string") eventOrValue?.preventDefault();
    if (!companyId) return;
    const normalized = normalizeCustodyScan(explicitValue ?? scannerValue);
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

  // onDetected -> setScannerValue -> executeSearch(code) directly, instead
  // of relying on scannerValue from state: setState is async, so reading
  // scannerValue back out immediately after setting it isn't guaranteed to
  // see the new value yet. Passing the decoded text straight through
  // sidesteps that race entirely.
  const handleQrDetected = (code: string) => {
    setScannerValue(code);
    void executeSearch(code);
    // Camera reader closed - hand focus back to the identification field so
    // scanning again (camera, USB/Bluetooth, or typing) works immediately.
    requestAnimationFrame(() => scannerRef.current?.focus());
  };

  const refreshAfterOperation = async () => {
    await invalidateCustody();
    if (companyId && scannerValue.trim()) {
      setSearchResults(await searchCustodyMaterials(companyId, scannerValue));
    }
  };

  // Fetches this material's open custodies (same listCustodyOperations call
  // used everywhere else in this file - onlyOpen already returns
  // CustodyOperationView, with finalidade/localizacao_origem_nome/
  // quantidade_pendente, no new RPC) and hands them to resolveCheckinOrigin
  // (checkin-checkout-domain.ts): exactly one open custody skips straight to
  // CheckinDialog, two or more open CheckinOriginDialog instead of guessing.
  const openCheckinFromSearch = async (material: CustodyMaterialSearchResult) => {
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
      // The search filter above matches by text and could in principle
      // surface another material sharing part of this codigo_interno -
      // narrow to this exact material before resolving.
      const materialOperations = page.items.filter((item) => item.material_id === material.id);
      const resolution = resolveCheckinOrigin(materialOperations);
      if (resolution.kind === "auto") setCheckinOperation(resolution.custody);
      else if (resolution.kind === "choose") setCheckinOriginChoices(resolution.options);
      else setSearchMessage("A operação aberta foi atualizada. Faça uma nova leitura.");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectCheckinOrigin = (operation: CustodyOperationView) => {
    setCheckinOriginChoices(null);
    setCheckinOperation(operation);
  };

  if (!companyId) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Check-in / Check-out</h1>
          <p className="text-muted-foreground">
            {isMasterAdmin
              ? "Sua conta master não está vinculada a uma empresa operacional."
              : "Nenhuma empresa vinculada à sua conta."}
          </p>
        </div>
      </div>
    );
  }

  if (!loadingModules && !permissions.visualizar) {
    return (
      <div className="space-y-4">
        <div><h1 className="text-2xl font-bold">Check-in / Check-out</h1><p className="text-muted-foreground">Sua empresa não possui acesso ao módulo e suas dependências.</p></div>
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

      {permissions.visualizar && companyId && <RemoteScannerSessionsPanel companyId={companyId} />}

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
            <Button
              type="button"
              variant="outline"
              className="h-12"
              onClick={() => setCameraOpen(true)}
            >
              <Camera className="mr-2 h-4 w-4" />
              Ler com a câmera
            </Button>
            <Button className="h-12" disabled={searching} type="submit">
              {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
              Identificar
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Scanners USB/Bluetooth funcionam como teclado: mantenha o cursor no campo e finalize com Enter. Em celulares e tablets, use "Ler com a câmera" para ler o QR Code da etiqueta.</p>
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
                          {actions.canCheckin && permissions.checkin && (
                            <Button size="sm" variant="outline" onClick={() => void openCheckinFromSearch(material)}>
                              Check-in ({actions.pending})
                            </Button>
                          )}
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
        <TabsList>
          <TabsTrigger value="abertas">Operações em aberto</TabsTrigger>
          {rentalPermissions.visualizar && <TabsTrigger value="locacoes">Locações</TabsTrigger>}
          <TabsTrigger value="por-evento">Por Evento</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
        {rentalPermissions.visualizar && companyId && (
          <TabsContent value="locacoes">
            <RentalOperationsQueue companyId={companyId} permissions={rentalPermissions} onSelect={setDetailRentalId} />
          </TabsContent>
        )}
        {companyId && (
          <TabsContent value="por-evento">
            <EventCustodyPanel companyId={companyId} canCheckin={permissions.checkin} locations={locations} />
          </TabsContent>
        )}
        <TabsContent value="abertas">
          <Card>
            <CardContent className="p-4">
              {isLoading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : !openOperations.items.length ? <p className="p-8 text-center text-muted-foreground">Nenhum material está em custódia.</p> : (
                <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Qtd.</TableHead><TableHead>Responsável</TableHead><TableHead>Saída</TableHead><TableHead>Previsão</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>
                  {openOperations.items.map((operation) => <TableRow key={operation.id}><TableCell><p className="font-medium">{operation.material_nome}</p><p className="text-xs text-muted-foreground">{operation.material_codigo} · {operation.localizacao_origem_nome}</p></TableCell><TableCell>{operation.quantidade_pendente} / {operation.quantidade_retirada}</TableCell><TableCell>{operation.responsavel_nome}</TableCell><TableCell>{new Date(operation.retirada_em).toLocaleString("pt-BR")}</TableCell><TableCell>{dueBadge(operation)}</TableCell><TableCell><Badge variant="outline">{CUSTODY_STATUS_LABELS[operation.status]}</Badge></TableCell><TableCell className="text-right"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Histórico completo" onClick={() => setHistoryOperation(operation)}><ListRestart className="h-4 w-4" /></Button>{permissions.checkin && <Button size="sm" onClick={() => setCheckinOperation(operation)}><ClipboardCheck className="mr-1 h-4 w-4" /> Check-in</Button>}{permissions.cancelar && <Button size="sm" variant="outline" title="Encerrar quantidade perdida ou avariada sem retorno físico" onClick={() => setWriteOffOperation(operation)}><ShieldAlert className="mr-1 h-4 w-4" /> Baixa</Button>}{permissions.cancelar && operation.status === "aberta" && operation.quantidade_devolvida === 0 && <Button size="icon" variant="ghost" title="Cancelar com estorno" onClick={() => setCancelOperation(operation)}><RotateCcw className="h-4 w-4" /></Button>}</div></TableCell></TableRow>)}
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
              {!history.items.length ? <p className="p-8 text-center text-muted-foreground">Nenhuma operação encontrada.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Responsável</TableHead><TableHead>Executor</TableHead><TableHead>Finalidade</TableHead><TableHead>Quantidades</TableHead><TableHead>Saída</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Histórico</TableHead></TableRow></TableHeader><TableBody>{history.items.map((operation) => <TableRow key={operation.id}><TableCell><p className="font-medium">{operation.material_nome}</p><p className="text-xs text-muted-foreground">{operation.material_codigo}</p></TableCell><TableCell>{operation.responsavel_nome}</TableCell><TableCell>{operation.executor_nome}</TableCell><TableCell>{CUSTODY_PURPOSE_LABELS[operation.finalidade]}</TableCell><TableCell>{operation.quantidade_devolvida} devolvida(s) · {operation.quantidade_baixada} baixada(s) de {operation.quantidade_retirada}</TableCell><TableCell>{new Date(operation.retirada_em).toLocaleString("pt-BR")}</TableCell><TableCell><Badge variant="outline">{CUSTODY_STATUS_LABELS[operation.status]}</Badge></TableCell><TableCell className="text-right"><Button size="icon" variant="ghost" title="Histórico completo" onClick={() => setHistoryOperation(operation)}><ListRestart className="h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>}
              <Pagination page={historyPage} total={history.total} onPageChange={setHistoryPage} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <MaterialQrScanner open={cameraOpen} onOpenChange={setCameraOpen} onDetected={handleQrDetected} />

      {companyId && <CheckoutDialog open={!!checkoutMaterial} onOpenChange={(open) => !open && setCheckoutMaterial(null)} companyId={companyId} material={checkoutMaterial} responsibles={responsibles} onSaved={refreshAfterOperation} />}
      {companyId && <CheckinDialog open={!!checkinOperation} onOpenChange={(open) => !open && setCheckinOperation(null)} companyId={companyId} operation={checkinOperation} locations={locations} onSaved={refreshAfterOperation} />}
      {companyId && (
        <CheckinOriginDialog
          open={!!checkinOriginChoices}
          onOpenChange={(open) => !open && setCheckinOriginChoices(null)}
          companyId={companyId}
          options={checkinOriginChoices ?? []}
          onSelect={handleSelectCheckinOrigin}
        />
      )}
      {companyId && <CancelCheckoutDialog open={!!cancelOperation} onOpenChange={(open) => !open && setCancelOperation(null)} companyId={companyId} operation={cancelOperation} onSaved={refreshAfterOperation} />}
      {companyId && <CustodyWriteOffDialog open={!!writeOffOperation} onOpenChange={(open) => !open && setWriteOffOperation(null)} companyId={companyId} operation={writeOffOperation} onSaved={refreshAfterOperation} />}
      {companyId && <CustodyHistoryDialog open={!!historyOperation} onOpenChange={(open) => !open && setHistoryOperation(null)} companyId={companyId} operation={historyOperation} />}
      {companyId && (
        <RentalWithdrawalDialog
          open={Boolean(detailRentalId)}
          onOpenChange={(next) => { if (!next) setDetailRentalId(null); }}
          companyId={companyId}
          rentalId={detailRentalId}
          permissions={rentalPermissions}
          locations={locations}
          responsibles={responsibles}
          onChanged={invalidateCustody}
        />
      )}
    </div>
  );
}
