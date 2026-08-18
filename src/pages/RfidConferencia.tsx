import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  HelpCircle,
  Loader2,
  Radio,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useToast } from "@/hooks/use-toast";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getRfidPermissions } from "@/lib/rfid-permissions";
import { useModulePermission } from "@/hooks/useModulePermission";
import { listMaterials } from "@/lib/material-service";
import { getMaterialRental, listMaterialRentals } from "@/lib/material-rental-service";
import { finishReadSession, recordReadSessionEpcs, resolveEpcs, startReadSession } from "@/lib/rfid-service";
import {
  normalizeEpc,
  parseEpcList,
  reconcileRfidRead,
  RECONCILIATION_BUCKET_LABELS,
} from "@/lib/rfid-domain";
import { RFID_READ_SESSION_TYPE_LABELS, type RfidReadSessionType } from "@/lib/rfid-types";
import { getTerminalRfidReaderConfig } from "@/lib/terminal-rfid-config";
import type { MaterialWithRelations } from "@/lib/material-types";

interface ExpectedMaterial {
  id: string;
  nome: string;
  codigo_interno: string;
}

const SESSION_TYPE_OPTIONS: RfidReadSessionType[] = [
  "conferencia_livre",
  "inventario",
  "conferencia_locacao",
  "checkout",
  "checkin",
  "conferencia_case",
];

const EMPTY_RENTAL_FILTERS = {
  search: "",
  status: "todos" as const,
  customerId: "",
  dateFrom: "",
  dateTo: "",
  overdueOnly: false,
  responsible: "",
};

