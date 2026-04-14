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
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Power, PowerOff, Gift, Zap, HardDrive, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  empresaId: string;
  empresaNome: string;
}

const STATUS_BADGE: Record<string, { className: string; label: string }> = {
  active: { className: "bg-accent text-accent-foreground", label: "Ativo" },
  inactive: { className: "bg-muted text-muted-foreground", label: "Inativo" },
  pending: { className: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]", label: "Pendente" },
  cancelled: { className: "bg-destructive text-destructive-foreground", label: "Cancelado" },
  rejected: { className: "bg-destructive text-destructive-foreground", label: "Rejeitado" },
};

export function EmpresaModulesManager({ empresaId, empresaNome }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [valorCobrado, setValorCobrado] = useState("0");
  const [isCortesia, setIsCortesia] = useState(false);
  const [isTrialGrant, setIsTrialGrant] = useState(false);

  // Catálogo de módulos ativos
  const { data: catalog = [] } = useQuery({
    queryKey: ["module-catalog-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_catalog")
        .select("*")
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

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

  // Enriquecer com dados do catálogo
  const catalogMap = new Map(catalog.map((c) => [c.id, c]));
  const enriched = empresaModules.map((em) => ({
    ...em,
    catalog: catalogMap.get(em.module_id),
  }));

  // Módulos disponíveis para adicionar (não ativos na empresa)
  const activeModuleIds = new Set(
    empresaModules.filter((m) => m.status === "active" || m.status === "pending").map((m) => m.module_id)
  );
  const availableModules = catalog.filter((c) => !activeModuleIds.has(c.id));

  // Ativar módulo manualmente
  const activateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedModuleId) throw new Error("Selecione um módulo");

      const mod = catalog.find((c) => c.id === selectedModuleId);
      const valor = isCortesia ? 0 : parseFloat(valorCobrado) || 0;

      const { error } = await supabase.from("empresa_modules").insert({
        empresa_id: empresaId,
        module_id: selectedModuleId,
        status: "active",
        activated_at: new Date().toISOString(),
        granted_by_admin: true,
        valor_cobrado: valor,
        origem: isCortesia ? "cortesia_admin" : "manual_admin",
        trial_granted: isTrialGrant,
      } as any);
      if (error) throw error;

      // Log
      await supabase.from("system_logs").insert({
        tipo: "modulo",
        acao: "modulo_ativado_manual",
        descricao: `Módulo "${mod?.nome}" ativado manualmente para ${empresaNome}${isCortesia ? " (cortesia)" : ""}`,
        empresa_id: empresaId,
        empresa_nome: empresaNome,
        dados: {
          module_id: selectedModuleId,
          feature_key: mod?.feature_key,
          valor_cobrado: valor,
          cortesia: isCortesia,
          trial_granted: isTrialGrant,
        },
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresa-modules-admin", empresaId] });
      toast({ title: "Módulo ativado!" });
      setAddOpen(false);
      setSelectedModuleId("");
      setValorCobrado("0");
      setIsCortesia(false);
      setIsTrialGrant(false);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  // Desativar módulo
  const deactivateMutation = useMutation({
    mutationFn: async (moduleRow: any) => {
      const { error } = await supabase
        .from("empresa_modules")
        .update({ status: "inactive" } as any)
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresa-modules-admin", empresaId] });
      toast({ title: "Módulo desativado!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  // Reativar módulo
  const reactivateMutation = useMutation({
    mutationFn: async (moduleRow: any) => {
      const { error } = await supabase
        .from("empresa_modules")
        .update({ status: "active", activated_at: new Date().toISOString() } as any)
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresa-modules-admin", empresaId] });
      toast({ title: "Módulo reativado!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const handleOpenAdd = () => {
    setSelectedModuleId("");
    setValorCobrado("0");
    setIsCortesia(false);
    setIsTrialGrant(false);
    setAddOpen(true);
  };

  // Auto-fill valor when module selected
  const handleModuleSelect = (id: string) => {
    setSelectedModuleId(id);
    const mod = catalog.find((c) => c.id === id);
    if (mod && !isCortesia) {
      setValorCobrado(String(mod.valor));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" /> Módulos
        </h3>
        <Button size="sm" variant="outline" onClick={handleOpenAdd} disabled={availableModules.length === 0}>
          <Plus className="h-3 w-3 mr-1" /> Adicionar
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : enriched.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum módulo atribuído a esta empresa.</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Módulo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Ativado em</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enriched.map((em: any) => {
                const cat = em.catalog;
                const badge = STATUS_BADGE[em.status] || STATUS_BADGE.inactive;
                const isManual = em.granted_by_admin;
                const isCort = em.origem === "cortesia_admin";
                return (
                  <TableRow key={em.id}>
                    <TableCell className="font-medium">
                      {cat?.nome || "—"}
                      {cat?.feature_key && (
                        <code className="block text-[10px] text-muted-foreground">{cat.feature_key}</code>
                      )}
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
                        {em.trial_granted && (
                          <Badge variant="outline" className="text-[10px] gap-0.5 border-[hsl(var(--warning))] text-[hsl(var(--warning))]">
                            <Clock className="h-2.5 w-2.5" /> Trial
                          </Badge>
                        )}
                        {isCort ? (
                          <Badge variant="outline" className="text-[10px] gap-0.5 border-primary text-primary">
                            <Gift className="h-2.5 w-2.5" /> Cortesia
                          </Badge>
                        ) : isManual ? (
                          <Badge variant="outline" className="text-[10px]">Manual</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Contratado</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {em.activated_at ? format(new Date(em.activated_at), "dd/MM/yy", { locale: ptBR }) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {em.status === "active" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => deactivateMutation.mutate(em)}
                          disabled={deactivateMutation.isPending}
                        >
                          <PowerOff className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-accent"
                          onClick={() => reactivateMutation.mutate(em)}
                          disabled={reactivateMutation.isPending}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

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

            {/* Cortesia toggle */}
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

            {/* Trial toggle */}
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

            {/* Valor */}
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

            {/* Preview do módulo selecionado */}
            {selectedModuleId && (() => {
              const mod = catalog.find((c) => c.id === selectedModuleId);
              if (!mod) return null;
              return (
                <Card className="bg-muted/50">
                  <CardContent className="py-3 text-xs space-y-1">
                    <p><strong>{mod.nome}</strong></p>
                    {mod.descricao && <p className="text-muted-foreground">{mod.descricao}</p>}
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
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
