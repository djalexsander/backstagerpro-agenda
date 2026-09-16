import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptionSummary } from "@/hooks/useSubscriptionSummary";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CreditCard, QrCode, Copy, ArrowUpCircle, History, CheckCircle, Package,
  Users, Calendar, Send, Sparkles, Shield, Gift, Clock,
  ShoppingCart, X, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { ModuleCatalogRow } from "@/types/subscription";
import type { Tables } from "@/integrations/supabase/types";
import {
  getSelfServiceAvailableModules,
  getLifetimeLicensedCatalogModules,
  getSelfServiceModulesInProgress,
} from "@/lib/self-service-module-availability";
import {
  ensureSingleCommercialBasePlan,
  getCustomerPlanPresentation,
} from "@/lib/subscription-license";
import { expandModuleSelectionWithDependencies } from "@/lib/company-module-entitlements";

type AsaasPayment = Tables<"asaas_payments">;
type ChargeKind = "renewal" | "modules";

type AsaasCharge = {
  paymentId: string;
  amount: number;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
  invoiceUrl: string | null;
  renewalCompetence: string | null;
  moduleIds: string[];
};

const openPaymentStatuses = new Set(["pending", "confirmed", "received", "overdue"]);

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseAsaasCharge(value: unknown): AsaasCharge {
  if (!value || typeof value !== "object") throw new Error("Resposta inválida do Asaas.");
  const data = value as Record<string, unknown>;
  if (optionalString(data.error)) throw new Error(data.error as string);
  const amount = Number(data.amount);
  if (data.success !== true || !optionalString(data.payment_id) ||
      !optionalString(data.asaas_payment_id) || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Resposta inválida do Asaas.");
  }
  return {
    paymentId: data.payment_id as string,
    amount,
    pixQrCode: optionalString(data.pix_qr_code),
    pixCopyPaste: optionalString(data.pix_copy_paste),
    invoiceUrl: optionalString(data.invoice_url),
    renewalCompetence: optionalString(data.renewal_competence),
    moduleIds: Array.isArray(data.module_ids)
      ? data.module_ids.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function chargeFromPayment(payment: AsaasPayment): AsaasCharge | null {
  if (!payment.asaas_payment_id || !Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0) return null;
  const metadata = payment.metadata && typeof payment.metadata === "object" && !Array.isArray(payment.metadata)
    ? payment.metadata as Record<string, unknown>
    : {};
  return {
    paymentId: payment.id,
    amount: Number(payment.amount),
    pixQrCode: optionalString(payment.pix_qr_code),
    pixCopyPaste: optionalString(payment.pix_copy_paste),
    invoiceUrl: optionalString(payment.invoice_url),
    renewalCompetence: optionalString(metadata.renewal_competence),
    moduleIds: moduleIdsFromPayment(payment),
  };
}

function moduleIdsFromPayment(payment: AsaasPayment): string[] {
  const metadata = payment.metadata && typeof payment.metadata === "object" && !Array.isArray(payment.metadata)
    ? payment.metadata as Record<string, unknown>
    : {};
  return Array.isArray(metadata.module_ids)
    ? metadata.module_ids.filter((id): id is string => typeof id === "string")
    : payment.related_module_id ? [payment.related_module_id] : [];
}

function findOpenCharge(payments: AsaasPayment[], kind: ChargeKind, moduleIds: string[]): AsaasPayment | undefined {
  const selectedKey = [...moduleIds].sort().join(",");
  return payments.find((payment) => {
    if (payment.payment_type !== kind || !openPaymentStatuses.has(payment.status) ||
        payment.activation_status === "completed") return false;
    if (kind === "renewal") return true;
    const storedIds = moduleIdsFromPayment(payment);
    return storedIds.length > 0 && [...storedIds].sort().join(",") === selectedKey;
  });
}

async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === "object") {
    const context = (error as { context?: { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> } }).context;
    try {
      const body = await (context?.clone?.() ?? context)?.json?.();
      if (body && typeof body === "object") {
        const message = optionalString((body as Record<string, unknown>).error);
        if (message) return message;
      }
    } catch { /* Use the client message below. */ }
    const message = optionalString((error as { message?: unknown }).message);
    if (message) return message;
  }
  return "Não foi possível preparar a cobrança PIX.";
}

