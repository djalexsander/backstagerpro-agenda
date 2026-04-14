import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Music, Calendar, Users, HardDrive, Gift, CreditCard, CheckCircle, Sparkles, Shield, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePlatformBranding } from "@/hooks/useSystemSettings";

export default function EscolherPlano() {
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { platformLogoUrl, platformName } = usePlatformBranding();
  const [loading, setLoading] = useState<string | null>(null);

  const { data: planos = [] } = useQuery({
    queryKey: ["planos-ativos-escolha"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos")
        .select("*")
        .eq("ativo", true)
        .order("valor", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const handleFreeTrial = async () => {
    setLoading("free");
    try {
      const res = await supabase.functions.invoke("choose-plan", {
        body: { tipo: "free" },
      });
      if (res.data?.error) throw new Error(res.data.error);

      await refreshProfile();
      toast({ title: "Teste grátis ativado!", description: "Você tem 7 dias para experimentar o sistema." });
      navigate("/onboarding-modulos", { replace: true });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  };

  const handlePaidPlan = (planoId: string) => {
    navigate(`/pagamento-plano/${planoId}`);
  };

  const getSuffix = (periodicidade: string) => {
    if (periodicidade === "vitalicio") return "";
    if (periodicidade === "anual") return "/ano";
    return "/mês";
  };

  const isBestValue = (plano: any) => {
    const sorted = [...planos].sort((a, b) => Number(b.valor) - Number(a.valor));
    return sorted.length > 1 && sorted[0]?.id === plano.id;
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-border flex items-center justify-center overflow-hidden">
            {platformLogoUrl ? (
              <img src={platformLogoUrl} alt={`Logo ${platformName}`} className="h-full w-full object-contain p-1" />
            ) : (
              <Music className="h-7 w-7 text-primary" />
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            {platformName}
          </h1>
        </div>

        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">Escolha seu plano base</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Comece com o plano ideal para sua empresa. Depois você poderá adicionar módulos extras conforme sua necessidade.
          </p>
        </div>

        {/* Free Trial Card */}
        <Card className="mb-8 border-primary/40 bg-gradient-to-r from-primary/5 to-primary/10 shadow-sm">
          <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 md:p-8">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <Gift className="h-7 w-7 text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-bold">Teste Gratuito de 7 Dias</h3>
                <p className="text-muted-foreground mt-1">
                  Experimente todas as funcionalidades sem compromisso. Sem cartão de crédito.
                </p>
                <div className="flex flex-wrap gap-3 mt-2">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-primary" /> Acesso completo
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-primary" /> Sem compromisso
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-primary" /> Cancele quando quiser
                  </span>
                </div>
              </div>
            </div>
            <Button
              size="lg"
              onClick={handleFreeTrial}
              disabled={loading === "free"}
              className="w-full sm:w-auto text-base px-8"
            >
              <Zap className="h-5 w-5 mr-2" />
              {loading === "free" ? "Ativando..." : "Começar Grátis"}
            </Button>
          </CardContent>
        </Card>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-8">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm text-muted-foreground font-medium">ou escolha um plano pago</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Paid Plans — filter out trial/free plans */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {planos.filter((p) => Number(p.valor) > 0).map((plano) => {
            const periodicidade = (plano as any).periodicidade || "mensal";
            const sufixo = getSuffix(periodicidade);
            const bestValue = isBestValue(plano);
            return (
              <Card
                key={plano.id}
                className={`relative cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 ${bestValue ? "border-primary shadow-md ring-1 ring-primary/20" : ""}`}
                onClick={() => handlePaidPlan(plano.id)}
              >
                {bestValue && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary px-3 py-1">
                    <Sparkles className="h-3 w-3 mr-1" /> Mais Completo
                  </Badge>
                )}
                {periodicidade === "vitalicio" && !bestValue && (
                  <Badge className="absolute -top-3 right-4 bg-accent text-accent-foreground">Vitalício</Badge>
                )}
                <CardHeader className="pb-2 pt-6">
                  <CardTitle className="text-xl">{plano.nome}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold text-foreground">
                      R$ {Number(plano.valor).toFixed(2)}
                    </span>
                    {sufixo && (
                      <span className="text-base font-normal text-muted-foreground">{sufixo}</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {plano.descricao && (
                    <p className="text-sm text-muted-foreground">{plano.descricao}</p>
                  )}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2.5 text-sm">
                      <Calendar className="h-4 w-4 text-primary shrink-0" />
                      <span><strong>{plano.max_eventos ?? "∞"}</strong> eventos</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-sm">
                      <Users className="h-4 w-4 text-primary shrink-0" />
                      <span><strong>{plano.max_usuarios ?? "∞"}</strong> usuários</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-sm">
                      <HardDrive className="h-4 w-4 text-primary shrink-0" />
                      <span><strong>{(plano as any).storage_limit ?? 5}GB</strong> armazenamento</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-sm">
                      <Shield className="h-4 w-4 text-primary shrink-0" />
                      <span>Suporte incluso</span>
                    </div>
                  </div>
                  <Button variant={bestValue ? "default" : "outline"} className="w-full mt-2" size="lg">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Selecionar Plano
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {planos.filter((p) => Number(p.valor) > 0).length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-lg">Nenhum plano pago disponível no momento.</p>
            <Button variant="link" onClick={handleFreeTrial} className="mt-2 text-base">
              Iniciar teste grátis de 7 dias
            </Button>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-8">
          Você poderá adicionar módulos extras após a ativação do plano base.
        </p>
      </div>
    </div>
  );
}