export default function RfidConferencia() {
  const { role, empresaId: companyId, empresaReadOnly: readOnly, isMasterAdmin } = useAuth();
  const { hasModule, isLoading: loadingModules } = useCompanyModules(companyId);
  const moduleEnabled = hasModule(MODULE_KEYS.RFID_MATERIAIS) && hasModule(MODULE_KEYS.GESTAO_MATERIAIS);
  const { permission: rfidGrant, isLoading: loadingGrant } = useModulePermission({
    companyId,
    featureKey: MODULE_KEYS.RFID_MATERIAIS,
    role,
  });
  const permissions = getRfidPermissions({
    role,
    moduleEnabled,
    companyReadOnly: readOnly,
    companySelected: Boolean(companyId),
    granular: rfidGrant
      ? {
          canView: rfidGrant.canView,
          canCreate: rfidGrant.canCreate,
          canEdit: rfidGrant.canEdit,
          canDelete: rfidGrant.canDelete,
        }
      : null,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [sessionType, setSessionType] = useState<RfidReadSessionType>("conferencia_livre");
  const [rentalId, setRentalId] = useState("");
  const [expectedMaterials, setExpectedMaterials] = useState<ExpectedMaterial[]>([]);
  const [materialSearch, setMaterialSearch] = useState("");
  const [epcInput, setEpcInput] = useState("");
  const [epcPaste, setEpcPaste] = useState("");
  const [readEpcs, setReadEpcs] = useState<string[]>([]);

  const enabled = Boolean(companyId && permissions.visualizar);
  const isRentalMode = sessionType === "conferencia_locacao";

  const materialsQuery = useQuery({
    queryKey: ["rfid-lab-materials", companyId],
    queryFn: () => listMaterials(companyId!),
    enabled: enabled && !isRentalMode,
  });

  const rentalsQuery = useQuery({
    queryKey: ["rfid-lab-rentals", companyId],
    queryFn: () =>
      listMaterialRentals({ companyId: companyId!, page: 1, pageSize: 50, filters: EMPTY_RENTAL_FILTERS }),
    enabled: enabled && isRentalMode,
  });

  const rentalDetailQuery = useQuery({
    queryKey: ["rfid-lab-rental-detail", companyId, rentalId],
    queryFn: () => getMaterialRental(companyId!, rentalId),
    enabled: enabled && isRentalMode && !!rentalId,
  });

  const rentalMaterials = useMemo<ExpectedMaterial[]>(() => {
    if (!rentalDetailQuery.data) return [];
    return rentalDetailQuery.data.itens
      .filter((item) => item.material.tipo_controle === "individual")
      .map((item) => ({
        id: item.material.id,
        nome: item.material.nome,
        codigo_interno: item.material.codigo_interno,
      }));
  }, [rentalDetailQuery.data]);

  const effectiveExpected = isRentalMode ? rentalMaterials : expectedMaterials;

  const resolveKey = ["rfid-lab-resolve", companyId, [...readEpcs].sort().join(",")];
  const resolveQuery = useQuery({
    queryKey: resolveKey,
    queryFn: () => resolveEpcs(readEpcs),
    enabled: enabled && readEpcs.length > 0,
  });

  const reconciliation = useMemo(
    () =>
      reconcileRfidRead({
        expectedMaterialIds: effectiveExpected.map((material) => material.id),
        resolutions: resolveQuery.data ?? [],
      }),
    [effectiveExpected, resolveQuery.data],
  );

  const materialById = useMemo(() => {
    const map = new Map<string, ExpectedMaterial>();
    for (const material of effectiveExpected) map.set(material.id, material);
    for (const material of materialsQuery.data ?? []) {
      map.set(material.id, {
        id: material.id,
        nome: material.nome,
        codigo_interno: material.codigo_interno,
      });
    }
    return map;
  }, [effectiveExpected, materialsQuery.data]);

  function addEpcs(values: string[]) {
    if (!values.length) return;
    setReadEpcs((current) => Array.from(new Set([...current, ...values])));
  }

  function addManualMaterial(material: MaterialWithRelations) {
    setExpectedMaterials((current) =>
      current.some((item) => item.id === material.id)
        ? current
        : [...current, { id: material.id, nome: material.nome, codigo_interno: material.codigo_interno }],
    );
  }

  function reset() {
    setExpectedMaterials([]);
    setReadEpcs([]);
    setRentalId("");
    setEpcInput("");
    setEpcPaste("");
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const session = await startReadSession({
        tipo: sessionType,
        referenciaTipo: isRentalMode ? "locacao" : null,
        referenciaId: isRentalMode ? rentalId || null : null,
        dispositivoLabel: companyId ? getTerminalRfidReaderConfig(companyId)?.readerLabel ?? null : null,
        expectedMaterialIds: effectiveExpected.map((material) => material.id),
      });
      await recordReadSessionEpcs(session.id, readEpcs);
      return finishReadSession({
        sessionId: session.id,
        status: "concluida",
      });
    },
    onSuccess: () => {
      toast({ title: "Conferência salva" });
      queryClient.invalidateQueries({ queryKey: ["rfid-lab-sessions", companyId] });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível salvar a conferência", description: error.message, variant: "destructive" }),
  });

  if (!companyId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">RFID UHF</h1>
        <p className="text-muted-foreground">
          {isMasterAdmin
            ? "Sua conta master não está vinculada a uma empresa operacional."
            : "Nenhuma empresa vinculada à sua conta."}
        </p>
      </div>
    );
  }

  if (!loadingModules && !loadingGrant && !permissions.visualizar) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">RFID UHF</h1>
        <Card className="border-amber-500/50">
          <CardContent className="p-4">
            {moduleEnabled
              ? "Você não tem permissão para visualizar RFID. Peça a um administrador da empresa para conceder acesso em Usuários."
              : "O módulo RFID UHF (e Gestão de Materiais) precisa estar ativo para esta empresa."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredMaterials = (materialsQuery.data ?? []).filter((material) => {
    if (material.tipo_controle !== "individual") return false;
    const term = materialSearch.trim().toLowerCase();
    if (!term) return true;
    return (
      material.nome.toLowerCase().includes(term) ||
      material.codigo_interno.toLowerCase().includes(term)
    );
  });

  const normalizedEpcInput = normalizeEpc(epcInput);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Radio className="h-6 w-6 text-primary" />
          RFID UHF · Conferência
        </h1>
        <p className="text-muted-foreground">
          Laboratório de homologação: simule leituras manualmente para validar o fluxo antes de conectar
          um reader físico.
        </p>
      </div>

      {readOnly && (
        <Card className="border-amber-500/50">
          <CardContent className="p-3 text-sm">
            Empresa em modo somente leitura. A conferência pode ser simulada, mas não salva.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Esperado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={sessionType} onValueChange={(value) => setSessionType(value as RfidReadSessionType)}>
            <SelectTrigger className="sm:max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SESSION_TYPE_OPTIONS.map((type) => (
                <SelectItem key={type} value={type}>
                  {RFID_READ_SESSION_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isRentalMode ? (
            <div className="space-y-3">
              <Select value={rentalId} onValueChange={setRentalId}>
                <SelectTrigger className="sm:max-w-md">
                  <SelectValue placeholder="Selecione uma locação" />
                </SelectTrigger>
                <SelectContent>
                  {(rentalsQuery.data?.items ?? []).map((rental) => (
                    <SelectItem key={rental.id} value={rental.id}>
                      {rental.numero} · {rental.cliente_nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2">
                {rentalMaterials.map((material) => (
                  <Badge key={material.id} variant="outline">
                    {material.nome}
                  </Badge>
                ))}
                {rentalId && !rentalMaterials.length && !rentalDetailQuery.isLoading && (
                  <span className="text-sm text-muted-foreground">
                    Esta locação não tem materiais de controle individual (elegíveis a tag RFID).
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                value={materialSearch}
                onChange={(event) => setMaterialSearch(event.target.value)}
                placeholder="Buscar material por nome ou código"
                className="sm:max-w-md"
              />
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {filteredMaterials.slice(0, 30).map((material) => (
                  <button
                    key={material.id}
                    type="button"
                    onClick={() => addManualMaterial(material)}
                    className="flex w-full items-center justify-between border-b p-2 text-left text-sm last:border-b-0 hover:bg-muted"
                  >
                    <span>
                      {material.nome}{" "}
                      <span className="text-xs text-muted-foreground">({material.codigo_interno})</span>
                    </span>
                    <span className="text-xs text-muted-foreground">Adicionar</span>
                  </button>
                ))}
                {!filteredMaterials.length && (
                  <p className="p-3 text-sm text-muted-foreground">Nenhum material individual encontrado.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {expectedMaterials.map((material) => (
                  <Badge key={material.id} variant="secondary" className="gap-1 pr-1">
                    {material.nome}
                    <button
                      type="button"
                      onClick={() =>
                        setExpectedMaterials((current) => current.filter((item) => item.id !== material.id))
                      }
                      aria-label={`Remover ${material.nome} dos esperados`}
                      className="rounded hover:bg-black/10"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2. Leituras (simuladas)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              value={epcInput}
              onChange={(event) => setEpcInput(event.target.value)}
              placeholder="EPC"
              className="max-w-xs font-mono"
              onKeyDown={(event) => {
                if (event.key === "Enter" && normalizedEpcInput) {
                  addEpcs([normalizedEpcInput]);
                  setEpcInput("");
                }
              }}
            />
            <Button
              type="button"
              disabled={!normalizedEpcInput}
              onClick={() => {
                if (!normalizedEpcInput) return;
                addEpcs([normalizedEpcInput]);
                setEpcInput("");
              }}
            >
              Adicionar leitura
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Textarea
              value={epcPaste}
              onChange={(event) => setEpcPaste(event.target.value)}
              placeholder="Cole vários EPCs (um por linha, ou separados por vírgula)"
              className="min-h-20 max-w-md font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const parsed = parseEpcList(epcPaste);
                addEpcs(parsed.valid);
                setEpcPaste("");
                if (parsed.invalid.length) {
                  toast({
                    title: `${parsed.invalid.length} EPC(s) inválido(s) ignorado(s)`,
                    variant: "destructive",
                  });
                }
              }}
            >
              Adicionar todos
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{readEpcs.length} EPC(s) lido(s) nesta sessão.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">3. Resultado</CardTitle>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              Limpar
            </Button>
            {permissions.iniciarConferencia && (
              <Button
                type="button"
                size="sm"
                disabled={readOnly || !readEpcs.length || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Salvar conferência
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label="Esperados" value={reconciliation.counts.expected} icon={ClipboardList} />
            <StatTile
              label="Encontrados"
              value={reconciliation.counts.found}
              icon={CheckCircle2}
              tone="text-emerald-600"
            />
            <StatTile label="Ausentes" value={reconciliation.counts.missing} icon={XCircle} tone="text-red-600" />
            <StatTile
              label="Inesperados"
              value={reconciliation.counts.unexpected}
              icon={AlertCircle}
              tone="text-amber-600"
            />
            <StatTile
              label="Desconhecidos"
              value={reconciliation.counts.unknown}
              icon={HelpCircle}
              tone="text-slate-500"
            />
          </div>

          {resolveQuery.isFetching && <p className="text-sm text-muted-foreground">Resolvendo EPCs…</p>}

          <Tabs defaultValue="found">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="found">✓ Encontrados ({reconciliation.counts.found})</TabsTrigger>
              <TabsTrigger value="missing">✗ Ausentes ({reconciliation.counts.missing})</TabsTrigger>
              <TabsTrigger value="unexpected">! Inesperados ({reconciliation.counts.unexpected})</TabsTrigger>
              <TabsTrigger value="unknown">? Desconhecidos ({reconciliation.counts.unknown})</TabsTrigger>
              <TabsTrigger value="inactiveTag">
                ⊘ Tag desativada ({reconciliation.counts.inactiveTag})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="found">
              <ResultList items={reconciliation.found} empty="Nenhum material encontrado ainda.">
                {(item) => (
                  <ResultRow
                    key={item.epc}
                    primary={materialById.get(item.materialId)?.nome ?? item.materialId}
                    secondary={item.epc}
                    badge="Encontrado"
                    badgeVariant="default"
                  />
                )}
              </ResultList>
            </TabsContent>
            <TabsContent value="missing">
              <ResultList items={reconciliation.missing} empty="Nada ausente - tudo que era esperado foi lido.">
                {(item) => (
                  <ResultRow
                    key={item.materialId}
                    primary={materialById.get(item.materialId)?.nome ?? item.materialId}
                    secondary={materialById.get(item.materialId)?.codigo_interno}
                    badge="Ausente"
                    badgeVariant="destructive"
                  />
                )}
              </ResultList>
            </TabsContent>
            <TabsContent value="unexpected">
              <ResultList items={reconciliation.unexpected} empty="Nenhum item inesperado.">
                {(item) => (
                  <ResultRow
                    key={item.epc}
                    primary={materialById.get(item.materialId)?.nome ?? item.materialId}
                    secondary={item.epc}
                    badge="Inesperado"
                    badgeVariant="secondary"
                  />
                )}
              </ResultList>
            </TabsContent>
            <TabsContent value="unknown">
              <ResultList items={reconciliation.unknown} empty="Nenhuma tag desconhecida.">
                {(item) => (
                  <ResultRow key={item.epc} primary={item.epc} badge="Tag desconhecida" badgeVariant="outline" />
                )}
              </ResultList>
            </TabsContent>
            <TabsContent value="inactiveTag">
              <ResultList items={reconciliation.inactiveTag} empty="Nenhuma tag desativada lida.">
                {(item) => (
                  <ResultRow
                    key={item.epc}
                    primary={item.materialId ? materialById.get(item.materialId)?.nome ?? item.materialId : item.epc}
                    secondary={item.epc}
                    badge={RECONCILIATION_BUCKET_LABELS.inactiveTag}
                    badgeVariant="outline"
                  />
                )}
              </ResultList>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${tone ?? "text-muted-foreground"}`} />
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function ResultList<T>({
  items,
  empty,
  children,
}: {
  items: T[];
  empty: string;
  children: (item: T) => ReactNode;
}) {
  if (!items.length) {
    return <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return <div className="space-y-1.5">{items.map(children)}</div>;
}

function ResultRow({
  primary,
  secondary,
  badge,
  badgeVariant,
}: {
  primary: string;
  secondary?: string;
  badge: string;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{primary}</p>
        {secondary && <code className="text-xs text-muted-foreground">{secondary}</code>}
      </div>
      <Badge variant={badgeVariant}>{badge}</Badge>
    </div>
  );
}
