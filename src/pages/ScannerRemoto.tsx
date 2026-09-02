import { FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Camera, Loader2, ScanLine, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MaterialQrScanner } from "@/components/materials/MaterialQrScanner";
import { CheckinOriginDialog } from "@/components/checkin-checkout/CheckinOriginDialog";
import { FinalizeScannerSessionButton } from "@/components/checkin-checkout/FinalizeScannerSessionButton";
import { ScannerPendingReadCard } from "@/components/checkin-checkout/ScannerPendingReadCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useScannerRemoto } from "@/hooks/useScannerRemoto";
import { useModulePermission } from "@/hooks/useModulePermission";
import { useToast } from "@/hooks/use-toast";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getScannerRemotoPermissions } from "@/lib/scanner-remoto-permissions";
import {
  CUSTODY_CONDITION_LABELS,
  CUSTODY_PURPOSE_LABELS,
  SELECTABLE_CUSTODY_PURPOSES,
  materialMatchesCustodyIdentifier,
  normalizeCustodyScan,
  resolveCheckinOrigin,
} from "@/lib/checkin-checkout-domain";
import {
  listCustodyOperations,
  listCustodyResponsibles,
  searchCustodyMaterials,
} from "@/lib/checkin-checkout-service";
import { listStockLocations } from "@/lib/stock-service";
import { searchMaterialTraceability } from "@/lib/material-traceability-service";
import type {
  CustodyCondition,
  CustodyFilters,
  CustodyMaterialSearchResult,
  CustodyOperationView,
  CustodyPurpose,
} from "@/lib/checkin-checkout-types";
import type {
  TraceabilitySearchResult,
  TraceabilitySituacao,
} from "@/lib/material-traceability-types";
import {
  buildScannerReadDispatch,
  detectScannerRemotoOperation,
  isNeutralScannerSession,
  maxScannerRemotoCheckoutQuantity,
  pickTraceabilityMatch,
  type ScannerOperationContext,
  type ScannerPendingRead,
} from "@/lib/scanner-remoto-domain";
import {
  SCANNER_REMOTO_ACAO_LABELS,
  SCANNER_REMOTO_TIPO_OPERACAO_LABELS,
  type ScannerRemotoTipoOperacao,
} from "@/lib/scanner-remoto-types";

// listCustodyOperations' filters param mirrors CheckinCheckout.tsx's own
// INITIAL_FILTERS (page-local there, not exported) - only `search` is ever
// set here, the rest just need to satisfy the required shape.
const EMPTY_CUSTODY_FILTERS: CustodyFilters = {
  search: "",
  status: "todos",
  purpose: "todos",
  responsible: "",
  executorId: "",
  locationId: "",
  dateFrom: "",
  dateTo: "",
};

interface PendingQuantityScan {
  codigoLido: string;
  material: CustodyMaterialSearchResult;
  operacao: "checkout" | "checkin";
  maxQuantity: number;
  custodiaId: string | null;
}

const REALTIME_STATUS_LABEL: Record<string, string> = {
  connected: "Conectado",
  connecting: "Conectando",
  disconnected: "Desconectado",
};

