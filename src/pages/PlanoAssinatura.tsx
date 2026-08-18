import { useState, useMemo, useRef } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  CreditCard, QrCode, Copy, ArrowUpCircle, History, CheckCircle, Package,
  Users, Calendar, Upload, FileCheck, Send, Sparkles, Shield, Gift, Clock,
  ShoppingCart, X,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { ModuleCatalogRow } from "@/types/subscription";
import { generatePixPayload } from "@/lib/pix";
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

export default function PlanoAssinatura() {
  const { empresaId } = useAuth();
  const queryClient = useQueryClient();
  const sub = useSubscriptionSummary();
  const { catalog, activeModules, allModules, moduleDependencies } = useCompanyModules();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showPix, setShowPix] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedPlanoId, setSelectedPlanoId] = useState<string | null>(null);
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<string>>(new Set());
  const [showBatchSummary, setShowBatchSummary] = useState(false);
  const [batchObservacao, setBatchObservacao] = useState("");
  const [showModulePix, setShowModulePix] = useState(false);
  const [submittingBatch, setSubmittingBatch] = useState(false);

  // Fetch PIX settings
  const { data: pixSettings } = useQuery({
    queryKey: ["pix-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value")
        .like("key", "pix_%");
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value || ""; });
      return map;
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

  // PIX payload for plan payment
  const planPixPayload = useMemo(() => {
    if (!pixSettings || !sub.planoBase) return null;
    try {
      return generatePixPayload({
        chave: pixSettings.pix_chave || "",
        nomeRecebedor: pixSettings.pix_nome_recebedor || "",
        cidade: pixSettings.pix_cidade || "",
        valor: sub.valorTotal,
      });
    } catch { return null; }
  }, [pixSettings, sub.planoBase, sub.valorTotal]);

  // PIX payload for module batch
  const totalSelectedValue = useMemo(() => {
    return catalog.filter(c => selectedModuleIds.has(c.id)).reduce((sum, m) => sum + Number(m.valor), 0);
  }, [catalog, selectedModuleIds]);

  const modulePixPayload = useMemo(() => {
    if (!pixSettings || totalSelectedValue <= 0) return null;
    try {
      return generatePixPayload({
        chave: pixSettings.pix_chave || "",
        nomeRecebedor: pixSettings.pix_nome_recebedor || "",
        cidade: pixSettings.pix_cidade || "",
        valor: totalSelectedValue,
      });
    } catch { return null; }
  }, [pixSettings, totalSelectedValue]);

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

  const handlePagar = () => setShowPix(true);

  const copyPix = (payload: string | null) => {
    if (payload) {
      navigator.clipboard.writeText(payload);
      toast.success("Código PIX copiado!");
    }
  };

  // Upload comprovante for plan payment
  const handleUploadPlanComprovante = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast.error("Arquivo muito grande (máx 5MB)"); return; }

      try {
        const { data: pagamento, error: pagErr } = await supabase
          .from("pagamentos")
          .insert({
            empresa_id: empresaId!,
            plano_id: empresa?.plano_id || null,
            valor: sub.valorTotal,
            status: "pendente",
            metodo: "pix",
            descricao: `Mensalidade ${sub.planoBase?.nome || ""} - ${empresa?.nome_empresa || ""}`,
          })
          .select("id")
          .single();
        if (pagErr) throw pagErr;

        const ext = file.name.split(".").pop();
        const path = `${empresaId}/${pagamento.id}-comprovante.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("comprovantes").upload(path, file, { upsert: true });
        if (uploadErr) throw uploadErr;

        await supabase.from("pagamentos").update({ comprovante_path: path } as any).eq("id", pagamento.id);

        await supabase.from("notificacoes_master").insert({
          empresa_id: empresaId!,
          tipo: "comprovante_pagamento",
          mensagem: `${empresa?.nome_empresa} enviou comprovante de mensalidade — R$ ${sub.valorTotal.toFixed(2)}`,
          dados: { pagamento_id: pagamento.id },
        });

        queryClient.invalidateQueries({ queryKey: ["pagamentos"] });
        setShowPix(false);
        toast.success("Comprovante enviado! Aguarde aprovação.");
      } catch (err: any) {
        toast.error(`Erro: ${err.message}`);
      }
    };
    input.click();
  };

  const statusColor = (s: string) => s === "pago" ? "default" : s === "pendente" ? "secondary" : "destructive";

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
                  <Button onClick={handlePagar} disabled={!sub.planoBase} size="lg">
                    <QrCode className="h-4 w-4 mr-2" /> Pagar Mensalidade — R$ {sub.valorTotal.toFixed(2)}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setShowUpgrade(true)}>
                  <ArrowUpCircle className="h-4 w-4 mr-2" /> Upgrade de Plano
                </Button>
              </>
            )}
          </div>
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
                      {(mod as any).trial_granted && (
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
                    <Button onClick={() => { setBatchObservacao(""); setShowBatchSummary(true); }}>
                      <Send className="h-4 w-4 mr-1" /> Solicitar módulos
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setSelectedModuleIds(new Set())}>
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
            {pagamentos && pagamentos.length > 0 ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Comprovante</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagamentos.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>{format(new Date(p.created_at), "dd/MM/yyyy", { locale: ptBR })}</TableCell>
                        <TableCell>R$ {Number(p.valor).toFixed(2)}</TableCell>
                        <TableCell className="uppercase text-xs">{p.metodo}</TableCell>
                        <TableCell><Badge variant={statusColor(p.status) as any}>{p.status}</Badge></TableCell>
                        <TableCell>
                          {p.comprovante_path ? (
                            <Badge variant="outline" className="gap-1"><FileCheck className="h-3 w-3" /> Enviado</Badge>
                          ) : p.status === "pendente" ? (
                            <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.accept = "image/*,.pdf";
                              input.onchange = async (e) => {
                                const file = (e.target as HTMLInputElement).files?.[0];
                                if (!file) return;
                                const path = `${empresaId}/${p.id}-${file.name}`;
                                const { error: uploadError } = await supabase.storage.from("comprovantes").upload(path, file, { upsert: true });
                                if (uploadError) { toast.error("Erro ao enviar comprovante"); return; }
                                await supabase.from("pagamentos").update({ comprovante_path: path } as any).eq("id", p.id);
                                await supabase.from("notificacoes_master").insert({
                                  empresa_id: empresaId!,
                                  tipo: "comprovante_pagamento",
                                  mensagem: `${empresa?.nome_empresa} enviou comprovante - R$${Number(p.valor).toFixed(2)}`,
                                  dados: { comprovante_path: path },
                                } as any);
                                queryClient.invalidateQueries({ queryKey: ["pagamentos"] });
                                toast.success("Comprovante enviado!");
                              };
                              input.click();
                            }}>
                              <Upload className="h-3 w-3 mr-1" /> Enviar
                            </Button>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-6">Nenhum pagamento registrado.</p>
            )}
          </TabsContent>

          <TabsContent value="solicitacoes">
            {moduleRequests.length > 0 ? (
              <div className="space-y-2">
                {moduleRequests.map((req: any) => (
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
            {modulePayments.length > 0 ? (
              <div className="space-y-2">
                {modulePayments.map((pay: any) => (
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
            ) : <p className="text-muted-foreground text-center py-6">Nenhum pagamento de módulo.</p>}
          </TabsContent>
        </Tabs>
      </div>

      {/* ─── PIX DIALOG (Manual) ─── */}
      <Dialog open={showPix} onOpenChange={setShowPix}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> Pagamento via PIX</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              Valor: <strong className="text-foreground">R$ {sub.valorTotal.toFixed(2)}</strong>
            </p>
            {planPixPayload && (
              <>
                <div className="bg-white p-4 rounded-lg">
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(planPixPayload)}`} alt="QR Code PIX" className="w-[220px] h-[220px]" />
                </div>
                <Separator />
                <div className="w-full space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Código PIX Copia e Cola:</p>
                  <div className="flex gap-2">
                    <code className="flex-1 text-xs bg-muted p-3 rounded-md break-all max-h-20 overflow-auto">{planPixPayload}</code>
                    <Button variant="outline" size="icon" onClick={() => copyPix(planPixPayload)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </div>
              </>
            )}
            {pixSettings && (
              <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1 w-full">
                <p className="font-medium text-foreground">Dados do recebedor:</p>
                <p><strong>Nome:</strong> {pixSettings.pix_nome_recebedor}</p>
                <p><strong>Chave ({pixSettings.pix_tipo_chave}):</strong> {pixSettings.pix_chave}</p>
                <p><strong>Banco:</strong> {pixSettings.pix_banco}</p>
              </div>
            )}
            <Separator />
            <Button className="w-full" onClick={handleUploadPlanComprovante}>
              <Upload className="h-4 w-4 mr-2" /> Enviar Comprovante
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Após enviar, o administrador aprovará manualmente e seu acesso será liberado.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── UPGRADE DIALOG ─── */}
      <Dialog open={showUpgrade} onOpenChange={setShowUpgrade}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>Selecionar Plano</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 py-4">
              {planos?.map((plano) => {
                const periodicidade = (plano as any).periodicidade || "mensal";
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

      {/* ─── BATCH MODULE REQUEST DIALOG ─── */}
      <Dialog open={showBatchSummary} onOpenChange={setShowBatchSummary}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" /> Resumo da Solicitação
            </DialogTitle>
            <DialogDescription>Revise os módulos selecionados antes de enviar</DialogDescription>
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
                <span>Total</span>
                <span className="text-lg text-primary">R$ {totalSelectedValue.toFixed(2)}</span>
              </div>
            </div>
            <div className="bg-muted/50 p-3 rounded-md text-xs text-muted-foreground space-y-1">
              <p>• Os módulos serão ativados após aprovação do administrador</p>
              <p>• Dependências obrigatórias ausentes são incluídas automaticamente</p>
              <p>• O vencimento seguirá o mesmo ciclo do plano base</p>
              <p>• Pagamento via PIX com envio de comprovante</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Observação (opcional)</label>
              <Textarea value={batchObservacao} onChange={(e) => setBatchObservacao(e.target.value)} placeholder="Algo para o administrador..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchSummary(false)}>Cancelar</Button>
            <Button onClick={async () => {
              setSubmittingBatch(true);
              try {
                const selectedMods = catalog.filter(c => selectedModuleIds.has(c.id));
                const total = selectedMods.reduce((sum, m) => sum + Number(m.valor), 0);

                const { data, error } = await supabase.rpc(
                  "request_company_module_batch",
                  {
                    _module_ids: selectedMods.map((module) => module.id),
                    _observacao: batchObservacao || null,
                  },
                );
                if (error) throw error;
                const batch = data as { id: string };

                const moduleNames = selectedMods.map(m => m.nome).join(", ");
                await supabase.from("notificacoes_master").insert({
                  empresa_id: empresaId!,
                  tipo: "solicitacao_modulos_lote",
                  mensagem: `${empresa?.nome_empresa} solicitou ${selectedMods.length} módulo(s): ${moduleNames} — R$ ${total.toFixed(2)}`,
                  dados: { batch_request_id: batch.id, module_count: selectedMods.length, valor_total: total },
                });

                queryClient.invalidateQueries({ queryKey: ["module-batch-requests"] });
                setShowBatchSummary(false);
                setShowModulePix(true);
                setSelectedModuleIds(new Set());
                setBatchObservacao("");
                toast.success("Solicitação enviada! Veja os dados de pagamento.");
              } catch (err: any) {
                toast.error(err.message);
              } finally {
                setSubmittingBatch(false);
              }
            }} disabled={submittingBatch}>
              {submittingBatch ? "Enviando..." : (
                <><Send className="h-4 w-4 mr-1" /> Solicitar — R$ {totalSelectedValue.toFixed(2)}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODULE PIX DIALOG (Manual) ─── */}
      <Dialog open={showModulePix} onOpenChange={setShowModulePix}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> PIX — Módulos Adicionais</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              Valor total: <strong className="text-foreground">R$ {totalSelectedValue.toFixed(2)}</strong>
            </p>
            {modulePixPayload && (
              <>
                <div className="bg-white p-4 rounded-lg">
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(modulePixPayload)}`} alt="QR Code PIX" className="w-[220px] h-[220px]" />
                </div>
                <Separator />
                <div className="w-full space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Código PIX Copia e Cola:</p>
                  <div className="flex gap-2">
                    <code className="flex-1 text-xs bg-muted p-3 rounded-md break-all max-h-20 overflow-auto">{modulePixPayload}</code>
                    <Button variant="outline" size="icon" onClick={() => copyPix(modulePixPayload)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </div>
              </>
            )}
            {pixSettings && (
              <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1 w-full">
                <p className="font-medium text-foreground">Dados do recebedor:</p>
                <p><strong>Nome:</strong> {pixSettings.pix_nome_recebedor}</p>
                <p><strong>Chave ({pixSettings.pix_tipo_chave}):</strong> {pixSettings.pix_chave}</p>
              </div>
            )}
            <Separator />
            <p className="text-xs text-muted-foreground text-center">
              Após o pagamento, envie o comprovante na aba "Solicitações" ou aguarde a aprovação do administrador.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