function AsaasPixDetails({ charge, error, payment, onCopy, onRefresh }: {
  charge: AsaasCharge | null;
  error: string | null;
  payment: AsaasPayment | undefined;
  onCopy: (payload: string | null) => void;
  onRefresh: () => void;
}) {
  const pixReady = !!charge?.pixQrCode && !!charge.pixCopyPaste;
  const qrSource = charge?.pixQrCode
    ? charge.pixQrCode.startsWith("data:")
      ? charge.pixQrCode
      : `data:image/png;base64,${charge.pixQrCode}`
    : null;

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {error && <p role="alert" className="text-sm text-destructive text-center">{error}</p>}
      {charge && (
        <>
          <p className="text-sm text-muted-foreground">
            Valor Asaas: <strong className="text-foreground">R$ {charge.amount.toFixed(2)}</strong>
          </p>
          {charge.renewalCompetence && <p className="text-sm">Competência: {charge.renewalCompetence}</p>}
          {pixReady && (
            <>
              <div className="bg-white p-4 rounded-lg">
                <img src={qrSource!} alt="QR Code PIX do Asaas" className="w-[220px] h-[220px]" />
              </div>
              <div className="w-full space-y-2">
                <p className="text-sm font-medium text-muted-foreground">PIX copia e cola:</p>
                <div className="flex gap-2">
                  <code className="flex-1 text-xs bg-muted p-3 rounded-md break-all max-h-20 overflow-auto">{charge.pixCopyPaste}</code>
                  <Button variant="outline" size="icon" aria-label="Copiar PIX" onClick={() => onCopy(charge.pixCopyPaste)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
          {charge.invoiceUrl && (
            <a href={charge.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline inline-flex items-center gap-1">
              Abrir cobrança no Asaas <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <p className="text-xs text-muted-foreground text-center">
            {payment?.activation_status === "completed"
              ? "Pagamento confirmado pelo Asaas. A liberação foi realizada pelo servidor."
              : "Aguardando confirmação do Asaas. A liberação será feita automaticamente pelo servidor."}
          </p>
          <Button variant="outline" onClick={onRefresh}>Atualizar status</Button>
        </>
      )}
    </div>
  );
}

export default function PlanoAssinatura() {
  const { empresaId, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const sub = useSubscriptionSummary();
  const { catalog, activeModules, allModules, moduleDependencies } = useCompanyModules();
  const chargeRequestInFlightRef = useRef(false);
  const refreshedPaymentsRef = useRef<Set<string>>(new Set());

  const [showPix, setShowPix] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedPlanoId, setSelectedPlanoId] = useState<string | null>(null);
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<string>>(new Set());
  const [showBatchSummary, setShowBatchSummary] = useState(false);
  const [showModulePix, setShowModulePix] = useState(false);
  const [preparingCharge, setPreparingCharge] = useState<ChargeKind | null>(null);
  const [planCharge, setPlanCharge] = useState<AsaasCharge | null>(null);
  const [moduleCharge, setModuleCharge] = useState<AsaasCharge | null>(null);
  const [planChargeError, setPlanChargeError] = useState<string | null>(null);
  const [moduleChargeError, setModuleChargeError] = useState<string | null>(null);

  const { data: asaasPayments = [], refetch: refetchAsaasPayments } = useQuery({
    queryKey: ["asaas-payments", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("asaas_payments")
        .select("*").eq("empresa_id", empresaId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as AsaasPayment[];
    },
    enabled: !!empresaId,
    refetchInterval: (query) => {
      const payments = query.state.data as AsaasPayment[] | undefined;
      const awaitingConfirmation = [planCharge, moduleCharge].some((charge) => {
        if (!charge) return false;
        const payment = payments?.find((row) => row.id === charge.paymentId);
        return !payment || (openPaymentStatuses.has(payment.status) && payment.activation_status !== "completed");
      });
      return showPix || showModulePix || awaitingConfirmation ? 5000 : false;
    },
  });

  // Fetch empresa
  const { data: empresa } = useQuery({
    queryKey: ["empresa-plano", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("*").eq("id", empresaId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Fetch plans available for new subscriptions
  const { data: planos } = useQuery({
    queryKey: ["planos-ativos-upgrade"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos")
        .select("*")
        .eq("ativo", true)
        .eq("categoria", "plano_base")
        .eq("disponivel_novo_cadastro", true)
        .gt("valor", 0)
        .in("periodicidade", ["mensal", "anual"])
        .order("valor", { ascending: true });
      if (error) throw error;
      return ensureSingleCommercialBasePlan(data || []);
    },
  });

  // Fetch payment history
  const { data: pagamentos } = useQuery({
    queryKey: ["pagamentos", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("pagamentos").select("*").eq("empresa_id", empresaId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Fetch module requests
  const { data: moduleRequests = [] } = useQuery({
    queryKey: ["module-requests", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("module_requests").select("*, module_catalog(*)").eq("empresa_id", empresaId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: batchRequests = [] } = useQuery({
    queryKey: ["module-batch-requests", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("module_batch_requests")
        .select("*, module_batch_request_items(*, module_catalog(*))")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: modulePayments = [] } = useQuery({
    queryKey: ["module-payments", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("module_payments").select("*, module_catalog(*)").eq("empresa_id", empresaId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // This is only an on-screen estimate; the RPC prices the batch again.
  const totalSelectedValue = useMemo(() => {
    return catalog.filter(c => selectedModuleIds.has(c.id)).reduce((sum, m) => sum + Number(m.valor), 0);
  }, [catalog, selectedModuleIds]);

  // Upgrade plan mutation
  const upgradeMutation = useMutation({
    mutationFn: async (planoId: string) => {
      const selectedPlano = planos?.find((p) => p.id === planoId);
      await supabase.from("notificacoes_master").insert({
        empresa_id: empresaId!,
        tipo: "upgrade_plano",
        mensagem: `${empresa?.nome_empresa} solicitou upgrade para o plano ${selectedPlano?.nome || ""}`,
        dados: { plano_solicitado: selectedPlano?.nome, plano_id_solicitado: planoId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresa-plano"] });
      setShowUpgrade(false);
      setShowConfirm(false);
      setSelectedPlanoId(null);
      toast.success("Solicitação de upgrade enviada! Aguarde aprovação.");
    },
    onError: () => toast.error("Erro ao solicitar upgrade."),
  });

  const refreshBillingState = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["asaas-payments", empresaId] }),
      queryClient.invalidateQueries({ queryKey: ["empresa-plano", empresaId] }),
      queryClient.invalidateQueries({ queryKey: ["subscription-empresa", empresaId] }),
      queryClient.invalidateQueries({ queryKey: ["subscription-plano-base"] }),
      queryClient.invalidateQueries({ queryKey: ["empresa-modules", empresaId] }),
      queryClient.invalidateQueries({ queryKey: ["module-batch-requests", empresaId] }),
    ]);
  }, [queryClient, empresaId]);

  useEffect(() => {
    for (const charge of [planCharge, moduleCharge]) {
      if (!charge || refreshedPaymentsRef.current.has(charge.paymentId)) continue;
      const payment = asaasPayments.find((row) => row.id === charge.paymentId);
      if (payment?.activation_status !== "completed") continue;
      refreshedPaymentsRef.current.add(charge.paymentId);
      void refreshBillingState();
      void refreshProfile();
      toast.success("Pagamento confirmado pelo Asaas. Assinatura atualizada.");
    }
  }, [asaasPayments, planCharge, moduleCharge, refreshBillingState, refreshProfile]);

  const showPreparedCharge = (kind: ChargeKind, charge: AsaasCharge) => {
    const missingPix = !charge.pixQrCode || !charge.pixCopyPaste;
    const message = missingPix
      ? "A cobrança existe, mas o Asaas não retornou QR Code e código copia e cola completos. Nenhum PIX alternativo foi gerado."
      : null;
    if (kind === "renewal") {
      setPlanCharge(charge);
      setPlanChargeError(message);
      setShowPix(true);
    } else {
      setModuleCharge(charge);
      setModuleChargeError(message);
      setShowBatchSummary(false);
      setShowModulePix(true);
    }
  };

  const reopenStoredCharge = (kind: ChargeKind, payment: AsaasPayment) => {
    const charge = chargeFromPayment(payment);
    if (!charge) {
      toast.error("A cobrança Asaas ainda está sendo preparada. Atualize o status em alguns instantes.");
      return;
    }
    showPreparedCharge(kind, charge);
  };

  const prepareCharge = async (kind: ChargeKind) => {
    if (chargeRequestInFlightRef.current || !empresaId) return;
    if (kind === "renewal" && planCharge) {
      const current = asaasPayments.find((payment) => payment.id === planCharge.paymentId);
      if (!current || (openPaymentStatuses.has(current.status) && current.activation_status !== "completed")) {
        showPreparedCharge(kind, planCharge);
        return;
      }
    }
    const moduleIds = kind === "modules" ? [...selectedModuleIds] : [];
    if (kind === "modules" && moduleIds.length === 0) return;

    chargeRequestInFlightRef.current = true;
    setPreparingCharge(kind);
    if (kind === "renewal") setPlanChargeError(null);
    else setModuleChargeError(null);

    try {
      if (kind === "modules") {
        const current = await refetchAsaasPayments();
        if (current.error) throw current.error;
        const existing = findOpenCharge(current.data ?? [], kind, moduleIds);
        if (existing) {
          const savedCharge = chargeFromPayment(existing);
          if (savedCharge) {
            showPreparedCharge(kind, savedCharge);
            setSelectedModuleIds(new Set());
          }
          else throw new Error("Uma cobrança Asaas já está sendo preparada. Aguarde e atualize o status antes de tentar novamente.");
          return;
        }
      }

      const body = kind === "renewal"
        ? { tipo_cobranca: "renewal" }
        : { modulo_ids: moduleIds };
      const { data, error } = await supabase.functions.invoke("create-asaas-charge", { body });
      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      const charge = parseAsaasCharge(data);
      showPreparedCharge(kind, { ...charge, moduleIds: kind === "modules" ? moduleIds : [] });
      if (kind === "modules") setSelectedModuleIds(new Set());
      void refreshBillingState();
    } catch (error) {
      // A concurrent request may have reserved the same charge before this one.
      const message = error instanceof Error ? error.message : "Não foi possível preparar a cobrança PIX.";
      const mayBeDuplicate = kind === "modules" || /active renewal charge already exists/i.test(message);
      const current = mayBeDuplicate ? await refetchAsaasPayments() : null;
      const existing = findOpenCharge(current?.data ?? [], kind, moduleIds);
      const savedCharge = existing && chargeFromPayment(existing);
      if (savedCharge) {
        showPreparedCharge(kind, savedCharge);
        if (kind === "modules") setSelectedModuleIds(new Set());
      } else {
        if (kind === "renewal") setPlanChargeError(message);
        else setModuleChargeError(message);
        toast.error(message);
      }
    } finally {
      chargeRequestInFlightRef.current = false;
      setPreparingCharge(null);
    }
  };

  const copyPix = async (payload: string | null) => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      toast.success("Código PIX copiado!");
    } catch {
      toast.error("Não foi possível copiar o código PIX.");
    }
  };

  const statusColor = (s: string): "default" | "secondary" | "destructive" =>
    s === "pago" ? "default" : s === "pendente" ? "secondary" : "destructive";

  // A provisioned empresa_modules row is only a placeholder. The canonical
  // entitlement states (active/pending) and in-flight commercial records are
  // what make a catalog module unavailable for another purchase.
  const availableModules = useMemo(() => getSelfServiceAvailableModules({
    companyId: empresaId,
    catalog,
    companyModules: allModules,
    moduleRequests,
    batchRequests,
    modulePayments,
  }), [empresaId, catalog, allModules, moduleRequests, batchRequests, modulePayments]);

  const modulesInProgress = useMemo(() => getSelfServiceModulesInProgress({
    companyId: empresaId,
    catalog,
    companyModules: allModules,
    moduleRequests,
    batchRequests,
    modulePayments,
  }), [empresaId, catalog, allModules, moduleRequests, batchRequests, modulePayments]);

  const lifetimeLicensedModules = useMemo(
    () => getLifetimeLicensedCatalogModules(catalog),
    [catalog],
  );

  const planPresentation = useMemo(() => getCustomerPlanPresentation({
    plan: sub.planoBase,
    isOnTrial: sub.isOnTrial,
    isLifetime: sub.isLifetime,
    isExpired: sub.isExpired,
    isReadOnly: sub.isReadOnly,
    trialExpiresAt: sub.trialExpiresAt,
  }), [sub.planoBase, sub.isOnTrial, sub.isLifetime, sub.isExpired, sub.isReadOnly, sub.trialExpiresAt]);

  const selectedModules = catalog.filter(c => selectedModuleIds.has(c.id));

  const toggleModuleSelect = (id: string) => {
    setSelectedModuleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return expandModuleSelectionWithDependencies({
        selectedModuleIds: next,
        moduleDependencies,
        activeModuleIds: activeModules.map((module) => module.module_id),
      });
    });
  };

  if (sub.isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Assinatura e Módulos</h1>

      {/* ─── PLANO BASE ─── */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5 text-primary" />
            Plano Atual
          </CardTitle>
          {sub.isOnTrial && (
            <Badge variant="secondary" className="w-fit">
              <Clock className="h-3 w-3 mr-1" /> Período de Teste
            </Badge>
          )}
          {sub.isLifetime && (
            <Badge className="w-fit bg-primary/15 text-primary border border-primary/30">
              <Sparkles className="h-3 w-3 mr-1" /> Licença Vitalícia
            </Badge>
          )}
          <Badge
            variant={planPresentation.status === "Ativo" ? "default" : planPresentation.status === "Expirado" || planPresentation.status === "Bloqueado" ? "destructive" : "secondary"}
            className="w-fit"
          >
            Status: {planPresentation.status}
          </Badge>
        </CardHeader>
        <CardContent>
          {sub.planoBase || sub.isOnTrial ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Plano atual</p>
                    <p className="font-semibold text-lg">{planPresentation.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Tipo</p>
                    <p className="font-semibold text-lg">{planPresentation.type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Cobrança do plano</p>
                    <p className="font-semibold text-lg">{planPresentation.chargeLabel}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {sub.isOnTrial ? "Fim do Trial" : "Vencimento"}
                    </p>
                    <p className="font-semibold">
                      {sub.isLifetime
                        ? "Sem vencimento"
                        : sub.isOnTrial && sub.trialExpiresAt
                          ? format(new Date(sub.trialExpiresAt), "dd/MM/yyyy")
                          : sub.vencimento
                            ? format(new Date(sub.vencimento), "dd/MM/yyyy")
                            : "Não informado"}
                    </p>
                  </div>
                </div>
              </div>
              {sub.planoBase?.descricao && <p className="text-sm text-muted-foreground">{sub.planoBase.descricao}</p>}
              <div className="flex flex-wrap gap-4 pt-2">
                <div className="flex items-center gap-1.5 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Eventos:</span>
                  <span className="font-medium">{sub.capabilities.maxEventos ?? "∞"}</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Usuários:</span>
                  <span className="font-medium">{sub.capabilities.maxUsuarios ?? "∞"}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Nenhum plano associado. Selecione um plano abaixo.</p>
          )}
        </CardContent>
      </Card>

      {/* ─── RESUMO DA MENSALIDADE + AÇÃO ─── */}
      <Card className="border-primary/30 bg-primary/[0.03] shadow-sm">
        <CardContent className="pt-5 pb-5 space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Plano ({planPresentation.name})</span>
              <span className="font-medium">
                {sub.isLifetime ? "Sem cobrança mensal" : sub.isOnTrial ? "Sem cobrança" : `R$ ${sub.valorBase.toFixed(2)}`}
              </span>
            </div>
            {sub.valorModulos > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Módulos Ativos ({activeModules.filter(m => !m.trial_granted && Number(m.valor_cobrado) > 0).length})
                </span>
                <span className="font-medium">R$ {sub.valorModulos.toFixed(2)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between items-baseline">
              <span className="font-semibold text-base">
                {sub.isLifetime ? "Licença permanente" : sub.isOnTrial ? "Período de teste" : "Total Mensal"}
              </span>
              <span className="font-bold text-xl text-primary">
                {sub.isLifetime ? "Sem cobrança mensal" : sub.isOnTrial ? "Sem cobrança" : `R$ ${sub.valorTotal.toFixed(2)}`}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            {sub.isLifetime ? (
              <Badge className="bg-primary/15 text-primary border border-primary/30 px-3 py-2">
                <Shield className="h-4 w-4 mr-2" />
                Licença permanente, sem mensalidade do plano
              </Badge>
            ) : (
              <>
                {!sub.isOnTrial && (
                  <Button onClick={() => void prepareCharge("renewal")} disabled={!sub.planoBase || !!preparingCharge} size="lg">
                    <QrCode className="h-4 w-4 mr-2" /> {preparingCharge === "renewal" ? "Preparando cobrança..." : "Pagar Mensalidade"}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setShowUpgrade(true)}>
                  <ArrowUpCircle className="h-4 w-4 mr-2" /> Upgrade de Plano
                </Button>
              </>
            )}
          </div>
          {planChargeError && !showPix && <p role="alert" className="text-sm text-destructive">{planChargeError}</p>}
        </CardContent>
      </Card>

      {/* ─── MÓDULOS ATIVOS ─── */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> Módulos Ativos
        </h2>
        {sub.isLifetime ? (
          lifetimeLicensedModules.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground">
                Nenhum módulo funcional ativo no catálogo.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {lifetimeLicensedModules.map((mod) => (
                <Card key={mod.id} className="border-accent/30">
                  <CardContent className="pt-4 pb-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium flex items-center gap-1.5">
                        <CheckCircle className="h-4 w-4 text-accent" />
                        {mod.nome}
                      </p>
                      <Badge variant="outline" className="text-xs">Incluído</Badge>
                    </div>
                    {mod.descricao && <p className="text-sm text-muted-foreground">{mod.descricao}</p>}
                    <p className="text-sm font-medium text-primary">Sem cobrança mensal</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        ) : activeModules.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              Nenhum módulo ativo no momento. Explore os módulos disponíveis abaixo.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeModules.map((mod) => (
              <Card key={mod.id} className="border-accent/30">
                <CardContent className="pt-4 pb-4 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <p className="font-medium flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4 text-accent" />
                      {mod.catalog?.nome || "Módulo"}
                    </p>
                    <div className="flex gap-1">
                      {mod.trial_granted && (
                        <Badge variant="secondary" className="text-xs gap-1"><Clock className="h-3 w-3" /> Trial</Badge>
                      )}
                      {mod.granted_by_admin && Number(mod.valor_cobrado) === 0 && (
                        <Badge variant="outline" className="text-xs gap-1"><Gift className="h-3 w-3" /> Cortesia</Badge>
                      )}
                      {mod.granted_by_admin && Number(mod.valor_cobrado) > 0 && (
                        <Badge variant="outline" className="text-xs">Admin</Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    R$ {Number(mod.valor_cobrado).toFixed(2)}/{mod.catalog?.periodicidade || "mês"}
                  </p>
                  {mod.catalog?.is_capacity_module && (
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {(mod.catalog.capacidade_extra_usuarios ?? 0) > 0 && <p>+{mod.catalog.capacidade_extra_usuarios} usuários</p>}
                      {(mod.catalog.capacidade_extra_eventos ?? 0) > 0 && <p>+{mod.catalog.capacidade_extra_eventos} eventos</p>}
                    </div>
                  )}
                  {mod.activated_at && (
                    <p className="text-xs text-muted-foreground">Desde {new Date(mod.activated_at).toLocaleDateString("pt-BR")}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ─── SOLICITAÇÕES EM ANDAMENTO ─── */}
      {modulesInProgress.length > 0 && !sub.isLifetime && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" /> Solicitações em andamento
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modulesInProgress.map(({ module, status }) => {
              const statusLabel = status === "activation_pending"
                ? "Aguardando ativação"
                : status === "payment_confirmed"
                  ? "Pagamento confirmado"
                  : status === "payment_pending"
                    ? "Pagamento pendente"
                    : "Solicitação pendente";
              return (
                <Card key={module.id} className="border-primary/20">
                  <CardContent className="pt-4 pb-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{module.nome}</p>
                      <Badge variant="secondary">{statusLabel}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      R$ {Number(module.valor).toFixed(2)}/{module.periodicidade}
                    </p>
                    {module.is_capacity_module && (
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {module.capacidade_extra_usuarios > 0 && <p>+{module.capacidade_extra_usuarios} usuários</p>}
                        {module.capacidade_extra_eventos > 0 && <p>+{module.capacidade_extra_eventos} eventos</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── MÓDULOS DISPONÍVEIS ─── */}
      {!sub.isLifetime && availableModules.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" /> Módulos Disponíveis
          </h2>
          <p className="text-sm text-muted-foreground">Selecione os módulos desejados e solicite todos de uma vez.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {availableModules.map((mod) => {
              const isSelected = selectedModuleIds.has(mod.id);
              return (
                <Card
                  key={mod.id}
                  className={`cursor-pointer transition-all ${isSelected ? "ring-2 ring-primary border-primary/50 shadow-md" : "hover:shadow-md"}`}
                  onClick={() => toggleModuleSelect(mod.id)}
                >
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleModuleSelect(mod.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <p className="font-medium">{mod.nome}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{mod.is_capacity_module ? "Capacidade" : "Funcionalidade"}</Badge>
                    </div>
                    {mod.descricao && <p className="text-sm text-muted-foreground">{mod.descricao}</p>}
                    <p className="text-lg font-semibold">
                      R$ {Number(mod.valor).toFixed(2)}
                      <span className="text-xs text-muted-foreground font-normal">/{mod.periodicidade}</span>
                    </p>
                    {mod.is_capacity_module && (
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {mod.capacidade_extra_usuarios > 0 && <p>+{mod.capacidade_extra_usuarios} usuários</p>}
                        {mod.capacidade_extra_eventos > 0 && <p>+{mod.capacidade_extra_eventos} eventos</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {selectedModuleIds.size > 0 && (
            <Card className="border-primary/30 bg-primary/[0.03]">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <ShoppingCart className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-semibold text-sm">
                        {selectedModuleIds.size} módulo{selectedModuleIds.size > 1 ? "s" : ""} selecionado{selectedModuleIds.size > 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">{selectedModules.map(m => m.nome).join(", ")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-bold text-lg text-primary">R$ {totalSelectedValue.toFixed(2)}</p>
                    <Button onClick={() => setShowBatchSummary(true)} disabled={!!preparingCharge}>
                      <Send className="h-4 w-4 mr-1" /> Comprar módulos
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setSelectedModuleIds(new Set())} disabled={!!preparingCharge}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ─── DETALHAMENTO FINANCEIRO ─── */}
      {activeModules.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" /> {sub.isLifetime ? "Detalhamento da Licença" : "Detalhamento da Cobrança"}
            </CardTitle>
            <CardDescription>
              {sub.isLifetime ? "Módulos registrados sem cobrança recorrente" : "Veja quais itens compõem sua mensalidade"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span>Plano Base — {sub.planoBase?.nome || "—"}</span>
                <span>{sub.isLifetime ? "Sem cobrança mensal" : `R$ ${sub.valorBase.toFixed(2)}`}</span>
              </div>
              <Separator className="my-1" />
              {activeModules.map((mod) => {
                const isBillable = !sub.isLifetime && !mod.trial_granted && Number(mod.valor_cobrado) > 0;
                return (
                  <div key={mod.id} className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      {isBillable ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      ) : (
                        <Gift className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      {mod.catalog?.nome || "Módulo"}
                      {mod.trial_granted && <Badge variant="secondary" className="text-[10px] px-1 py-0">Trial</Badge>}
                      {!mod.trial_granted && Number(mod.valor_cobrado) === 0 && mod.granted_by_admin && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">Cortesia</Badge>
                      )}
                    </span>
                    <span className={!isBillable ? "text-muted-foreground" : ""}>
                      {sub.isLifetime ? "Incluído" : `R$ ${Number(mod.valor_cobrado).toFixed(2)}`}
                    </span>
                  </div>
                );
              })}
              <Separator className="my-1" />
              <div className="flex justify-between font-semibold text-base pt-1">
                <span>{sub.isLifetime ? "Licença Vitalícia" : "Total Mensal"}</span>
                <span className="text-primary">{sub.isLifetime ? "Sem cobrança mensal" : `R$ ${sub.valorTotal.toFixed(2)}`}</span>
              </div>
              {!sub.isLifetime && (
                <p className="text-xs text-muted-foreground pt-1">
                  Apenas módulos com <CheckCircle className="h-3 w-3 inline text-green-500" /> entram na cobrança mensal.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── HISTÓRICO ─── */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <History className="h-5 w-5 text-primary" /> Histórico
        </h2>
        <Tabs defaultValue="pagamentos">
          <TabsList>
            <TabsTrigger value="pagamentos">Pagamentos Plano</TabsTrigger>
            <TabsTrigger value="solicitacoes">Solicitações Módulos</TabsTrigger>
            <TabsTrigger value="pgto-modulos">Pagamentos Módulos</TabsTrigger>
          </TabsList>

          <TabsContent value="pagamentos">
            {asaasPayments.filter((payment) => payment.payment_type === "renewal" || payment.payment_type === "base_plan").map((payment) => (
              <Card key={payment.id} className="mb-2">
                <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">Cobrança Asaas — R$ {Number(payment.amount).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{new Date(payment.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                  <Badge variant={payment.activation_status === "completed" ? "default" : "secondary"}>
                    {payment.activation_status === "completed" ? "Confirmado" : payment.status}
                  </Badge>
                  {payment.payment_type === "renewal" && openPaymentStatuses.has(payment.status) && payment.activation_status !== "completed" && (
                    <Button variant="outline" size="sm" onClick={() => reopenStoredCharge("renewal", payment)}>Ver PIX</Button>
                  )}
                  {payment.invoice_url && <a href={payment.invoice_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Fatura</a>}
                </CardContent>
              </Card>
            ))}
            {pagamentos && pagamentos.length > 0 ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagamentos.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{format(new Date(p.created_at), "dd/MM/yyyy", { locale: ptBR })}</TableCell>
                        <TableCell>R$ {Number(p.valor).toFixed(2)}</TableCell>
                        <TableCell className="uppercase text-xs">{p.metodo}</TableCell>
                        <TableCell><Badge variant={statusColor(p.status)}>{p.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              asaasPayments.some((payment) => payment.payment_type === "renewal" || payment.payment_type === "base_plan")
                ? null
                : <p className="text-muted-foreground text-center py-6">Nenhum pagamento registrado.</p>
            )}
          </TabsContent>

          <TabsContent value="solicitacoes">
            {moduleRequests.length > 0 ? (
              <div className="space-y-2">
                {moduleRequests.map((req) => (
                  <Card key={req.id}>
                    <CardContent className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-sm">{req.module_catalog?.nome || "Módulo"}</p>
                        <p className="text-xs text-muted-foreground">{new Date(req.requested_at).toLocaleDateString("pt-BR")}</p>
                      </div>
                      <Badge variant={req.status === "approved" ? "default" : req.status === "rejected" ? "destructive" : "secondary"}>
                        {req.status === "pending" ? "Pendente" : req.status === "approved" ? "Aprovado" : req.status === "rejected" ? "Rejeitado" : req.status}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : <p className="text-muted-foreground text-center py-6">Nenhuma solicitação.</p>}
          </TabsContent>

          <TabsContent value="pgto-modulos">
            {asaasPayments.filter((payment) => payment.payment_type === "modules").map((payment) => (
              <Card key={payment.id} className="mb-2">
                <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">Lote Asaas — R$ {Number(payment.amount).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{new Date(payment.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                  <Badge variant={payment.activation_status === "completed" ? "default" : "secondary"}>
                    {payment.activation_status === "completed" ? "Confirmado" : payment.status}
                  </Badge>
                  {openPaymentStatuses.has(payment.status) && payment.activation_status !== "completed" && (
                    <Button variant="outline" size="sm" onClick={() => reopenStoredCharge("modules", payment)}>Ver PIX</Button>
                  )}
                  {payment.invoice_url && <a href={payment.invoice_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Fatura</a>}
                </CardContent>
              </Card>
            ))}
            {modulePayments.length > 0 ? (
              <div className="space-y-2">
                {modulePayments.map((pay) => (
                  <Card key={pay.id}>
                    <CardContent className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-sm">{pay.module_catalog?.nome || "Módulo"}</p>
                        <p className="text-xs text-muted-foreground">R$ {Number(pay.amount).toFixed(2)} • {new Date(pay.created_at).toLocaleDateString("pt-BR")}</p>
                      </div>
                      <Badge variant={pay.status === "approved" ? "default" : pay.status === "rejected" ? "destructive" : "secondary"}>
                        {pay.status === "pending" ? "Pendente" : pay.status === "approved" ? "Aprovado" : pay.status === "rejected" ? "Rejeitado" : pay.status}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : asaasPayments.some((payment) => payment.payment_type === "modules")
              ? null
              : <p className="text-muted-foreground text-center py-6">Nenhum pagamento de módulo.</p>}
          </TabsContent>
        </Tabs>
      </div>

      {/* ─── ASAAS RENEWAL PIX ─── */}
      <Dialog open={showPix} onOpenChange={setShowPix}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> Renovação via Asaas</DialogTitle>
          </DialogHeader>
          <AsaasPixDetails
            charge={planCharge}
            error={planChargeError}
            payment={asaasPayments.find((payment) => payment.id === planCharge?.paymentId)}
            onCopy={(payload) => void copyPix(payload)}
            onRefresh={() => void refetchAsaasPayments()}
          />
        </DialogContent>
      </Dialog>

      {/* ─── UPGRADE DIALOG ─── */}
      <Dialog open={showUpgrade} onOpenChange={setShowUpgrade}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>Selecionar Plano</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 py-4">
              {planos?.map((plano) => {
                const periodicidade = plano.periodicidade || "mensal";
                const sufixo = periodicidade === "vitalicio" ? "" : periodicidade === "anual" ? "/ano" : "/mês";
                return (
                  <Card
                    key={plano.id}
                    className={`cursor-pointer transition-all hover:shadow-md ${selectedPlanoId === plano.id ? "ring-2 ring-primary" : ""} ${empresa?.plano_id === plano.id ? "opacity-60" : ""}`}
                    onClick={() => setSelectedPlanoId(plano.id)}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{plano.nome}</CardTitle>
                      <CardDescription>R$ {Number(plano.valor).toFixed(2)}{sufixo}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                      <p className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {plano.max_eventos ?? "∞"} eventos</p>
                      <p className="flex items-center gap-1"><Users className="h-3 w-3" /> {plano.max_usuarios ?? "∞"} usuários</p>
                      {empresa?.plano_id === plano.id && <Badge variant="secondary" className="mt-2">Plano Atual</Badge>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button disabled={!selectedPlanoId || selectedPlanoId === empresa?.plano_id} onClick={() => setShowConfirm(true)}>
              <CheckCircle className="h-4 w-4 mr-2" /> Confirmar Plano
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── UPGRADE CONFIRM ─── */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Upgrade?</AlertDialogTitle>
            <AlertDialogDescription>
              Alterar para <strong>{planos?.find(p => p.id === selectedPlanoId)?.nome}</strong>? O administrador será notificado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={upgradeMutation.isPending} onClick={() => selectedPlanoId && upgradeMutation.mutate(selectedPlanoId)}>
              {upgradeMutation.isPending ? "Enviando..." : "Sim, confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── ASAAS MODULE BATCH SUMMARY ─── */}
      <Dialog open={showBatchSummary} onOpenChange={setShowBatchSummary}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" /> Resumo dos módulos
            </DialogTitle>
            <DialogDescription>Revise os módulos antes de gerar uma única cobrança PIX Asaas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              {selectedModules.map(mod => (
                <div key={mod.id} className="flex justify-between items-center text-sm">
                  <span className="font-medium">{mod.nome}</span>
                  <span>R$ {Number(mod.valor).toFixed(2)}/{mod.periodicidade}</span>
                </div>
              ))}
              <Separator />
              <div className="flex justify-between items-baseline font-bold">
                <span>Estimativa</span>
                <span className="text-lg text-primary">R$ {totalSelectedValue.toFixed(2)}</span>
              </div>
            </div>
            <div className="bg-muted/50 p-3 rounded-md text-xs text-muted-foreground space-y-1">
              <p>• O valor final será calculado pelo servidor e exibido na cobrança Asaas</p>
              <p>• Dependências obrigatórias ausentes são incluídas automaticamente</p>
              <p>• O vencimento seguirá o mesmo ciclo do plano base</p>
              <p>• A ativação ocorrerá após confirmação do Asaas pelo servidor</p>
            </div>
            {moduleChargeError && <p role="alert" className="text-sm text-destructive">{moduleChargeError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchSummary(false)} disabled={!!preparingCharge}>Cancelar</Button>
            <Button onClick={() => void prepareCharge("modules")} disabled={!!preparingCharge || selectedModuleIds.size === 0}>
              <Send className="h-4 w-4 mr-1" /> {preparingCharge === "modules" ? "Preparando cobrança..." : "Gerar cobrança PIX"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── ASAAS MODULE PIX ─── */}
      <Dialog open={showModulePix} onOpenChange={setShowModulePix}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> PIX Asaas — Módulos Adicionais</DialogTitle>
          </DialogHeader>
          <AsaasPixDetails
            charge={moduleCharge}
            error={moduleChargeError}
            payment={asaasPayments.find((payment) => payment.id === moduleCharge?.paymentId)}
            onCopy={(payload) => void copyPix(payload)}
            onRefresh={() => void refetchAsaasPayments()}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
