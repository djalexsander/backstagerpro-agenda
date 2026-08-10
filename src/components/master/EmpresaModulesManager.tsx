/**
 * Componente de gestão de módulos de uma empresa específica.
 * Usado no dialog de detalhes da empresa no painel master.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Power, PowerOff, Gift, Zap, HardDrive, Clock, Pencil, Trash2, CheckCircle, Star, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { buildCompanyModuleEntitlementPayload, validateModuleDependenciesForActivation } from "@/lib/company-module-entitlements";

interface Props {
  empresaId: string;
  empresaNome: string;
  isLifetime?: boolean;
}

const STATUS_BADGE: Record<string, { className: string; label: string }> = {
  active: { className: "bg-accent text-accent-foreground", label: "Ativo" },
  inactive: { className: "bg-muted text-muted-foreground", label: "Inativo" },
  pending: { className: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]", label: "Pendente" },
  cancelled: { className: "bg-destructive text-destructive-foreground", label: "Cancelado" },
  rejected: { className: "bg-destructive text-destructive-foreground", label: "Rejeitado" },
};

const ORIGEM_LABELS: Record<string, string> = {
  solicitacao: "Solicitação",
  onboarding: "Onboarding",
  manual_admin: "Manual",
  cortesia_admin: "Cortesia",
  pagamento: "Pagamento",
};

export function EmpresaModulesManager({
  empresaId,
  empresaNome,
  isLifetime = false,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [valorCobrado, setValorCobrado] = useState("0");
  const [isCortesia, setIsCortesia] = useState(false);
  const [isTrialGrant, setIsTrialGrant] = useState(false);
  const [editValor, setEditValor] = useState("0");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["empresa-modules-admin", empresaId] });
    queryClient.invalidateQueries({ queryKey: ["empresa-modules"] });
    queryClient.invalidateQueries({ queryKey: ["company-lifetime-license"] });
    queryClient.invalidateQueries({ queryKey: ["master-empresas-module-counts"] });
  };

  // Catálogo completo (inclui inativos para lookup)
  const { data: catalog = [] } = useQuery({
    queryKey: ["module-catalog-all-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_catalog")
        .select("*")
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const activeCatalog = catalog.filter((c) => c.ativo);
  const catalogMap = new Map(catalog.map((c) => [c.id, c]));

  const { data: moduleDependencies = [] } = useQuery({
    queryKey: ["module-dependencies-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("module_dependencies").select("module_id, required_module_id");
      if (error) throw error;
      return data as Array<{ module_id: string; required_module_id: string }>;
    },
  });

  const dependencyMap = new Map<string, Array<{ featureKey: string; name: string }>>();
  for (const dependency of moduleDependencies) {
    const module = catalogMap.get(dependency.module_id);
    const requiredModule = catalogMap.get(dependency.required_module_id);
    if (!module || !requiredModule) continue;
    const existing = dependencyMap.get(module.feature_key) ?? [];
    existing.push({ featureKey: requiredModule.feature_key, name: requiredModule.nome });
    dependencyMap.set(module.feature_key, existing);
  }

  // Módulos da empresa
  const { data: empresaModules = [], isLoading } = useQuery({
    queryKey: ["empresa-modules-admin", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_modules")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const enriched = empresaModules.map((em) => ({
    ...em,
    catalog: catalogMap.get(em.module_id),
  }));

  const activeModuleIds = new Set(
    empresaModules.filter((m) => m.status === "active" || m.status === "pending").map((m) => m.module_id)
  );
  const activeCatalogFeatureKeys = new Set(
    empresaModules
      .filter((m) => m.status === "active")
      .map((m) => catalogMap.get(m.module_id)?.feature_key)
      .filter(Boolean) as string[]
  );
  const availableModules = activeCatalog.filter((c) => !activeModuleIds.has(c.id));
  const catalogRows = activeCatalog.map((module) => {
    const existing = empresaModules.find((em) => em.module_id === module.id);
    const status = existing?.status === "active"
      ? "active"
      : existing?.status === "pending"
        ? "pending"
        : existing?.status === "inactive"
          ? "inactive"
          : "unassigned";
    return { module, existing, status };
  });

  // Stats
  const activeCount = enriched.filter((m) => m.status === "active").length;
  const pendingCount = enriched.filter((m) => m.status === "pending").length;

  // --- Mutations ---

  const activateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedModuleId) throw new Error("Selecione um módulo");
      const mod = catalog.find((c) => c.id === selectedModuleId);
      if (!mod) throw new Error("Módulo não encontrado");

      const requiredDependencies = (dependencyMap.get(mod.feature_key) ?? []).map((dependency) => ({
        requiredModuleFeatureKey: dependency.featureKey,
      }));
      const validation = validateModuleDependenciesForActivation({
        moduleDependencies: requiredDependencies,
        activeModuleFeatureKeys: activeCatalogFeatureKeys,
      });

      if (!validation.isAllowed) {
        throw new Error(`Dependências pendentes: ${validation.missingDependencies.join(", ")}`);
      }

      const valor = isCortesia ? 0 : parseFloat(valorCobrado) || 0;
      const existingRow = empresaModules.find((m) => m.module_id === selectedModuleId);
      const payload = buildCompanyModuleEntitlementPayload({
        requestedStatus: "active",
        grantedByAdmin: true,
        valorCobrado: valor,
        origem: isCortesia ? "cortesia_admin" : "manual_admin",
        trialGranted: isTrialGrant,
        currentStatus: existingRow?.status as any,
        existingActivatedAt: existingRow?.activated_at ?? null,
      });

      if (existingRow) {
        const { error } = await supabase
          .from("empresa_modules")
          .update(payload as any)
          .eq("id", existingRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("empresa_modules").insert({
          empresa_id: empresaId,
          module_id: selectedModuleId,
          ...payload,
        } as any);
        if (error) throw error;
      }

      await supabase.from("system_logs").insert({
        tipo: "modulo",
        acao: "modulo_ativado_manual",
        descricao: `Módulo "${mod?.nome}" ativado manualmente para ${empresaNome}${isCortesia ? " (cortesia)" : ""}`,
        empresa_id: empresaId,
        empresa_nome: empresaNome,
        dados: { module_id: selectedModuleId, feature_key: mod?.feature_key, valor_cobrado: valor, cortesia: isCortesia, trial_granted: isTrialGrant },
      } as any);
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Módulo ativado!" });
      setAddOpen(false);
      resetAddForm();
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const approvePendingMutation = useMutation({
    mutationFn: async (moduleRow: any) => {
      const payload = buildCompanyModuleEntitlementPayload({
        requestedStatus: "active",
        grantedByAdmin: true,
        valorCobrado: Number(moduleRow?.valor_cobrado ?? 0),
        origem: moduleRow?.origem ?? "manual_admin",
        trialGranted: Boolean(moduleRow?.trial_granted),
        currentStatus: moduleRow?.status,
        existingActivatedAt: moduleRow?.activated_at ?? null,
      });
      const { error } = await supabase
        .from("empresa_modules")
        .update(payload as any)
        .eq("id", moduleRow.id);
      if (error) throw error;

      const mod = catalogMap.get(moduleRow.module_id);
      await supabase.from("system_logs").insert({
        tipo: "modulo",
        acao: "modulo_aprovado",
        descricao: `Módulo "${mod?.nome || "?"}" aprovado pelo admin para ${empresaNome}`,
        empresa_id: empresaId,
        empresa_nome: empresaNome,
        dados: { module_id: moduleRow.module_id, feature_key: mod?.feature_key, origem: moduleRow.origem },
      } as any);
    },
    onSuccess: () => { invalidate(); toast({ title: "Módulo aprovado e ativado!" }); },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (moduleRow: any) => {
      const payload = buildCompanyModuleEntitlementPayload({
        requestedStatus: "inactive",
        grantedByAdmin: Boolean(moduleRow?.granted_by_admin),
        valorCobrado: Number(moduleRow?.valor_cobrado ?? 0),
        origem: moduleRow?.origem ?? "manual_admin",
        trialGranted: Boolean(moduleRow?.trial_granted),
        currentStatus: moduleRow?.status,
        existingActivatedAt: moduleRow?.activated_at ?? null,
      });
      const { error } = await supabase
        .from("empresa_modules")
        .update(payload as any)
        .eq("id", moduleRow.id);
      if (error) throw error;

      const mod = catalogMap.get(moduleRow.module_id);
      await supabase.from("system_logs").insert({
        tipo: "modulo",
        acao: "modulo_desativado",
        descricao: `Módulo "${mod?.nome || "?"}" desativado para ${empresaNome}`,
        empresa_id: empresaId,
        empresa_nome: empresaNome,
        dados: { module_id: moduleRow.module_id, feature_key: mod?.feature_key },
      } as any);
    },
    onSuccess: () => { invalidate(); toast({ title: "Módulo desativado!" }); },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (moduleRow: any) => {
      const payload = buildCompanyModuleEntitlementPayload({
        requestedStatus: "active",
        grantedByAdmin: Boolean(moduleRow?.granted_by_admin),
        valorCobrado: Number(moduleRow?.valor_cobrado ?? 0),
        origem: moduleRow?.origem ?? "manual_admin",
        trialGranted: Boolean(moduleRow?.trial_granted),
        currentStatus: moduleRow?.status,
        existingActivatedAt: moduleRow?.activated_at ?? null,
      });
      const { error } = await supabase
        .from("empresa_modules")
        .update(payload as any)
        .eq("id", moduleRow.id);
      if (error) throw error;

      const mod = catalogMap.get(moduleRow.module_id);
      await supabase.from("system_logs").insert({
        tipo: "modulo",
        acao: "modulo_reativado",
        descricao: `Módulo "${mod?.nome || "?"}" reativado para ${empresaNome}`,
        empresa_id: empresaId,
        empresa_nome: empresaNome,
        dados: { module_id: moduleRow.module_id, feature_key: mod?.feature_key },
      } as any);
    },
    onSuccess: () => { invalidate(); toast({ title: "Módulo reativado!" }); },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const updateValorMutation = useMutation({
    mutationFn: async () => {
      if (!editingModule) return;
      const newValor = parseFloat(editValor) || 0;
      const { error } = await supabase
        .from("empresa_modules")
        .update({ valor_cobrado: newValor } as any)
        .eq("id", editingModule.id);
      if (error) throw error;

      const mod = catalogMap.get(editingModule.module_id);
      await supabase.from("system_logs").insert({
        tipo: "modulo",
        acao: "modulo_valor_alterado",
        descricao: `Valor do módulo "${mod?.nome || "?"}" alterado para R$ ${newValor.toFixed(2)} — ${empresaNome}`,
        empresa_id: empresaId,
        empresa_nome: empresaNome,
        dados: { module_id: editingModule.module_id, valor_anterior: editingModule.valor_cobrado, valor_novo: newValor },
      } as any);
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Valor atualizado!" });
      setEditOpen(false);
      setEditingModule(null);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const row = empresaModules.find((m) => m.id === id);
      const { error } = await supabase.from("empresa_modules").delete().eq("id", id);
      if (error) throw error;

      if (row) {
        const mod = catalogMap.get(row.module_id);
        await supabase.from("system_logs").insert({
          tipo: "modulo",
          acao: "modulo_removido",
          descricao: `Módulo "${mod?.nome || "?"}" removido da empresa ${empresaNome}`,
          empresa_id: empresaId,
          empresa_nome: empresaNome,
          dados: { module_id: row.module_id, feature_key: mod?.feature_key },
        } as any);
      }
    },
    onSuccess: () => { invalidate(); toast({ title: "Módulo removido!" }); setDeleteId(null); },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const resetAddForm = () => {
    setSelectedModuleId("");
    setValorCobrado("0");
    setIsCortesia(false);
    setIsTrialGrant(false);
  };

  const handleOpenAdd = () => { resetAddForm(); setAddOpen(true); };

  const handleModuleSelect = (id: string) => {
    setSelectedModuleId(id);
    const mod = catalog.find((c) => c.id === id);
    if (mod && !isCortesia) setValorCobrado(String(mod.valor));
  };

  const openEditValor = (em: any) => {
    setEditingModule(em);
    setEditValor(String(em.valor_cobrado));
    setEditOpen(true);
  };

  if (isLifetime) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" /> Módulos
          <Badge className="bg-primary/15 text-primary border border-primary/30 text-[10px]">
            <Sparkles className="h-3 w-3 mr-1" /> Todos inclusos
          </Badge>
        </h3>
        <Card className="border-primary/30 bg-primary/[0.03]">
          <CardContent className="py-5">
            <p className="font-medium">Licença Vitalícia</p>
            <p className="text-sm text-muted-foreground mt-1">
              Todos os módulos atuais e futuros estão liberados sem cobrança,
              atribuição individual ou vencimento.
            </p>
            {activeCatalog.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {activeCatalog.map((module) => (
                  <Badge key={module.id} variant="outline">
                    {module.nome}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" /> Módulos
          <Badge variant="outline" className="text-[10px] ml-1">{activeCount} ativo{activeCount !== 1 ? "s" : ""}</Badge>
          {pendingCount > 0 && (
            <Badge className="bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))] text-[10px]">
              {pendingCount} pendente{pendingCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={handleOpenAdd} disabled={availableModules.length === 0}>
          <Plus className="h-3 w-3 mr-1" /> Adicionar
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card">
            <div className="px-3 py-2 border-b bg-muted/40">
              <p className="text-sm font-semibold">Catálogo comercial</p>
              <p className="text-xs text-muted-foreground">Status de cada módulo comercializável para esta empresa.</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Módulo</TableHead>
                  <TableHead>Dependências</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogRows.map(({ module, existing, status }) => {
                  const dependencyList = dependencyMap.get(module.feature_key) ?? [];
                  const statusLabel = status === "active" ? "Liberado" : status === "pending" ? "Pendente" : status === "inactive" ? "Desativado" : "Não liberado";
                  const badgeClassName = status === "active"
                    ? "bg-accent text-accent-foreground"
                    : status === "pending"
                      ? "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]"
                      : "bg-muted text-muted-foreground";
                  return (
                    <TableRow key={module.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{module.nome}</p>
                          <p className="text-[10px] text-muted-foreground">{module.feature_key}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {dependencyList.length > 0 ? (
                          <div className="space-y-1">
                            {dependencyList.map((dependency) => (
                              <Badge key={`${module.id}-${dependency.featureKey}`} variant="outline" className="text-[10px]">
                                {dependency.name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">R$ {Number(module.valor).toFixed(2)}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={badgeClassName}>{statusLabel}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {status === "active" ? (
                          <Button size="sm" variant="outline" className="text-destructive border-destructive" onClick={() => existing && deactivateMutation.mutate(existing)}>
                            Desativar
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => {
                            setSelectedModuleId(module.id);
                            setValorCobrado(String(module.valor));
                            setIsCortesia(false);
                            setIsTrialGrant(false);
                            setAddOpen(true);
                          }}>
                            Ativar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Módulo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enriched.map((em: any) => {
                const cat = em.catalog;
                const badge = STATUS_BADGE[em.status] || STATUS_BADGE.inactive;
                const isPending = em.status === "pending";
                const isActive = em.status === "active";

                return (
                  <TableRow key={em.id} className={isPending ? "bg-[hsl(var(--warning))]/5" : ""}>
                    <TableCell>
                      <div>
                        <span className="font-medium">{cat?.nome || "—"}</span>
                        {cat?.feature_key && (
                          <code className="block text-[10px] text-muted-foreground">{cat.feature_key}</code>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] gap-0.5">
                        {cat?.is_capacity_module ? (
                          <><HardDrive className="h-2.5 w-2.5" /> Cap.</>
                        ) : (
                          <><Zap className="h-2.5 w-2.5" /> Func.</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {Number(em.valor_cobrado) === 0 ? (
                        <span className="text-muted-foreground">Grátis</span>
                      ) : (
                        `R$ ${Number(em.valor_cobrado).toFixed(2)}`
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {dependencyMap.get(cat?.feature_key || "")?.length ? (
                          <Badge variant="outline" className="text-[10px] border-muted-foreground/40 text-muted-foreground">
                            {dependencyMap.get(cat?.feature_key || "")?.length} dependência{dependencyMap.get(cat?.feature_key || "")?.length !== 1 ? "s" : ""}
                          </Badge>
                        ) : null}
                        {em.trial_granted && (
                          <Badge variant="outline" className="text-[10px] gap-0.5 border-[hsl(var(--warning))] text-[hsl(var(--warning))]">
                            <Clock className="h-2.5 w-2.5" /> Trial
                          </Badge>
                        )}
                        {em.origem === "cortesia_admin" ? (
                          <Badge variant="outline" className="text-[10px] gap-0.5 border-primary text-primary">
                            <Gift className="h-2.5 w-2.5" /> Cortesia
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            {ORIGEM_LABELS[em.origem] || em.origem}
                          </Badge>
                        )}
                        {em.granted_by_admin && em.origem !== "cortesia_admin" && (
                          <Badge variant="outline" className="text-[10px]">Admin</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        {/* Approve pending */}
                        {isPending && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-green-600"
                            title="Aprovar e ativar"
                            onClick={() => approvePendingMutation.mutate(em)}
                            disabled={approvePendingMutation.isPending}
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {/* Edit valor */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Editar valor"
                          onClick={() => openEditValor(em)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {/* Toggle active/inactive */}
                        {isActive ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            title="Desativar"
                            onClick={() => deactivateMutation.mutate(em)}
                            disabled={deactivateMutation.isPending}
                          >
                            <PowerOff className="h-3.5 w-3.5" />
                          </Button>
                        ) : !isPending ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-accent"
                            title="Reativar"
                            onClick={() => reactivateMutation.mutate(em)}
                            disabled={reactivateMutation.isPending}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {/* Delete */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          title="Remover módulo"
                          onClick={() => setDeleteId(em.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover módulo?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso removerá o módulo completamente da empresa. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit valor dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar Valor — {editingModule?.catalog?.nome || catalogMap.get(editingModule?.module_id)?.nome || "Módulo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Valor cobrado (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={editValor}
                onChange={(e) => setEditValor(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Valor original do catálogo: R$ {Number(catalogMap.get(editingModule?.module_id)?.valor ?? 0).toFixed(2)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => updateValorMutation.mutate()} disabled={updateValorMutation.isPending}>
              {updateValorMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog para adicionar módulo */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ativar Módulo — {empresaNome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Módulo <span className="text-destructive">*</span></Label>
              <Select value={selectedModuleId} onValueChange={handleModuleSelect}>
                <SelectTrigger><SelectValue placeholder="Selecione um módulo" /></SelectTrigger>
                <SelectContent>
                  {availableModules.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome} — R$ {Number(m.valor).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">Conceder como cortesia</p>
                  <p className="text-xs text-muted-foreground">Sem cobrança, valor zerado</p>
                </div>
              </div>
              <Switch
                checked={isCortesia}
                onCheckedChange={(v) => {
                  setIsCortesia(v);
                  if (v) setValorCobrado("0");
                  else {
                    const mod = catalog.find((c) => c.id === selectedModuleId);
                    setValorCobrado(mod ? String(mod.valor) : "0");
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[hsl(var(--warning))]" />
                <div>
                  <p className="text-sm font-medium">Módulo temporário (trial)</p>
                  <p className="text-xs text-muted-foreground">Será desativado quando o trial expirar</p>
                </div>
              </div>
              <Switch checked={isTrialGrant} onCheckedChange={setIsTrialGrant} />
            </div>

            {!isCortesia && (
              <div className="space-y-1.5">
                <Label>Valor cobrado (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={valorCobrado}
                  onChange={(e) => setValorCobrado(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Pode ser ajustado manualmente</p>
              </div>
            )}

            {selectedModuleId && (() => {
              const mod = catalog.find((c) => c.id === selectedModuleId);
              if (!mod) return null;
              return (
                <Card className="bg-muted/50">
                  <CardContent className="py-3 text-xs space-y-1">
                    <p><strong>{mod.nome}</strong></p>
                    {mod.descricao && <p className="text-muted-foreground">{mod.descricao}</p>}
                    {dependencyMap.get(mod.feature_key)?.length ? (
                      <div className="pt-1">
                        <p className="font-medium">Dependências:</p>
                        <ul className="list-disc pl-4 text-muted-foreground">
                          {(dependencyMap.get(mod.feature_key) ?? []).map((dependency) => (
                            <li key={`${mod.id}-${dependency.featureKey}`}>{dependency.name}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {mod.is_capacity_module && (
                      <div className="flex gap-3 pt-1">
                        {mod.capacidade_extra_usuarios > 0 && <span>+{mod.capacidade_extra_usuarios} usuários</span>}
                        {mod.capacidade_extra_eventos > 0 && <span>+{mod.capacidade_extra_eventos} eventos</span>}
                        {mod.capacidade_extra_storage > 0 && <span>+{mod.capacidade_extra_storage}GB</span>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
          </div>
          <DialogFooter>
            <Button
              onClick={() => activateMutation.mutate()}
              disabled={activateMutation.isPending || !selectedModuleId}
            >
              {activateMutation.isPending ? "Ativando..." : "Ativar Módulo"}
            </Button>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
