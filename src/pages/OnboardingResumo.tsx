/**
 * Tela de resumo final do onboarding (etapa 4).
 * Mostra plano base + módulos selecionados + total consolidado.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Music, CheckCircle, Package, Zap, HardDrive, CreditCard, ArrowRight, Sparkles, Shield,
} from "lucide-react";
import { usePlatformBranding } from "@/hooks/useSystemSettings";

export default function OnboardingResumo() {
  const { empresaId } = useAuth();
  const navigate = useNavigate();
  const { platformLogoUrl, platformName } = usePlatformBranding();

  // Empresa + plano base
  const { data: empresa, isLoading: loadingEmpresa } = useQuery({
    queryKey: ["onboarding-resumo-empresa", empresaId],
    queryFn: async () => {
      if (!empresaId) return null;
      const { data, error } = await supabase
        .from("empresas")
        .select("nome_empresa, plano_id, plano, trial_expires_at, status, planos:plano_id(nome, valor, periodicidade, descricao, trial_days)")
        .eq("id", empresaId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Módulos pendentes/ativos da empresa
  const { data: modules = [], isLoading: loadingModules } = useQuery({
    queryKey: ["onboarding-resumo-modules", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("empresa_modules")
        .select("*, module_catalog(*)")
        .eq("empresa_id", empresaId)
        .in("status", ["pending", "active"]);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const planoInfo = (empresa as any)?.planos as {
    nome: string; valor: number; periodicidade: string; descricao: string | null; trial_days: number;
  } | null;

  const valorBase = Number(planoInfo?.valor ?? 0);
  const isTrialActive = !!empresa?.trial_expires_at;

  const subtotalModulos = useMemo(
    () => modules.reduce((s, m) => s + Number(m.valor_cobrado ?? 0), 0),
    [modules]
  );
  const totalGeral = valorBase + subtotalModulos;

  const getSuffix = (p?: string) => {
    if (p === "vitalicio") return "";
    if (p === "anual") return "/ano";
    return "/mês";
  };

  const isLoading = loadingEmpresa || loadingModules;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
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

        {/* Steps */}
        <div className="flex items-center justify-center gap-2 mb-6 text-sm text-muted-foreground">
          {["Conta criada", "Plano base", "Módulos extras"].map((label) => (
            <span key={label} className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-primary" /> {label}
              <span className="text-border last:hidden">—</span>
            </span>
          ))}
          <span className="text-border">—</span>
          <span className="flex items-center gap-1 font-semibold text-foreground">
            <CreditCard className="h-4 w-4 text-primary" /> Resumo
          </span>
        </div>

        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">
            Tudo pronto! 🎉
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Confira o resumo da sua contratação antes de acessar o sistema.
          </p>
        </div>

        {/* Main card */}
        <Card className="border-primary/20 shadow-lg mb-6">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Resumo da Contratação
            </CardTitle>
            {empresa?.nome_empresa && (
              <p className="text-sm text-muted-foreground">{empresa.nome_empresa}</p>
            )}
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Plano base */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Plano Base</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{planoInfo?.nome ?? empresa?.plano ?? "—"}</span>
                  {isTrialActive && (
                    <Badge variant="secondary" className="text-xs">Trial ativo</Badge>
                  )}
                </div>
                <span className="font-bold text-lg">
                  {valorBase > 0 ? (
                    <>R$ {valorBase.toFixed(2)}<span className="text-xs font-normal text-muted-foreground">{getSuffix(planoInfo?.periodicidade)}</span></>
                  ) : (
                    <span className="text-primary">Grátis</span>
                  )}
                </span>
              </div>
              {planoInfo?.descricao && (
                <p className="text-xs text-muted-foreground mt-1 ml-6">{planoInfo.descricao}</p>
              )}
            </div>

            <Separator />

            {/* Módulos */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Módulos Adicionais {modules.length > 0 && `(${modules.length})`}
              </p>
              {modules.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-3">Nenhum módulo selecionado</p>
              ) : (
                <div className="space-y-3">
                  {modules.map((mod: any) => {
                    const cat = mod.module_catalog;
                    return (
                      <div key={mod.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {cat?.is_capacity_module ? (
                            <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-sm truncate">{cat?.nome ?? "Módulo"}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {mod.status === "active" ? "Ativo" : "Pendente"}
                          </Badge>
                        </div>
                        <span className="font-medium text-sm shrink-0 ml-2">
                          R$ {Number(mod.valor_cobrado).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {modules.length > 0 && (
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-dashed">
                  <span className="text-sm text-muted-foreground">Subtotal Módulos</span>
                  <span className="font-medium">R$ {subtotalModulos.toFixed(2)}</span>
                </div>
              )}
            </div>

            <Separator />

            {/* Total */}
            <div className="flex items-center justify-between py-1">
              <span className="text-lg font-bold">Total Mensal</span>
              <span className="text-2xl font-bold text-primary">
                R$ {totalGeral.toFixed(2)}
              </span>
            </div>

            {isTrialActive && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
                <p className="text-sm text-muted-foreground">
                  Seu trial está ativo até{" "}
                  <strong className="text-foreground">
                    {new Date(empresa!.trial_expires_at!).toLocaleDateString("pt-BR")}
                  </strong>.
                  O pagamento será necessário após esse período.
                </p>
              </div>
            )}

            {modules.some((m: any) => m.status === "pending") && (
              <p className="text-xs text-muted-foreground text-center">
                Módulos pendentes serão ativados após aprovação administrativa.
              </p>
            )}
          </CardContent>
        </Card>

        {/* CTA */}
        <Button
          size="lg"
          className="w-full text-base"
          onClick={() => navigate("/agenda", { replace: true })}
        >
          <ArrowRight className="h-5 w-5 mr-2" />
          Acessar o Sistema
        </Button>

        <p className="text-xs text-muted-foreground text-center mt-4">
          Você pode gerenciar seu plano e módulos a qualquer momento em <strong>Plano &amp; Assinatura</strong>.
        </p>
      </div>
    </div>
  );
}
