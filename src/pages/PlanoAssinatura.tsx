import { useState, useMemo } from "react";
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
  Users, Calendar, HardDrive, Upload, FileCheck, Send, Sparkles, Shield, Gift, Clock,
  ShoppingCart, X, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { ModuleCatalogRow } from "@/types/subscription";

export default function PlanoAssinatura() {
  const { empresaId } = useAuth();
  const queryClient = useQueryClient();
  const sub = useSubscriptionSummary();
  const { catalog, activeModules, allModules } = useCompanyModules();

  const [showPix, setShowPix] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedPlanoId, setSelectedPlanoId] = useState<string | null>(null);
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<string>>(new Set());
  const [showBatchSummary, setShowBatchSummary] = useState(false);
  const [batchObservacao, setBatchObservacao] = useState("");
  const [generatingCharge, setGeneratingCharge] = useState(false);

  // Asaas charge data (for both plan payment and module batch)
  const [asaasData, setAsaasData] = useState<{
    pix_qr_code: string | null;
    pix_copy_paste: string | null;
    invoice_url: string | null;
  } | null>(null);
  const [asaasModuleData, setAsaasModuleData] = useState<{
    pix_qr_code: string | null;
    pix_copy_paste: string | null;
    invoice_url: string | null;
  } | null>(null);
  const [generatingModuleCharge, setGeneratingModuleCharge] = useState(false);
  const [showModulePix, setShowModulePix] = useState(false);

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

  // Fetch plans available for new subscriptions (excludes legacy plans)
  const { data: planos } = useQuery({
    queryKey: ["planos-ativos-upgrade"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos")
        .select("*")
        .eq("ativo", true)
        .eq("disponivel_novo_cadastro", true)
        .gt("valor", 0)
        .order("valor", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fetch PIX settings
  const { data: pixSettings } = useQuery({
    queryKey: ["pix-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("system_settings").select("key, value").in("key", ["pix_chave", "pix_nome_recebedor", "pix_cidade", "pix_banco"]);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      data.forEach((r: any) => { map[r.key] = r.value; });
      return map;
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

  // Fetch module requests (individual + batch)
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

  // Fetch module payments
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

  // Register payment — valor consolidado (plano base + módulos cobráveis)
  const paymentMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pagamentos").insert({
        empresa_id: empresaId!,
        plano_id: empresa?.plano_id,
        valor: sub.valorTotal,
        status: "pendente",
        metodo: "pix",
        descricao: `Assinatura Backstage Pro - ${empresa?.nome_empresa}`,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pagamentos"] }),
  });

  // Batch module request mutation
  const batchModuleMutation = useMutation({
    mutationFn: async () => {
      if (!empresaId || selectedModuleIds.size === 0) throw new Error("Selecione ao menos um módulo");
      const selectedMods = catalog.filter(c => selectedModuleIds.has(c.id));
      const total = selectedMods.reduce((sum, m) => sum + Number(m.valor), 0);

      const { data: batch, error: batchError } = await supabase
        .from("module_batch_requests")
        .insert({ empresa_id: empresaId, valor_total: total, observacao: batchObservacao || null })
        .select("id")
        .single();
      if (batchError) throw batchError;

      const items = selectedMods.map(m => ({ batch_request_id: batch.id, module_id: m.id, valor: Number(m.valor) }));
      const { error: itemsError } = await supabase.from("module_batch_request_items").insert(items);
      if (itemsError) throw itemsError;

      const moduleNames = selectedMods.map(m => m.nome).join(", ");
      await supabase.from("notificacoes_master").insert({
        empresa_id: empresaId,
        tipo: "solicitacao_modulos_lote",
        mensagem: `${empresa?.nome_empresa} solicitou ${selectedMods.length} módulo(s): ${moduleNames} — R$ ${total.toFixed(2)}`,
        dados: { batch_request_id: batch.id, module_count: selectedMods.length, valor_total: total },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["module-batch-requests"] });
      toast.success("Solicitação de módulos enviada! Aguarde aprovação.");
      setSelectedModuleIds(new Set());
      setBatchObservacao("");
      setShowBatchSummary(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handlePagar = () => {
    if (!pixSettings?.pix_chave) { toast.error("Chave PIX não configurada."); return; }
    if (!sub.planoBase) { toast.error("Nenhum plano associado."); return; }
    const payload = generatePixPayload({
      chave: pixSettings.pix_chave,
      nomeRecebedor: pixSettings.pix_nome_recebedor || "Backstage Pro",
      cidade: pixSettings.pix_cidade || "Maringa",
      valor: sub.valorTotal,
      descricao: `Assinatura - ${empresa?.nome_empresa?.substring(0, 15)}`,
    });
    setPixPayload(payload);
    setShowPix(true);
    paymentMutation.mutate();
  };

  const copyPix = () => { navigator.clipboard.writeText(pixPayload); toast.success("Código PIX copiado!"); };

  const statusColor = (s: string) => s === "pago" ? "default" : s === "pendente" ? "secondary" : "destructive";

  // Available modules (not already active, pending request, or in pending batch)
  const pendingRequestIds = new Set(moduleRequests.filter((r: any) => r.status === "pending").map((r: any) => r.module_id));
  const pendingBatchModuleIds = useMemo(() => {
    const ids = new Set<string>();
    batchRequests
      .filter((b: any) => b.status === "pending" || b.status === "paid")
      .forEach((b: any) => {
        (b.module_batch_request_items || []).forEach((item: any) => ids.add(item.module_id));
      });
    return ids;
  }, [batchRequests]);
  const activeModuleIds = new Set(allModules.filter(m => m.status !== "cancelled" && m.status !== "rejected").map(m => m.module_id));
  const availableModules = catalog.filter(c => !activeModuleIds.has(c.id) && !pendingRequestIds.has(c.id) && !pendingBatchModuleIds.has(c.id));

  const selectedModules = catalog.filter(c => selectedModuleIds.has(c.id));
  const totalSelectedValue = selectedModules.reduce((sum, m) => sum + Number(m.valor), 0);

  const toggleModuleSelect = (id: string) => {
    setSelectedModuleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
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
            Plano Base
          </CardTitle>
          {sub.isOnTrial && (
            <Badge variant="secondary" className="w-fit">
              <Clock className="h-3 w-3 mr-1" /> Período de Teste
            </Badge>
          )}
          {sub.isExpired && <Badge variant="destructive" className="w-fit">Expirado</Badge>}
        </CardHeader>
        <CardContent>
          {sub.planoBase ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Plano</p>
                    <p className="font-semibold text-lg">{sub.planoBase.nome}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {sub.planoBase.periodicidade === "vitalicio" ? "Valor Único" : sub.planoBase.periodicidade === "anual" ? "Valor Anual" : "Valor Mensal"}
                    </p>
                    <p className="font-semibold text-lg">
                      R$ {Number(sub.planoBase.valor).toFixed(2)}
                      {sub.planoBase.periodicidade !== "vitalicio" && <span className="text-sm font-normal text-muted-foreground">/{sub.planoBase.periodicidade === "anual" ? "ano" : "mês"}</span>}
                    </p>
                  </div>
                </div>
                {sub.vencimento && (
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Vencimento</p>
                      <p className="font-semibold">{format(new Date(sub.vencimento), "dd/MM/yyyy")}</p>
                    </div>
                  </div>
                )}
              </div>
              {sub.planoBase.descricao && <p className="text-sm text-muted-foreground">{sub.planoBase.descricao}</p>}

              {/* Limits */}
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
                <div className="flex items-center gap-1.5 text-sm">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Storage:</span>
                  <span className="font-medium">{sub.capabilities.storageLimitGb ?? "∞"} GB</span>
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
          {/* Breakdown */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Plano Base ({sub.planoBase?.nome || "—"})</span>
              <span className="font-medium">R$ {sub.valorBase.toFixed(2)}</span>
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
              <span className="font-semibold text-base">Total Mensal</span>
              <span className="font-bold text-xl text-primary">R$ {sub.valorTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 pt-1">
            <Button onClick={handlePagar} disabled={!sub.planoBase} size="lg">
              <QrCode className="h-4 w-4 mr-2" /> Pagar Mensalidade — R$ {sub.valorTotal.toFixed(2)}
            </Button>
            <Button variant="outline" onClick={() => setShowUpgrade(true)}>
              <ArrowUpCircle className="h-4 w-4 mr-2" /> Upgrade de Plano
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── MÓDULOS ATIVOS ─── */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> Módulos Ativos
        </h2>
        {activeModules.length === 0 ? (
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
                      {Number(mod.catalog.capacidade_extra_storage ?? 0) > 0 && <p>+{Number(mod.catalog.capacidade_extra_storage)} GB</p>}
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

      {/* ─── MÓDULOS DISPONÍVEIS (multi-select) ─── */}
      {availableModules.length > 0 && (
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
                        {Number(mod.capacidade_extra_storage) > 0 && <p>+{Number(mod.capacidade_extra_storage)} GB</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Summary bar when modules are selected */}
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
              <CreditCard className="h-5 w-5 text-primary" /> Detalhamento da Cobrança
            </CardTitle>
            <CardDescription>Veja quais itens compõem sua mensalidade</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span>Plano Base — {sub.planoBase?.nome || "—"}</span>
                <span>R$ {sub.valorBase.toFixed(2)}</span>
              </div>
              <Separator className="my-1" />
              {activeModules.map((mod) => {
                const isBillable = !mod.trial_granted && Number(mod.valor_cobrado) > 0;
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
                    <span className={!isBillable ? "text-muted-foreground line-through" : ""}>
                      R$ {Number(mod.valor_cobrado).toFixed(2)}
                    </span>
                  </div>
                );
              })}
              <Separator className="my-1" />
              <div className="flex justify-between font-semibold text-base pt-1">
                <span>Total Mensal</span>
                <span className="text-primary">R$ {sub.valorTotal.toFixed(2)}</span>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Apenas módulos com <CheckCircle className="h-3 w-3 inline text-green-500" /> entram na cobrança mensal.
              </p>
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

      {/* ─── PIX DIALOG ─── */}
      <Dialog open={showPix} onOpenChange={setShowPix}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> Pagamento via PIX</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="bg-white p-4 rounded-lg"><QRCodeSVG value={pixPayload} size={220} /></div>
            <Separator />
            <div className="w-full space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Código PIX Copia e Cola:</p>
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-muted p-3 rounded-md break-all max-h-20 overflow-auto">{pixPayload}</code>
                <Button variant="outline" size="icon" onClick={copyPix}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
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
                      <p className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {(plano as any).storage_limit ?? 5}GB</p>
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
              <p>• O vencimento seguirá o mesmo ciclo do plano base</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Observação (opcional)</label>
              <Textarea value={batchObservacao} onChange={(e) => setBatchObservacao(e.target.value)} placeholder="Algo para o administrador..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchSummary(false)}>Cancelar</Button>
            <Button onClick={() => batchModuleMutation.mutate()} disabled={batchModuleMutation.isPending}>
              <Send className="h-4 w-4 mr-1" /> Enviar Solicitação — R$ {totalSelectedValue.toFixed(2)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
