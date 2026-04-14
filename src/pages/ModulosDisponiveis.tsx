/**
 * Página do admin da empresa para ver módulos disponíveis,
 * solicitar novos e acompanhar status.
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Package, CheckCircle, Clock, Send, Star, Zap, HardDrive } from "lucide-react";
import type { ModuleCatalogRow } from "@/types/subscription";
import { MODULE_CATEGORIES, getCategoryLabel, getBadgeInfo } from "@/constants/module-categories";

export default function ModulosDisponiveis() {
  const { empresaId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { catalog, activeModules, allModules, isLoading } = useCompanyModules();
  const [requestModule, setRequestModule] = useState<ModuleCatalogRow | null>(null);
  const [observacao, setObservacao] = useState("");

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

  const sendRequest = useMutation({
    mutationFn: async () => {
      if (!empresaId || !requestModule) throw new Error("Dados insuficientes");
      const { error } = await supabase.from("module_requests").insert({
        empresa_id: empresaId,
        module_id: requestModule.id,
        observacao: observacao || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["module-requests"] });
      toast({ title: "Solicitação enviada!", description: "Aguarde a aprovação do administrador." });
      setRequestModule(null);
      setObservacao("");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const activeFeatureKeys = new Set(activeModules.map((m) => m.catalog?.feature_key));
  const pendingRequestModuleIds = new Set(
    requests.filter((r: any) => r.status === "pending").map((r: any) => r.module_id)
  );
  const allModuleIds = new Set(allModules.filter(m => m.status !== "cancelled" && m.status !== "rejected").map(m => m.module_id));

  const availableModules = catalog.filter(
    (c) => !activeFeatureKeys.has(c.feature_key) && !pendingRequestModuleIds.has(c.id) && !allModuleIds.has(c.id)
  );

  // Group available modules by category
  const groupedAvailable = useMemo(() => {
    const groups = new Map<string, ModuleCatalogRow[]>();
    for (const mod of availableModules) {
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
  }, [availableModules]);

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "Pendente", variant: "secondary" },
      approved: { label: "Aprovado", variant: "default" },
      rejected: { label: "Rejeitado", variant: "destructive" },
      cancelled: { label: "Cancelado", variant: "outline" },
      paid: { label: "Pago", variant: "default" },
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
          <TabsTrigger value="solicitacoes">Solicitações ({requests.length})</TabsTrigger>
          <TabsTrigger value="pagamentos">Pagamentos ({payments.length})</TabsTrigger>
        </TabsList>

        {/* Available modules grouped by category */}
        <TabsContent value="disponiveis">
          {groupedAvailable.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Nenhum módulo disponível para contratação no momento.</p>
          ) : (
            <div className="space-y-6">
              {groupedAvailable.map((group) => (
                <div key={group.category}>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {group.label}
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {group.modules.map((mod) => {
                      const badgeInfo = getBadgeInfo((mod as any).badge);
                      const isDestaque = (mod as any).destaque;
                      return (
                        <Card key={mod.id} className={isDestaque ? "border-amber-300/50 shadow-md" : ""}>
                          <CardHeader className="pb-2">
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
                            <Button size="sm" className="w-full" onClick={() => { setRequestModule(mod); setObservacao(""); }}>
                              <Send className="h-4 w-4 mr-1" /> Solicitar
                            </Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))}
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
          {requests.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Nenhuma solicitação registrada.</p>
          ) : (
            <div className="space-y-3">
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
        </TabsContent>

        {/* Payments */}
        <TabsContent value="pagamentos">
          {payments.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Nenhum pagamento de módulo registrado.</p>
          ) : (
            <div className="space-y-3">
              {payments.map((pay: any) => (
                <Card key={pay.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <p className="font-medium">{pay.module_catalog?.nome || "Módulo"}</p>
                      <p className="text-xs text-muted-foreground">
                        R$ {Number(pay.amount).toFixed(2)} • {new Date(pay.created_at).toLocaleDateString("pt-BR")}
                      </p>
                      {pay.observacao_admin && <p className="text-xs text-muted-foreground mt-1">Admin: {pay.observacao_admin}</p>}
                    </div>
                    {statusBadge(pay.status)}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Request Dialog */}
      <Dialog open={!!requestModule} onOpenChange={(o) => !o && setRequestModule(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar Módulo: {requestModule?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">{requestModule?.descricao}</p>
            <p className="font-semibold">Valor: R$ {Number(requestModule?.valor || 0).toFixed(2)}/{requestModule?.periodicidade}</p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Observação (opcional)</label>
              <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Alguma observação para o administrador..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestModule(null)}>Cancelar</Button>
            <Button onClick={() => sendRequest.mutate()} disabled={sendRequest.isPending}>
              <Send className="h-4 w-4 mr-1" /> Enviar Solicitação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
