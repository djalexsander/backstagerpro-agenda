/**
 * Tela de seleção de módulos no onboarding (etapa 3).
 * O cliente monta o pacote de módulos extras após escolher o plano base.
 */
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Music, Package, Zap, HardDrive, CheckCircle, ArrowRight, ShoppingCart, Sparkles, Star,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePlatformBranding } from "@/hooks/useSystemSettings";
import type { ModuleCatalogRow } from "@/types/subscription";
import { MODULE_CATEGORIES, getCategoryLabel, getBadgeInfo } from "@/constants/module-categories";

export default function OnboardingModulos() {
  const { empresaId, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { platformLogoUrl, platformName } = usePlatformBranding();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const { data: catalog = [], isLoading: loadingCatalog } = useQuery({
    queryKey: ["module-catalog-onboarding"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_catalog")
        .select("*")
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data as (ModuleCatalogRow & { categoria?: string; badge?: string | null; texto_venda?: string | null; destaque?: boolean })[];
    },
  });

  const { data: existingModules = [] } = useQuery({
    queryKey: ["empresa-modules-onboarding", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("empresa_modules")
        .select("module_id, status")
        .eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: empresa } = useQuery({
    queryKey: ["onboarding-empresa-plano", empresaId],
    queryFn: async () => {
      if (!empresaId) return null;
      const { data, error } = await supabase
        .from("empresas")
        .select("plano_id, plano, planos:plano_id(nome, valor, periodicidade)")
        .eq("id", empresaId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const existingModuleIds = useMemo(
    () => new Set(existingModules.filter((m) => m.status !== "cancelled" && m.status !== "rejected").map((m) => m.module_id)),
    [existingModules]
  );

  const availableModules = useMemo(
    () => catalog.filter((c) => !existingModuleIds.has(c.id)),
    [catalog, existingModuleIds]
  );

  // Group modules by category
  const groupedModules = useMemo(() => {
    const groups = new Map<string, typeof availableModules>();
    for (const mod of availableModules) {
      const cat = (mod as any).categoria || "operacional";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(mod);
    }
    // Sort by MODULE_CATEGORIES order
    const ordered: { category: string; label: string; modules: typeof availableModules }[] = [];
    for (const c of MODULE_CATEGORIES) {
      const mods = groups.get(c.value);
      if (mods && mods.length > 0) {
        ordered.push({ category: c.value, label: c.label, modules: mods });
      }
    }
    // Any uncategorized
    for (const [key, mods] of groups) {
      if (!MODULE_CATEGORIES.some((c) => c.value === key)) {
        ordered.push({ category: key, label: getCategoryLabel(key), modules: mods });
      }
    }
    return ordered;
  }, [availableModules]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedModules = useMemo(
    () => availableModules.filter((m) => selected.has(m.id)),
    [availableModules, selected]
  );

  const totalModulos = useMemo(
    () => selectedModules.reduce((sum, m) => sum + Number(m.valor), 0),
    [selectedModules]
  );

  const planoInfo = (empresa as any)?.planos as { nome: string; valor: number; periodicidade: string } | null;
  const valorBase = Number(planoInfo?.valor ?? 0);
  const totalGeral = valorBase + totalModulos;

  const handleSubmit = async () => {
    if (!empresaId) return;
    setSubmitting(true);
    try {
      if (selected.size > 0) {
        const rows = Array.from(selected).map((moduleId) => {
          const mod = catalog.find((c) => c.id === moduleId);
          return {
            empresa_id: empresaId,
            module_id: moduleId,
            status: "pending",
            valor_cobrado: Number(mod?.valor ?? 0),
            origem: "onboarding",
          };
        });

        const { error } = await supabase.from("empresa_modules").insert(rows);
        if (error) throw error;

        await supabase.from("notificacoes_master").insert({
          empresa_id: empresaId,
          tipo: "modulos_onboarding",
          mensagem: `Nova empresa solicitou ${rows.length} módulo(s) durante o onboarding.`,
          dados: { modules: rows.map((r) => r.module_id) },
        });
      }

      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ["empresa-modules"] });

      toast({
        title: selected.size > 0 ? "Módulos solicitados!" : "Configuração concluída!",
        description: selected.size > 0
          ? "Os módulos serão ativados após aprovação."
          : "Você pode contratar módulos a qualquer momento.",
      });

      navigate("/onboarding-resumo", { replace: true });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingCatalog) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-border flex items-center justify-center overflow-hidden">
            {platformLogoUrl ? (
              <img src={platformLogoUrl} alt={`Logo ${platformName}`} className="h-full w-full object-contain p-1" />
            ) : (
              <Music className="h-7 w-7 text-primary" />
            )}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{platformName}</h1>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle className="h-4 w-4 text-primary" /> Conta criada
          </span>
          <span className="text-border">—</span>
          <span className="flex items-center gap-1">
            <CheckCircle className="h-4 w-4 text-primary" /> Plano base
          </span>
          <span className="text-border">—</span>
          <span className="flex items-center gap-1 font-semibold text-foreground">
            <Package className="h-4 w-4 text-primary" /> Módulos extras
          </span>
        </div>

        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Monte seu pacote</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Escolha os módulos adicionais para turbinar sua operação. Você pode pular esta etapa e contratar depois.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Module list grouped by category */}
          <div className="lg:col-span-2 space-y-6">
            {groupedModules.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Nenhum módulo disponível no momento.
                </CardContent>
              </Card>
            ) : (
              groupedModules.map((group) => (
                <div key={group.category}>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    {group.label}
                  </h3>
                  <div className="space-y-3">
                    {group.modules.map((mod) => {
                      const isSelected = selected.has(mod.id);
                      const badgeInfo = getBadgeInfo((mod as any).badge);
                      const isDestaque = (mod as any).destaque;
                      return (
                        <Card
                          key={mod.id}
                          className={`cursor-pointer transition-all border-2 ${
                            isSelected
                              ? "border-primary bg-primary/5 shadow-md"
                              : isDestaque
                                ? "border-amber-300/50 hover:border-amber-400"
                                : "border-transparent hover:border-border"
                          }`}
                          onClick={() => toggle(mod.id)}
                        >
                          <CardContent className="flex items-start gap-4 p-5">
                            <Checkbox checked={isSelected} onCheckedChange={() => toggle(mod.id)} className="mt-1 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <h3 className="font-semibold text-base">{mod.nome}</h3>
                                {isDestaque && (
                                  <Star className="h-4 w-4 fill-amber-400 text-amber-400 shrink-0" />
                                )}
                                {badgeInfo && (
                                  <Badge className={`text-[10px] px-1.5 py-0 ${badgeInfo.className}`}>{badgeInfo.label}</Badge>
                                )}
                                <Badge variant="outline" className="text-xs">
                                  {mod.is_capacity_module ? (
                                    <><HardDrive className="h-3 w-3 mr-1" /> Capacidade</>
                                  ) : (
                                    <><Zap className="h-3 w-3 mr-1" /> Funcionalidade</>
                                  )}
                                </Badge>
                              </div>
                              {(mod as any).texto_venda && (
                                <p className="text-sm text-primary/80 font-medium mb-1">{(mod as any).texto_venda}</p>
                              )}
                              {mod.descricao && (
                                <p className="text-sm text-muted-foreground mb-2">{mod.descricao}</p>
                              )}
                              {mod.is_capacity_module && (
                                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                  {mod.capacidade_extra_usuarios > 0 && <span>+{mod.capacidade_extra_usuarios} usuários</span>}
                                  {mod.capacidade_extra_eventos > 0 && <span>+{mod.capacidade_extra_eventos} eventos</span>}
                                  {Number(mod.capacidade_extra_storage) > 0 && <span>+{Number(mod.capacidade_extra_storage)} GB</span>}
                                </div>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-lg font-bold">R$ {Number(mod.valor).toFixed(2)}</p>
                              <p className="text-xs text-muted-foreground">/{mod.periodicidade}</p>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Sidebar summary */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 space-y-4">
              <Card className="border-primary/30">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShoppingCart className="h-5 w-5 text-primary" />
                    Resumo do Pacote
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Plano Base</span>
                    <span className="font-medium">
                      {planoInfo ? (
                        <>{planoInfo.nome} — R$ {Number(planoInfo.valor).toFixed(2)}</>
                      ) : "—"}
                    </span>
                  </div>

                  <Separator />

                  {selectedModules.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Módulos Selecionados</p>
                      {selectedModules.map((m) => (
                        <div key={m.id} className="flex items-center justify-between text-sm">
                          <span className="truncate mr-2">{m.nome}</span>
                          <span className="shrink-0 font-medium">R$ {Number(m.valor).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-2">Nenhum módulo selecionado</p>
                  )}

                  <Separator />

                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Total Mensal</span>
                    <span className="text-xl font-bold text-primary">R$ {totalGeral.toFixed(2)}</span>
                  </div>

                  {selectedModules.length > 0 && (
                    <p className="text-xs text-muted-foreground text-center">
                      Os módulos serão ativados após aprovação administrativa.
                    </p>
                  )}

                  <Button className="w-full" size="lg" onClick={handleSubmit} disabled={submitting}>
                    {submitting ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : selected.size > 0 ? (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Solicitar {selected.size} módulo{selected.size > 1 ? "s" : ""} e Continuar
                      </>
                    ) : (
                      <>
                        <ArrowRight className="h-4 w-4 mr-2" />
                        Pular e Acessar o Sistema
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