// Mobile-first: this is the phone/PWA side of Scanner Remoto. It reuses the
// exact same MaterialQrScanner camera component and identifier-matching
// convention as the desktop's Check-in/Check-out (CheckinCheckout.tsx) -
// the only thing new here is the session wrapper and the fact that this
// terminal talks to registrar_leitura_scanner_remoto instead of calling
// registrar_checkout_material/registrar_checkin_material directly (that RPC
// resolves the material and delegates to those same two RPCs server-side).
export default function ScannerRemoto() {
  const { role, empresaId: companyId, empresaReadOnly, isMasterAdmin } = useAuth();
  const { hasModule, isLoading: loadingModules } = useCompanyModules(companyId);
  const moduleEnabled =
    hasModule(MODULE_KEYS.CHECKIN_CHECKOUT) &&
    hasModule(MODULE_KEYS.GESTAO_MATERIAIS) &&
    hasModule(MODULE_KEYS.CONTROLE_ESTOQUE);
  // Só o painel read-only (E4.5) usa Locações, e só quando finalidade='cliente':
  // igual à aba "Locações" do Check-in/Check-out, some quando o módulo não está
  // contratado, sem quebrar o resto do Scanner.
  const rentalModuleEnabled = moduleEnabled && hasModule(MODULE_KEYS.LOCACAO_MATERIAIS);
  const { permission: custodyGrant } = useModulePermission({
    companyId,
    featureKey: MODULE_KEYS.CHECKIN_CHECKOUT,
    role,
  });
  const permissions = getScannerRemotoPermissions({
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
  const { toast } = useToast();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [startingSession, setStartingSession] = useState(false);
  const [startingAutomatic, setStartingAutomatic] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [pendingScan, setPendingScan] = useState<PendingQuantityScan | null>(null);
  const [confirmQuantity, setConfirmQuantity] = useState(1);
  const [checkinChoice, setCheckinChoice] = useState<{
    codigoLido: string;
    material: CustodyMaterialSearchResult;
    options: CustodyOperationView[];
  } | null>(null);
  // E4 (sessão automática neutra): leitura pendente read-only - só no estado
  // do React, nunca no banco.
  const [pendingRead, setPendingRead] = useState<ScannerPendingRead | null>(null);
  const [pendingCustodyChoice, setPendingCustodyChoice] = useState<{
    code: string;
    material: TraceabilitySearchResult;
    resumo: TraceabilitySituacao;
    options: CustodyOperationView[];
  } | null>(null);
  const [form, setForm] = useState({
    tipoOperacao: "misto" as ScannerRemotoTipoOperacao,
    condicao: "bom" as CustodyCondition,
    responsibleId: "",
    purpose: "" as CustodyPurpose | "",
    originLocationId: "",
    destinationLocationId: "",
    eventId: "",
    titulo: "",
  });

  const { sessions, reads, realtimeStatus, startSession, registerRead, endSession } =
    useScannerRemoto({
      companyId,
      sessaoId: activeSessionId,
      enabled: permissions.visualizar,
    });

  const canStartSession = permissions.checkout || permissions.checkin;
  const locationsQuery = useQuery({
    queryKey: ["stock-locations", companyId],
    queryFn: () => listStockLocations(companyId!, true),
    enabled: Boolean(companyId) && canStartSession,
  });
  const responsiblesQuery = useQuery({
    queryKey: ["material-custody-responsibles", companyId],
    queryFn: () => listCustodyResponsibles(companyId!),
    enabled: Boolean(companyId) && permissions.checkout,
  });
  // Same query CheckoutDialog.tsx uses for its own purpose==='evento' Event
  // picker - only fetched while a session with finalidade evento is being
  // configured here.
  const eventsQuery = useQuery({
    queryKey: ["scanner-remoto-events", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date")
        .eq("empresa_id", companyId)
        .order("date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: form.purpose === "evento" && Boolean(companyId),
  });

  const locations = locationsQuery.data ?? [];
  // Same simplification CheckinCheckout.tsx's own quick picker uses -
  // funcionario-type responsibles aren't offered here yet, the RPC already
  // supports them for whenever that picker is added.
  const responsibles = (responsiblesQuery.data ?? []).filter((item) => item.tipo === "usuario");
  const events = eventsQuery.data ?? [];
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  // Defaults the editable field to "confirm everything" each time a new
  // scan needs confirmation - the common case for a load-in/load-out scan.
  useEffect(() => {
    if (pendingScan) setConfirmQuantity(pendingScan.maxQuantity);
  }, [pendingScan]);

  // E4: qualquer troca de sessão (nova, "Usar" outra, ou finalizar → null)
  // descarta a leitura pendente. Uma leitura pendente não confirmada nunca
  // gera movimentação nem registro.
  useEffect(() => {
    setPendingRead(null);
    setPendingCustodyChoice(null);
  }, [activeSessionId]);

  if (!companyId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Scanner Remoto</h1>
        <p className="text-muted-foreground">
          {isMasterAdmin
            ? "Sua conta master não está vinculada a uma empresa operacional."
            : "Nenhuma empresa vinculada à sua conta."}
        </p>
      </div>
    );
  }

  if (!loadingModules && !permissions.visualizar) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Scanner Remoto</h1>
        <Card className="border-amber-500/50">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Scanner Remoto usa o mesmo acesso do Check-in / Check-out (Gestão
            de Materiais e Controle de Estoque também precisam estar ativos).
          </CardContent>
        </Card>
      </div>
    );
  }

  // Caminho principal do Scanner Remoto: abre uma sessão automática ('misto')
  // sem contexto operacional. Origem, destino, responsável e finalidade
  // passam a ser resolvidos por leitura (etapa E4), não aqui - nenhum valor é
  // preenchido com default (nada de Barracão/origem/destino inventados). O
  // payload leva só tipoOperacao/condicao/clientUuid; o service converte todo
  // o resto em undefined e o Supabase omite essas chaves, então a RPC recebe
  // exatamente { _tipo_operacao, _condicao, _client_uuid, _empresa_id }.
  // iniciar_sessao_scanner_remoto aceita 'misto' neutro desde
  // 20260902090000_scanner_remoto_neutral_misto_session.sql.
  const handleStartAutomaticSession = async () => {
    if (!companyId || startingAutomatic) return;
    setStartingAutomatic(true);
    try {
      const session = await startSession({
        tipoOperacao: "misto",
        condicao: "bom",
        clientUuid: crypto.randomUUID(),
      });
      setActiveSessionId(session.id);
    } catch (error) {
      toast({
        title: "Não foi possível iniciar a sessão automática",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setStartingAutomatic(false);
    }
  };

  const handleStartSession = async (event: FormEvent) => {
    event.preventDefault();
    if (!companyId) return;
    const needsCheckoutFields = form.tipoOperacao === "checkout" || form.tipoOperacao === "misto";
    const needsCheckinFields = form.tipoOperacao === "checkin" || form.tipoOperacao === "misto";
    if (needsCheckoutFields && (!form.originLocationId || !form.responsibleId || !form.purpose)) {
      toast({ title: "Preencha origem, responsável e finalidade", variant: "destructive" });
      return;
    }
    if (needsCheckoutFields && form.purpose === "evento" && !form.eventId) {
      toast({ title: "Selecione o evento", variant: "destructive" });
      return;
    }
    if (needsCheckinFields && !form.destinationLocationId) {
      toast({ title: "Selecione a localização de destino", variant: "destructive" });
      return;
    }
    const responsible = responsibles.find((item) => item.id === form.responsibleId);
    setStartingSession(true);
    try {
      const session = await startSession({
        tipoOperacao: form.tipoOperacao,
        condicao: form.condicao,
        responsibleType: responsible?.tipo,
        responsibleId: responsible?.id,
        purpose: form.purpose || undefined,
        originLocationId: form.originLocationId || undefined,
        destinationLocationId: form.destinationLocationId || undefined,
        referenceType: form.purpose === "evento" ? "evento" : undefined,
        referenceId: form.purpose === "evento" ? form.eventId : undefined,
        titulo: form.titulo.trim() || undefined,
        clientUuid: crypto.randomUUID(),
      });
      setActiveSessionId(session.id);
    } catch (error) {
      toast({
        title: "Não foi possível iniciar a sessão",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setStartingSession(false);
    }
  };

  // Calls registrar_leitura_scanner_remoto exactly as before - quantidade/
  // custodiaId are only ever non-empty for a confirmed quantity-controlled
  // scan (see confirmPendingScan below); every other call site omits both,
  // so the RPC's own defaults (1 unit, oldest open custody) apply, byte for
  // byte the same as before this change.
  const performRead = async (codigoLido: string, quantidade?: number, custodiaId?: string) => {
    if (!activeSessionId) return;
    try {
      const read = await registerRead({
        sessaoId: activeSessionId,
        codigoLido,
        clientUuid: crypto.randomUUID(),
        quantidade,
        custodiaId,
      });
      const succeeded = read.acao_executada === "checkout" || read.acao_executada === "checkin";
      toast({
        title: read.resultado?.mensagem ?? (succeeded ? "Leitura registrada" : "Leitura não processada"),
        variant: succeeded ? "default" : "destructive",
      });
    } catch (error) {
      // Only session-level problems (encerrada, não encontrada, dados
      // ausentes) reject the call - a rejected/unmatched scan is a normal
      // result handled above, not an exception.
      toast({
        title: "Não foi possível registrar a leitura",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  // E4 - só sessão automática neutra: identifica o material e mostra a
  // situação/contexto atual, SEM movimentar. NÃO chama
  // registrar_leitura_scanner_remoto, NÃO grava scanner_remoto_leituras, NÃO
  // toca estoque nem material_custodias. searchMaterialTraceability é
  // read-only (RPC buscar_rastreabilidade_materiais) e já traz o resumo de
  // resumo_situacao_material. A confirmação e a gravação real são E5/E6.
  const identifyForPendingRead = async (normalized: string) => {
    if (!companyId) return;
    setScanning(true);
    setPendingCustodyChoice(null);
    try {
      let page: Awaited<ReturnType<typeof searchMaterialTraceability>>;
      try {
        page = await searchMaterialTraceability(companyId, normalized);
      } catch (error) {
        toast({
          title: "Não foi possível consultar o material",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
        return;
      }

      const material = pickTraceabilityMatch(page.items, normalized);
      if (!material) {
        setPendingRead(null);
        toast({ title: "Material não encontrado", variant: "destructive" });
        return;
      }

      const openCustodies = material.resumo.custodias_abertas;
      if (openCustodies.length <= 1) {
        // Individual ou material por quantidade com no máximo uma custódia
        // aberta: mostra a situação direto (não inventa unidade).
        setPendingRead({
          code: normalized,
          material,
          resumo: material.resumo,
          selectedCustody: openCustodies[0] ?? null,
          selectedOperation: null,
          operationContext: null,
        });
        return;
      }

      // 2+ custódias abertas (só material por quantidade): o operador escolhe
      // de qual custódia/lote está tratando - mesma máquina do check-in
      // (listCustodyOperations + resolveCheckinOrigin + CheckinOriginDialog).
      const opsPage = await listCustodyOperations({
        companyId,
        page: 1,
        pageSize: 100,
        filters: { ...EMPTY_CUSTODY_FILTERS, search: material.codigo_interno },
        onlyOpen: true,
      });
      const materialOps = opsPage.items.filter((op) => op.material_id === material.id);
      const resolution = resolveCheckinOrigin(materialOps);
      if (resolution.kind === "choose") {
        setPendingRead(null);
        setPendingCustodyChoice({
          code: normalized,
          material,
          resumo: material.resumo,
          options: resolution.options,
        });
        return;
      }
      const chosen =
        resolution.kind === "auto"
          ? openCustodies.find((item) => item.custodia_id === resolution.custody.id) ??
            openCustodies[0]
          : openCustodies[0];
      setPendingRead({
        code: normalized,
        material,
        resumo: material.resumo,
        selectedCustody: chosen ?? null,
        selectedOperation: null,
        operationContext: null,
      });
    } finally {
      setManualCode("");
      setScanning(false);
    }
  };

  const handleChoosePendingCustody = (operation: CustodyOperationView) => {
    if (!pendingCustodyChoice) return;
    const custody =
      pendingCustodyChoice.resumo.custodias_abertas.find(
        (item) => item.custodia_id === operation.id,
      ) ?? null;
    setPendingRead({
      code: pendingCustodyChoice.code,
      material: pendingCustodyChoice.material,
      resumo: pendingCustodyChoice.resumo,
      selectedCustody: custody,
      selectedOperation: null,
      operationContext: null,
    });
    setPendingCustodyChoice(null);
  };

  // E5 - confirmação final da sessão automática neutra: registra a
  // movimentação. registrar_leitura_scanner_remoto recebe o _contexto por
  // leitura (buildScannerReadDispatch) e delega para a RPC de movimentação
  // certa (check-in/out normal, evento, ou retirada/devolução de locação).
  // Sucesso (acao checkout/checkin) -> limpa o pendingRead. Erro (acao 'erro',
  // que NÃO rejeita a promise) -> propaga um Error para o card manter a
  // leitura pendente e mostrar a mensagem, permitindo retry com novo
  // client_uuid. Sessão configurada não passa por aqui (nunca manda contexto).
  const handleExecuteOperation = async (context: ScannerOperationContext) => {
    if (!activeSessionId || !pendingRead) return;
    const dispatch = buildScannerReadDispatch(context);
    const read = await registerRead({
      sessaoId: activeSessionId,
      codigoLido: pendingRead.code,
      clientUuid: crypto.randomUUID(),
      custodiaId: dispatch.custodiaId,
      contexto: dispatch.contexto,
    });
    const succeeded =
      read.acao_executada === "checkout" || read.acao_executada === "checkin";
    if (!succeeded) {
      throw new Error(
        read.resultado?.mensagem ?? "Não foi possível registrar a operação.",
      );
    }
    toast({ title: read.resultado?.mensagem ?? "Movimentação registrada" });
    setPendingRead(null);
  };

  // Identifies the material before registering anything (buscar_materiais_
  // custodia - pure lookup, same RPC the desktop search box uses). Individual
  // materials, and anything the lookup can't identify, go straight through
  // to performRead unchanged - registrar_leitura_scanner_remoto still does
  // its own authoritative identification either way, this pre-check only
  // decides whether to ask for a quantity first. Quantity-controlled
  // materials open a confirmation step instead of registering immediately.
  //
  // Sessão automática neutra (E3/E4) NÃO passa por aqui: cai no fluxo
  // read-only identifyForPendingRead acima, sem movimentar. Só sessões
  // 'checkout'/'checkin' ou 'misto' configurada seguem para performRead ->
  // registerRead -> registrar_leitura_scanner_remoto (fluxo inalterado).
  const submitScan = async (code: string) => {
    const normalized = normalizeCustodyScan(code);
    if (!normalized || !activeSessionId) return;

    if (activeSession && isNeutralScannerSession(activeSession)) {
      await identifyForPendingRead(normalized);
      return;
    }

    setScanning(true);
    try {
      let material: CustodyMaterialSearchResult | undefined;
      try {
        if (activeSession && companyId) {
          const results = await searchCustodyMaterials(companyId, normalized);
          material = results.find((item) => materialMatchesCustodyIdentifier(item, normalized)) ?? results[0];
        }
      } catch {
        material = undefined;
      }

      if (!material || !activeSession || !companyId || material.tipo_controle === "individual") {
        await performRead(normalized);
        return;
      }

      const operacao = detectScannerRemotoOperation(
        activeSession.tipo_operacao,
        material.custodias_abertas.length > 0,
      );

      if (operacao === "checkout") {
        const max = maxScannerRemotoCheckoutQuantity(material.saldos, activeSession.localizacao_origem_id);
        if (max <= 0) {
          toast({
            title: "Sem saldo disponível na localização de origem da sessão.",
            variant: "destructive",
          });
          return;
        }
        setPendingScan({ codigoLido: normalized, material, operacao, maxQuantity: max, custodiaId: null });
        return;
      }

      // Check-in: needs the richer CustodyOperationView shape (finalidade/
      // referência) to run resolveCheckinOrigin - same second lookup
      // CheckinCheckout.tsx's openCheckinFromSearch already does for the
      // desktop's own search-box check-in.
      const page = await listCustodyOperations({
        companyId,
        page: 1,
        pageSize: 100,
        filters: { ...EMPTY_CUSTODY_FILTERS, search: material.codigo_interno },
        onlyOpen: true,
      });
      const materialOperations = page.items.filter((item) => item.material_id === material!.id);
      const resolution = resolveCheckinOrigin(materialOperations);
      if (resolution.kind === "none") {
        toast({
          title: "A custódia aberta foi atualizada. Faça uma nova leitura.",
          variant: "destructive",
        });
        return;
      }
      if (resolution.kind === "choose") {
        setCheckinChoice({ codigoLido: normalized, material, options: resolution.options });
        return;
      }
      setPendingScan({
        codigoLido: normalized,
        material,
        operacao: "checkin",
        maxQuantity: resolution.custody.quantidade_pendente,
        custodiaId: resolution.custody.id,
      });
    } finally {
      setManualCode("");
      setScanning(false);
    }
  };

  const handleChooseCheckinOrigin = (custody: CustodyOperationView) => {
    if (!checkinChoice) return;
    setPendingScan({
      codigoLido: checkinChoice.codigoLido,
      material: checkinChoice.material,
      operacao: "checkin",
      maxQuantity: custody.quantidade_pendente,
      custodiaId: custody.id,
    });
    setCheckinChoice(null);
  };

  const confirmPendingScan = async () => {
    if (!pendingScan) return;
    setScanning(true);
    try {
      await performRead(pendingScan.codigoLido, confirmQuantity, pendingScan.custodiaId ?? undefined);
    } finally {
      setPendingScan(null);
      setScanning(false);
    }
  };

  const handleManualSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitScan(manualCode);
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Scanner Remoto</h1>
        <Badge variant={realtimeStatus === "connected" ? "outline" : "destructive"} className="gap-1">
          {realtimeStatus === "connected" ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          {REALTIME_STATUS_LABEL[realtimeStatus]}
        </Badge>
      </div>

      {!activeSession && (
        <>
          {sessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sessões abertas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {session.titulo || SCANNER_REMOTO_TIPO_OPERACAO_LABELS[session.tipo_operacao]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Aberta em {new Date(session.aberta_em).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setActiveSessionId(session.id)}>
                        Usar
                      </Button>
                      <FinalizeScannerSessionButton
                        session={session}
                        endSession={endSession}
                        onFinalized={(id) => {
                          if (activeSessionId === id) setActiveSessionId(null);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {canStartSession && (
            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle className="text-base">Nova sessão automática</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Comece a escanear na hora. Origem, destino, responsável e
                  finalidade são definidos a cada leitura — nada é preenchido agora.
                </p>
                <Button
                  type="button"
                  className="w-full"
                  disabled={startingAutomatic}
                  onClick={() => void handleStartAutomaticSession()}
                >
                  {startingAutomatic ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ScanLine className="mr-2 h-4 w-4" />
                  )}
                  Nova sessão automática
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nova sessão configurada</CardTitle>
            </CardHeader>
            <CardContent>
              {!canStartSession ? (
                <p className="text-sm text-muted-foreground">
                  Sua conta pode visualizar sessões, mas não tem permissão para
                  iniciar check-out nem check-in (mesma regra do Check-in/Check-out
                  no desktop).
                </p>
              ) : (
                <form className="space-y-3" onSubmit={handleStartSession}>
                  <div className="space-y-1.5">
                    <Label>Tipo de operação</Label>
                    <Select
                      value={form.tipoOperacao}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          tipoOperacao: value as ScannerRemotoTipoOperacao,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(SCANNER_REMOTO_TIPO_OPERACAO_LABELS) as ScannerRemotoTipoOperacao[]).map(
                          (key) => (
                            <SelectItem key={key} value={key}>
                              {SCANNER_REMOTO_TIPO_OPERACAO_LABELS[key]}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Condição padrão</Label>
                    <Select
                      value={form.condicao}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, condicao: value as CustodyCondition }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CUSTODY_CONDITION_LABELS) as CustodyCondition[]).map((key) => (
                          <SelectItem key={key} value={key}>
                            {CUSTODY_CONDITION_LABELS[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(form.tipoOperacao === "checkout" || form.tipoOperacao === "misto") && (
                    <>
                      <div className="space-y-1.5">
                        <Label>Localização de origem</Label>
                        <Select
                          value={form.originLocationId}
                          onValueChange={(value) =>
                            setForm((current) => ({ ...current, originLocationId: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map((location) => (
                              <SelectItem key={location.id} value={location.id}>
                                {location.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Responsável</Label>
                        <Select
                          value={form.responsibleId}
                          onValueChange={(value) =>
                            setForm((current) => ({ ...current, responsibleId: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {responsibles.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Finalidade</Label>
                        <Select
                          value={form.purpose}
                          onValueChange={(value) =>
                            setForm((current) => ({ ...current, purpose: value as CustodyPurpose }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {SELECTABLE_CUSTODY_PURPOSES.map((key) => (
                              <SelectItem key={key} value={key}>
                                {CUSTODY_PURPOSE_LABELS[key]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {form.purpose === "evento" && (
                        <div className="space-y-1.5">
                          <Label>Evento</Label>
                          <Select
                            value={form.eventId}
                            onValueChange={(value) =>
                              setForm((current) => ({ ...current, eventId: value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={eventsQuery.isLoading ? "Carregando eventos..." : "Selecione o evento"}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {events.map((eventOption) => (
                                <SelectItem key={eventOption.id} value={eventOption.id}>
                                  {eventOption.name} · {format(parseISO(eventOption.date), "dd/MM/yyyy")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </>
                  )}

                  {(form.tipoOperacao === "checkin" || form.tipoOperacao === "misto") && (
                    <div className="space-y-1.5">
                      <Label>Localização de destino</Label>
                      <Select
                        value={form.destinationLocationId}
                        onValueChange={(value) =>
                          setForm((current) => ({ ...current, destinationLocationId: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {locations.map((location) => (
                            <SelectItem key={location.id} value={location.id}>
                              {location.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Título (opcional)</Label>
                    <Input
                      value={form.titulo}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, titulo: event.target.value }))
                      }
                      placeholder="Ex.: Load-out show sexta"
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={startingSession}>
                    {startingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : "Iniciar sessão"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {activeSession && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {activeSession.titulo || SCANNER_REMOTO_TIPO_OPERACAO_LABELS[activeSession.tipo_operacao]}
              </CardTitle>
              <FinalizeScannerSessionButton
                session={activeSession}
                endSession={endSession}
                variant="outline"
                onFinalized={() => setActiveSessionId(null)}
              />
            </CardHeader>
            <CardContent className="space-y-3">
              <form className="flex gap-2" onSubmit={handleManualSubmit}>
                <Input
                  autoFocus
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="Digite ou cole o código"
                  disabled={scanning}
                />
                <Button type="submit" disabled={scanning || !manualCode.trim()}>
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ler"}
                </Button>
              </form>
              <Button type="button" variant="secondary" className="w-full" onClick={() => setCameraOpen(true)}>
                <Camera className="mr-2 h-4 w-4" /> Abrir câmera
              </Button>
            </CardContent>
          </Card>

          {pendingRead && companyId && (
            <ScannerPendingReadCard
              pendingRead={pendingRead}
              companyId={companyId}
              locations={locations}
              responsibles={responsibles}
              rentalModuleEnabled={rentalModuleEnabled}
              canCheckout={permissions.checkout}
              canCheckin={permissions.checkin}
              onChooseOperation={(operation) =>
                setPendingRead((current) =>
                  current
                    ? { ...current, selectedOperation: operation, operationContext: null }
                    : current,
                )
              }
              onCancelOperation={() =>
                setPendingRead((current) =>
                  current
                    ? { ...current, selectedOperation: null, operationContext: null }
                    : current,
                )
              }
              onOperationReady={(context) =>
                setPendingRead((current) =>
                  current ? { ...current, operationContext: context } : current,
                )
              }
              onEditOperation={() =>
                setPendingRead((current) =>
                  current ? { ...current, operationContext: null } : current,
                )
              }
              onExecuteOperation={handleExecuteOperation}
              onClear={() => setPendingRead(null)}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leituras desta sessão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reads.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma leitura ainda.</p>
              )}
              {reads.map((read) => (
                <div
                  key={read.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{read.material_nome ?? read.codigo_lido}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(read.created_at).toLocaleTimeString("pt-BR")}
                      {read.resultado?.mensagem ? ` · ${read.resultado.mensagem}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant={
                      read.acao_executada === "checkout" || read.acao_executada === "checkin"
                        ? "outline"
                        : "destructive"
                    }
                  >
                    {SCANNER_REMOTO_ACAO_LABELS[read.acao_executada]}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <MaterialQrScanner
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onDetected={(code) => void submitScan(code)}
      />

      {companyId && (
        <CheckinOriginDialog
          open={!!checkinChoice}
          onOpenChange={(open) => !open && setCheckinChoice(null)}
          companyId={companyId}
          options={checkinChoice?.options ?? []}
          onSelect={handleChooseCheckinOrigin}
        />
      )}

      {companyId && (
        <CheckinOriginDialog
          open={!!pendingCustodyChoice}
          onOpenChange={(open) => !open && setPendingCustodyChoice(null)}
          companyId={companyId}
          options={pendingCustodyChoice?.options ?? []}
          onSelect={handleChoosePendingCustody}
        />
      )}

      <Dialog open={!!pendingScan} onOpenChange={(open) => !open && setPendingScan(null)}>
        <DialogContent>
          {pendingScan && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Confirmar {pendingScan.operacao === "checkout" ? "check-out" : "check-in"}
                </DialogTitle>
                <DialogDescription>
                  {pendingScan.material.nome} · {pendingScan.material.codigo_interno}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label>Quantidade (máximo {pendingScan.maxQuantity})</Label>
                <Input
                  type="number"
                  min={1}
                  max={pendingScan.maxQuantity}
                  value={confirmQuantity}
                  onChange={(event) => setConfirmQuantity(Number(event.target.value))}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPendingScan(null)}>
                  Cancelar
                </Button>
                <Button
                  disabled={
                    scanning ||
                    !Number.isInteger(confirmQuantity) ||
                    confirmQuantity < 1 ||
                    confirmQuantity > pendingScan.maxQuantity
                  }
                  onClick={() => void confirmPendingScan()}
                >
                  {scanning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirmar {pendingScan.operacao === "checkout" ? "check-out" : "check-in"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
