import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Boxes,
  History,
  MapPinned,
  PackageCheck,
  PackageX,
  RotateCcw,
  Search,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useStock } from "@/hooks/useStock";
import { StockMovementDialog } from "@/components/stock/StockMovementDialog";
import { StockLocationManager } from "@/components/stock/StockLocationManager";
import { StockReversalDialog } from "@/components/stock/StockReversalDialog";
import {
  STOCK_MOVEMENT_LABELS,
  stockBalanceStatus,
} from "@/lib/stock-domain";
import type {
  StockFilters,
  StockMaterial,
  StockMovementFilters,
  StockMovementView,
} from "@/lib/stock-types";
import { listStockCompaniesForMaster } from "@/lib/stock-service";
import { CompanyContextSelector } from "@/components/company/CompanyContextSelector";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getStockPermissions } from "@/lib/stock-permissions";
import { hasCompanyOperationalAccess } from "@/lib/access-control";

const PAGE_SIZE = 10;

const initialFilters: StockFilters = {
  search: "",
  categoryId: "",
  controlType: "todos",
  balance: "todos",
  locationId: "",
  active: "ativos",
};

function Pagination({
  page,
  total,
  onPageChange,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        Página {Math.min(page, pages)} de {pages} · {total} registro(s)
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}

export default function Estoque() {
  const {
    empresaId: authenticatedCompanyId,
    role,
    isMasterAdmin,
    empresaReadOnly,
  } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const masterCompanyId = isMasterAdmin
    ? searchParams.get("empresa") ?? ""
    : "";
  const requestedMaterialId = searchParams.get("material") || undefined;
  const requestedTab =
    searchParams.get("tab") === "historico" ? "historico" : "saldos";
  const { data: masterCompanies = [], isLoading: loadingMasterCompanies } = useQuery({
    queryKey: ["stock-master-companies"],
    queryFn: listStockCompaniesForMaster,
    enabled: isMasterAdmin,
  });
  const selectedMasterCompany = masterCompanies.find(
    (company) => company.id === masterCompanyId,
  );
  const empresaId = isMasterAdmin
    ? selectedMasterCompany?.id ?? null
    : authenticatedCompanyId;
  const selectedPlan = selectedMasterCompany?.planos as
    | { periodicidade: string | null; ativo: boolean }
    | null
    | undefined;
  const effectiveCompanyReadOnly = isMasterAdmin
    ? selectedMasterCompany
      ? !hasCompanyOperationalAccess({
          ...selectedMasterCompany,
          plan_periodicity: selectedPlan?.periodicidade ?? null,
          plan_active: selectedPlan?.ativo ?? null,
        })
      : true
    : empresaReadOnly;
  const { hasModule, isLoading: loadingModules } = useCompanyModules(empresaId);
  const permissions = getStockPermissions({
    role,
    moduleEnabled:
      hasModule(MODULE_KEYS.CONTROLE_ESTOQUE) &&
      hasModule(MODULE_KEYS.GESTAO_MATERIAIS),
    companyReadOnly: effectiveCompanyReadOnly,
    companySelected: !!empresaId,
  });
  const canWrite = permissions.movimentar;
  const [page, setPage] = useState(1);
  const [historyPageNumber, setHistoryPageNumber] = useState(1);
  const [filters, setFilters] = useState<StockFilters>({
    ...initialFilters,
    search: requestedMaterialId ?? "",
  });
  const [historyFilters, setHistoryFilters] = useState<StockMovementFilters>({
    type: "todos",
    materialId: requestedMaterialId,
  });
  const [movementOpen, setMovementOpen] = useState(false);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<StockMaterial | null>(
    null,
  );
  const [operation, setOperation] =
    useState<"entrada" | "saida" | "transferencia" | "saldo_inicial" | "ajuste">(
      "entrada",
    );
  const [reversal, setReversal] = useState<StockMovementView | null>(null);
  const {
    locations,
    materialsPage,
    materialOptions,
    categories,
    users,
    indicators,
    historyPage,
    isLoading,
    error,
    invalidateStock,
    invalidateLocations,
  } = useStock({
    companyId: empresaId,
    page,
    pageSize: PAGE_SIZE,
    filters,
    historyPage: historyPageNumber,
    historyFilters,
    accessEnabled: permissions.visualizar,
  });

  useEffect(() => setPage(1), [filters]);
  useEffect(() => setHistoryPageNumber(1), [historyFilters]);

  const selectMasterCompany = (companyId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("empresa", companyId);
    setSearchParams(next, { replace: true });
    setMovementOpen(false);
    setLocationsOpen(false);
    setReversal(null);
    setSelectedMaterial(null);
  };

  const openOperation = (
    material: StockMaterial,
    nextOperation: typeof operation,
  ) => {
    setSelectedMaterial(material);
    setOperation(nextOperation);
    setMovementOpen(true);
  };

  if (!empresaId) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Controle de Estoque</h1>
          <p className="text-muted-foreground">
            Selecione a empresa canônica para operar em contexto master.
          </p>
        </div>
        <Card>
          <CardContent className="max-w-xl space-y-2 p-6">
            <CompanyContextSelector
              companies={masterCompanies}
              value={masterCompanyId}
              onValueChange={selectMasterCompany}
              disabled={loadingMasterCompanies}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!loadingModules && !permissions.visualizar) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Controle de Estoque</h1>
          <p className="text-muted-foreground">
            A empresa selecionada não possui acesso ao módulo.
          </p>
        </div>
        {isMasterAdmin && (
          <Card>
            <CardContent className="max-w-xl p-6">
              <CompanyContextSelector
                companies={masterCompanies}
                value={masterCompanyId}
                onValueChange={selectMasterCompany}
                disabled={loadingMasterCompanies}
              />
            </CardContent>
          </Card>
        )}
        <Card className="border-amber-500/50">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Verifique os módulos Gestão de Materiais e Controle de Estoque da
            empresa. Nenhuma consulta ou ação de estoque foi habilitada.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold">Controle de Estoque</h1>
          <p className="text-muted-foreground">
            Saldos oficiais por localização e histórico auditável.
          </p>
        </div>
        {permissions.gerenciarLocalizacoes && (
          <Button variant="outline" onClick={() => setLocationsOpen(true)}>
            <MapPinned className="mr-2 h-4 w-4" />
            Localizações
          </Button>
        )}
      </div>

      {isMasterAdmin && (
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
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {([
          ["Materiais cadastrados", indicators.materiais, Boxes],
          ["Unidades em estoque", indicators.unidades, PackageCheck],
          ["Sem saldo", indicators.semSaldo, PackageX],
          ["Abaixo do mínimo", indicators.abaixoMinimo, TriangleAlert],
          ["Localizações ativas", indicators.localizacoesAtivas, MapPinned],
          ["Movimentos em 7 dias", indicators.movimentacoesRecentes, History],
        ] as [string, number, LucideIcon][]).map(([label, value, Icon]) => (
          <Card key={String(label)}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{String(value)}</p>
              </div>
              <Icon className="h-6 w-6 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue={requestedTab}>
        <TabsList>
          <TabsTrigger value="saldos">Saldos</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="saldos" className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Nome, códigos, UUID ou conteúdo do QR"
                  value={filters.search}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      search: event.target.value,
                    }))
                  }
                />
              </div>
              <Select
                value={filters.balance}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    balance: value as StockFilters["balance"],
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os saldos</SelectItem>
                  <SelectItem value="com_saldo">Com saldo</SelectItem>
                  <SelectItem value="sem_saldo">Sem saldo</SelectItem>
                  <SelectItem value="abaixo_minimo">Abaixo do mínimo</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.categoryId || "todas"}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    categoryId: value === "todas" ? "" : value,
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as categorias</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.controlType}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    controlType: value as StockFilters["controlType"],
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Controle" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os controles</SelectItem>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="quantidade">Por quantidade</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.active}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    active: value as StockFilters["active"],
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Situação cadastral" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativos">Ativos</SelectItem>
                  <SelectItem value="inativos">Inativos</SelectItem>
                  <SelectItem value="todos">Ativos e inativos</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.locationId || "todas"}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    locationId: value === "todas" ? "" : value,
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as localizações</SelectItem>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {error && (
            <Card className="border-destructive">
              <CardContent className="p-4 text-destructive">
                {error instanceof Error ? error.message : "Falha ao carregar estoque."}
              </CardContent>
            </Card>
          )}

          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Controle</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Saldo / mínimo</TableHead>
                  <TableHead>Localizações</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!isLoading && materialsPage.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Nenhum material encontrado.
                    </TableCell>
                  </TableRow>
                )}
                {materialsPage.items.map((material) => {
                  const state = stockBalanceStatus(
                    material.quantidade,
                    material.estoque_minimo,
                  );
                  return (
                    <TableRow key={material.id}>
                      <TableCell>
                        <p className="font-medium">{material.nome}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {material.codigo_interno}
                        </p>
                      </TableCell>
                      <TableCell>
                        {material.tipo_controle === "individual"
                          ? "Individual"
                          : "Quantidade"}
                      </TableCell>
                      <TableCell>
                        {categories.find(
                          (category) => category.id === material.categoria_id,
                        )?.nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-semibold">{material.quantidade}</span>
                        <span className="text-muted-foreground"> / {material.estoque_minimo}</span>
                        {state !== "normal" && (
                          <Badge variant="destructive" className="ml-2">
                            {state === "sem_saldo" ? "Sem saldo" : "Baixo"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {material.saldos.length
                          ? material.saldos
                              .map(
                                (balance) =>
                                  `${balance.localizacao?.nome ?? "Local"}: ${balance.quantidade}`,
                              )
                              .join(" · ")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            {material.quantidade === 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openOperation(material, "saldo_inicial")}
                              >
                                Inicial
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Entrada"
                              onClick={() => openOperation(material, "entrada")}
                            >
                              <ArrowDownToLine className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Saída"
                              onClick={() => openOperation(material, "saida")}
                            >
                              <PackageX className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Transferência"
                              onClick={() => openOperation(material, "transferencia")}
                            >
                              <ArrowLeftRight className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Ajuste físico"
                              onClick={() => openOperation(material, "ajuste")}
                            >
                              <Settings2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="space-y-3 md:hidden">
            {materialsPage.items.map((material) => (
              <Card key={material.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{material.nome}</CardTitle>
                  <p className="font-mono text-xs text-muted-foreground">
                    {material.codigo_interno}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">
                    Saldo <strong>{material.quantidade}</strong> · mínimo{" "}
                    {material.estoque_minimo}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {material.saldos
                      .map((item) => `${item.localizacao?.nome}: ${item.quantidade}`)
                      .join(" · ") || "Sem localização com saldo"}
                  </p>
                  {canWrite && (
                    <Button
                      size="sm"
                      onClick={() =>
                        openOperation(
                          material,
                          material.quantidade === 0 ? "saldo_inicial" : "entrada",
                        )
                      }
                    >
                      Movimentar
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <Pagination
            page={page}
            total={materialsPage.total}
            onPageChange={setPage}
          />
        </TabsContent>

        <TabsContent value="historico" className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-4 xl:grid-cols-8">
              <Select
                value={historyFilters.materialId || "todos"}
                onValueChange={(value) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    materialId: value === "todos" ? undefined : value,
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Material" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os materiais</SelectItem>
                  {materialOptions.map((material) => (
                    <SelectItem key={material.id} value={material.id}>
                      {material.codigo_interno} · {material.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={historyFilters.type ?? "todos"}
                onValueChange={(value) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    type: value as StockMovementFilters["type"],
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os tipos</SelectItem>
                  {Object.entries(STOCK_MOVEMENT_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={historyFilters.locationId || "todas"}
                onValueChange={(value) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    locationId: value === "todas" ? undefined : value,
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as localizações</SelectItem>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={historyFilters.userId || "todos"}
                onValueChange={(value) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    userId: value === "todos" ? undefined : value,
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Usuário" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os usuários</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.user_id} value={user.user_id}>
                      {user.full_name || "Usuário"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={historyFilters.sourceModule || "todos"}
                onValueChange={(value) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    sourceModule:
                      value as StockMovementFilters["sourceModule"],
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Origem" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas as origens</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="controle_estoque">Controle de Estoque</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Documento"
                value={historyFilters.document ?? ""}
                onChange={(event) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    document: event.target.value || undefined,
                  }))
                }
              />
              <Input
                type="date"
                value={historyFilters.dateFrom ?? ""}
                onChange={(event) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    dateFrom: event.target.value || undefined,
                  }))
                }
              />
              <Input
                type="date"
                value={historyFilters.dateTo ?? ""}
                onChange={(event) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    dateTo: event.target.value || undefined,
                  }))
                }
              />
            </CardContent>
          </Card>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Trajeto</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Saldo total</TableHead>
                  <TableHead>Detalhes</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyPage.items.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(movement.data_efetiva))}
                    </TableCell>
                    <TableCell>
                      <p>{movement.material_nome}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {movement.material_codigo}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {STOCK_MOVEMENT_LABELS[movement.tipo_movimentacao]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {movement.localizacao_origem_nome ?? "Externo"} →{" "}
                      {movement.localizacao_destino_nome ?? "Externo"}
                    </TableCell>
                    <TableCell className="text-right">{movement.quantidade}</TableCell>
                    <TableCell className="text-right">
                      {movement.saldo_total_anterior} → {movement.saldo_total_posterior}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">
                      <p>{movement.motivo || movement.justificativa || "Sem motivo"}</p>
                      <p>
                        {movement.usuario_nome} · {movement.origem_modulo}
                        {movement.documento_referencia
                          ? ` · ${movement.documento_referencia}`
                          : ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      {canWrite && movement.tipo_movimentacao !== "estorno" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Estornar"
                          onClick={() => setReversal(movement)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {historyPage.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      <History className="mx-auto mb-2 h-5 w-5" />
                      Nenhuma movimentação encontrada.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
          <Pagination
            page={historyPageNumber}
            total={historyPage.total}
            onPageChange={setHistoryPageNumber}
          />
        </TabsContent>
      </Tabs>

      <StockMovementDialog
        open={movementOpen}
        onOpenChange={setMovementOpen}
        companyId={empresaId}
        material={selectedMaterial}
        locations={locations}
        initialOperation={operation}
        onSaved={invalidateStock}
      />
      <StockLocationManager
        open={locationsOpen}
        onOpenChange={setLocationsOpen}
        companyId={empresaId}
        locations={locations}
        canWrite={canWrite}
        onChanged={invalidateLocations}
      />
      <StockReversalDialog
        open={!!reversal}
        onOpenChange={(next) => {
          if (!next) setReversal(null);
        }}
        companyId={empresaId}
        movement={reversal}
        onSaved={invalidateStock}
      />
    </div>
  );
}
