/**
 * Página do admin da empresa para ver módulos disponíveis,
 * selecionar múltiplos e solicitar em lote com pagamento consolidado.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Package, CheckCircle, Clock, Send, Star, Zap, HardDrive,
  ShoppingCart, Upload, QrCode, Copy, X,
} from "lucide-react";
import type { ModuleCatalogRow } from "@/types/subscription";
import { MODULE_CATEGORIES, getCategoryLabel, getBadgeInfo } from "@/constants/module-categories";
import { toast as sonnerToast } from "sonner";

export default function ModulosDisponiveis() {
  const { empresaId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { catalog, activeModules, allModules, isLoading } = useCompanyModules();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSummary, setShowSummary] = useState(false);
  const [showPix, setShowPix] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [asaasChargeData, setAsaasChargeData] = useState<{
    pix_qr_code: string | null;
    pix_copy_paste: string | null;
    invoice_url: string | null;
  } | null>(null);
  const [batchTotalForPix, setBatchTotalForPix] = useState(0);

  // Fetch existing requests, payments, and batch requests
  const { data: requests = [] } = useQuery({
    queryKey: ["module-requests", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("module_requests")
        .select("*, module_catalog(*)")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });
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

  const { data: payments = [] } = useQuery({
    queryKey: ["module-payments", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("module_payments")
        .select("*, module_catalog(*)")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Fetch empresa data
  const { data: empresa } = useQuery({
    queryKey: ["empresa-plano", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("*").eq("id", empresaId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Build sets for status checks
  const activeFeatureKeys = new Set(activeModules.map((m) => m.catalog?.feature_key));
  const pendingRequestModuleIds = new Set(
    requests.filter((r: any) => r.status === "pending").map((r: any) => r.module_id)
  );
  const pendingBatchModuleIds = useMemo(() => {
    const ids = new Set<string>();
    batchRequests
      .filter((b: any) => b.status === "pending" || b.status === "paid")
      .forEach((b: any) => {
        (b.module_batch_request_items || []).forEach((item: any) => ids.add(item.module_id));
      });
    return ids;
  }, [batchRequests]);
  const allModuleIds = new Set(
    allModules.filter(m => m.status !== "cancelled" && m.status !== "rejected").map(m => m.module_id)
  );

  // Determine module status for each catalog item
  const getModuleStatus = (mod: ModuleCatalogRow): "active" | "pending" | "available" => {
    if (activeFeatureKeys.has(mod.feature_key) || allModuleIds.has(mod.id)) return "active";
    if (pendingRequestModuleIds.has(mod.id) || pendingBatchModuleIds.has(mod.id)) return "pending";
    return "available";
  };

  const availableModules = catalog.filter((c) => getModuleStatus(c) === "available");

  // Group by category
  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, ModuleCatalogRow[]>();
    for (const mod of catalog) {
      const cat = (mod as any).categoria || "operacional";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(mod);
    }
    const ordered: { category: string; label: string; modules: ModuleCatalogRow[] }[] = [];
    for (const c of MODULE_CATEGORIES) {
      const mods = groups.get(c.value);
      if (mods && mods.length > 0) ordered.push({ category: c.value, label: c.label, modules: mods });
    }
    for (const [key, mods] of groups) {
      if (!MODULE_CATEGORIES.some((c) => c.value === key)) {
        ordered.push({ category: key, label: getCategoryLabel(key), modules: mods });
      }
    }
    return ordered;
  }, [catalog]);

  const selectedModules = catalog.filter(c => selectedIds.has(c.id));
  const totalSelected = selectedModules.reduce((sum, m) => sum + Number(m.valor), 0);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Batch request mutation
  const batchMutation = useMutation({
    mutationFn: async () => {
      if (!empresaId || selectedModules.length === 0) throw new Error("Selecione ao menos um módulo");

      // Create batch request
      const { data: batch, error: batchError } = await supabase
        .from("module_batch_requests")
        .insert({
          empresa_id: empresaId,
          valor_total: totalSelected,
          observacao: observacao || null,
        })
        .select("id")
        .single();
      if (batchError) throw batchError;

      // Create batch items
      const items = selectedModules.map(m => ({
        batch_request_id: batch.id,
        module_id: m.id,
        valor: Number(m.valor),
      }));
      const { error: itemsError } = await supabase
        .from("module_batch_request_items")
        .insert(items);
      if (itemsError) throw itemsError;

      // Notify master
      const moduleNames = selectedModules.map(m => m.nome).join(", ");
      await supabase.from("notificacoes_master").insert({
        empresa_id: empresaId,
        tipo: "solicitacao_modulos_lote",
        mensagem: `${empresa?.nome_empresa} solicitou ${selectedModules.length} módulo(s): ${moduleNames} — R$ ${totalSelected.toFixed(2)}`,
        dados: { batch_request_id: batch.id, module_count: selectedModules.length, valor_total: totalSelected },
      });

      return batch.id;
    },
    onSuccess: async (id) => {
      queryClient.invalidateQueries({ queryKey: ["module-batch-requests"] });
      setBatchId(id);
      setShowSummary(false);
      const savedTotal = totalSelected;
      setBatchTotalForPix(savedTotal);
      setSelectedIds(new Set());
      setObservacao("");

      // Generate Asaas charge
      if (savedTotal > 0) {
        try {
          const res = await supabase.functions.invoke("create-asaas-charge", {
            body: {
              payment_type: "modules",
              amount: savedTotal,
              description: `Módulos adicionais - ${empresa?.nome_empresa || ""}`,
              related_batch_request_id: id,
            },
          });
          if (res.error) throw new Error(res.error.message);
          if (res.data?.error) throw new Error(res.data.error);

          setAsaasChargeData({
            pix_qr_code: res.data.pix_qr_code,
            pix_copy_paste: res.data.pix_copy_paste,
            invoice_url: res.data.invoice_url,
          });
          setShowPix(true);
        } catch (err: any) {
          toast({ title: "Erro ao gerar cobrança", description: err.message, variant: "destructive" });
        }
      } else {
        toast({ title: "Solicitação enviada!", description: "Aguarde a aprovação do administrador." });
      }
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  // Upload comprovante for batch
  const handleUploadComprovante = async () => {
    if (!batchId || !empresaId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const path = `${empresaId}/batch-${batchId}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("comprovantes").upload(path, file, { upsert: true });
      if (uploadError) { sonnerToast.error("Erro ao enviar comprovante"); return; }
      const { data: urlData } = supabase.storage.from("comprovantes").getPublicUrl(path);
      await supabase.from("module_batch_requests")
        .update({ comprovante_url: urlData.publicUrl, status: "paid" } as any)
        .eq("id", batchId);
      queryClient.invalidateQueries({ queryKey: ["module-batch-requests"] });
      setShowPix(false);
      sonnerToast.success("Comprovante enviado! Aguarde aprovação.");
    };
    input.click();
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "Pendente", variant: "secondary" },
      paid: { label: "Pago - Aguardando", variant: "secondary" },
      approved: { label: "Aprovado", variant: "default" },
      rejected: { label: "Rejeitado", variant: "destructive" },
      cancelled: { label: "Cancelado", variant: "outline" },
    };
    const info = map[status] || { label: status, variant: "outline" as const };
    return <Badge variant={info.variant}>{info.label}</Badge>;
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Package className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Módulos</h1>
      </div>

      <Tabs defaultValue="disponiveis">
        <TabsList>
          <TabsTrigger value="disponiveis">Disponíveis</TabsTrigger>
          <TabsTrigger value="ativos">Meus Módulos ({activeModules.length})</TabsTrigger>
          <TabsTrigger value="solicitacoes">Solicitações ({batchRequests.length + requests.length})</TabsTrigger>
        </TabsList>

        {/* Available modules with multi-select */}
        <TabsContent value="disponiveis">
          {groupedCatalog.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Nenhum módulo disponível no momento.</p>
          ) : (
            <div className="space-y-6">
              {groupedCatalog.map((group) => (
                <div key={group.category}>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {group.label}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {group.modules.map((mod) => {
                      const status = getModuleStatus(mod);
                      const badgeInfo = getBadgeInfo((mod as any).badge);
                      const isDestaque = (mod as any).destaque;
                      const isSelected = selectedIds.has(mod.id);
                      const isDisabled = status !== "available";

                      return (
                        <Card
                          key={mod.id}
                          className={`relative transition-all ${
                            isSelected ? "ring-2 ring-primary border-primary/50 shadow-md" :
                            isDisabled ? "opacity-60" :
                            isDestaque ? "border-amber-300/50 shadow-md hover:shadow-lg cursor-pointer" :
                            "hover:shadow-md cursor-pointer"
                          }`}
                          onClick={() => !isDisabled && toggleSelect(mod.id)}
                        >
                          {/* Checkbox for available modules */}
                          {!isDisabled && (
                            <div className="absolute top-3 right-3">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelect(mod.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          )}

                          {/* Status overlay for non-available */}
                          {status === "active" && (
                            <div className="absolute top-3 right-3">
                              <Badge variant="default" className="gap-1 text-xs">
                                <CheckCircle className="h-3 w-3" /> Ativo
                              </Badge>
                            </div>
                          )}
                          {status === "pending" && (
                            <div className="absolute top-3 right-3">
                              <Badge variant="secondary" className="gap-1 text-xs">
                                <Clock className="h-3 w-3" /> Pendente
                              </Badge>
                            </div>
                          )}

                          <CardHeader className="pb-2 pr-20">
                            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                              {mod.nome}
                              {isDestaque && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
                              {badgeInfo && (
                                <Badge className={`text-[10px] px-1.5 py-0 ${badgeInfo.className}`}>{badgeInfo.label}</Badge>
                              )}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {(mod as any).texto_venda && (
                              <p className="text-sm text-primary/80 font-medium">{(mod as any).texto_venda}</p>
                            )}
                            {mod.descricao && <p className="text-sm text-muted-foreground">{mod.descricao}</p>}
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {mod.is_capacity_module ? (
                                  <><HardDrive className="h-3 w-3 mr-1" /> Capacidade</>
                                ) : (
                                  <><Zap className="h-3 w-3 mr-1" /> Funcionalidade</>
                                )}
                              </Badge>
                            </div>
                            <p className="text-lg font-semibold">
                              R$ {Number(mod.valor).toFixed(2)}
                              <span className="text-xs text-muted-foreground font-normal">/{mod.periodicidade}</span>
                            </p>
                            {mod.is_capacity_module && (
                              <div className="text-xs text-muted-foreground space-y-0.5">
                                {mod.capacidade_extra_usuarios > 0 && <p>+{mod.capacidade_extra_usuarios} usuários</p>}
                                {mod.capacidade_extra_eventos > 0 && <p>+{mod.capacidade_extra_eventos} eventos</p>}
                                {Number(mod.capacidade_extra_storage) > 0 && <p>+{Number(mod.capacidade_extra_storage)} GB storage</p>}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Floating summary bar */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t shadow-lg p-4">
              <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <ShoppingCart className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-semibold text-sm">
                      {selectedIds.size} módulo{selectedIds.size > 1 ? "s" : ""} selecionado{selectedIds.size > 1 ? "s" : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedModules.map(m => m.nome).join(", ")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-bold text-lg text-primary">R$ {totalSelected.toFixed(2)}</p>
                  <Button onClick={() => { setObservacao(""); setShowSummary(true); }}>
                    <Send className="h-4 w-4 mr-1" /> Solicitar módulos
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setSelectedIds(new Set())}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Active modules */}
        <TabsContent value="ativos">
          {activeModules.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Nenhum módulo ativo.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {activeModules.map((mod) => (
                <Card key={mod.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      {mod.catalog?.nome || "Módulo"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-1">
                    <p>Valor: R$ {Number(mod.valor_cobrado).toFixed(2)}/{mod.catalog?.periodicidade}</p>
                    {mod.granted_by_admin && <Badge variant="outline" className="text-xs">Cortesia Admin</Badge>}
                    {mod.activated_at && <p className="text-xs">Ativo desde: {new Date(mod.activated_at).toLocaleDateString("pt-BR")}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Requests */}
        <TabsContent value="solicitacoes">
          <div className="space-y-4">
            {/* Batch requests */}
            {batchRequests.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Solicitações em Lote</h3>
                {batchRequests.map((batch: any) => (
                  <Card key={batch.id}>
                    <CardContent className="py-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">
                            {(batch.module_batch_request_items || []).length} módulo(s) — R$ {Number(batch.valor_total).toFixed(2)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(batch.created_at).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                        {statusBadge(batch.status)}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(batch.module_batch_request_items || []).map((item: any) => (
                          <Badge key={item.id} variant="outline" className="text-xs">
                            {item.module_catalog?.nome || "Módulo"} — R$ {Number(item.valor).toFixed(2)}
                          </Badge>
                        ))}
                      </div>
                      {batch.observacao && <p className="text-xs text-muted-foreground">Obs: {batch.observacao}</p>}
                      {batch.observacao_admin && <p className="text-xs text-muted-foreground">Admin: {batch.observacao_admin}</p>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Individual requests */}
            {requests.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Solicitações Individuais</h3>
                {requests.map((req: any) => (
                  <Card key={req.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <p className="font-medium">{req.module_catalog?.nome || "Módulo"}</p>
                        <p className="text-xs text-muted-foreground">
                          Solicitado em {new Date(req.requested_at).toLocaleDateString("pt-BR")}
                        </p>
                        {req.observacao && <p className="text-xs text-muted-foreground mt-1">Obs: {req.observacao}</p>}
                      </div>
                      {statusBadge(req.status)}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {batchRequests.length === 0 && requests.length === 0 && (
              <p className="text-muted-foreground py-8 text-center">Nenhuma solicitação registrada.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Summary/Checkout Dialog */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" /> Resumo da Solicitação
            </DialogTitle>
            <DialogDescription>
              Revise os módulos selecionados antes de continuar
            </DialogDescription>
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
                <span className="text-lg text-primary">R$ {totalSelected.toFixed(2)}</span>
              </div>
            </div>

            <div className="bg-muted/50 p-3 rounded-md text-xs text-muted-foreground space-y-1">
              <p>• Os módulos serão ativados após aprovação do administrador</p>
              <p>• O vencimento seguirá o mesmo ciclo do plano base</p>
              <p>• Pagamento único consolidado via PIX</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Observação (opcional)</label>
              <Textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Alguma observação para o administrador..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSummary(false)}>Cancelar</Button>
            <Button onClick={() => batchMutation.mutate()} disabled={batchMutation.isPending}>
              <QrCode className="h-4 w-4 mr-1" /> Solicitar e Pagar — R$ {totalSelected.toFixed(2)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PIX Dialog */}
      <Dialog open={showPix} onOpenChange={setShowPix}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" /> Pagamento via PIX
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              Valor total: <strong className="text-foreground">R$ {totalSelected.toFixed(2)}</strong>
            </p>
            <div className="bg-white p-4 rounded-lg">
              <QRCodeSVG value={pixPayload} size={200} />
            </div>
            <Separator />
            <div className="w-full space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Código PIX Copia e Cola:</p>
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-muted p-3 rounded-md break-all max-h-20 overflow-auto">{pixPayload}</code>
                <Button variant="outline" size="icon" onClick={() => {
                  navigator.clipboard.writeText(pixPayload);
                  sonnerToast.success("Código PIX copiado!");
                }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Separator />
            <Button className="w-full" onClick={handleUploadComprovante}>
              <Upload className="h-4 w-4 mr-2" /> Enviar Comprovante
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Após o pagamento, envie o comprovante para agilizar a aprovação.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
