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
      navigate("/modulos", { replace: true });
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

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 border border-border flex items-center justify-center overflow-hidden">
            {platformLogoUrl ? (
              <img src={platformLogoUrl} alt={`Logo ${platformName}`} className="h-full w-full object-contain p-1" />
            ) : (
              <Music className="h-6 w-6 text-primary" />
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            {platformName}
          </h1>
        </div>

        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Escolha seu plano</h2>
          <p className="text-muted-foreground">Selecione o plano ideal para sua empresa</p>
        </div>

        {/* Free Trial Card */}
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Gift className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Teste Gratuito de 7 Dias</h3>
                <p className="text-sm text-muted-foreground">
                  Experimente todas as funcionalidades sem compromisso
                </p>
              </div>
            </div>
            <Button
              size="lg"
              onClick={handleFreeTrial}
              disabled={loading === "free"}
              className="w-full sm:w-auto"
            >
              {loading === "free" ? "Ativando..." : "Começar Grátis"}
            </Button>
          </CardContent>
        </Card>

        {/* Paid Plans */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {planos.map((plano) => {
            const periodicidade = (plano as any).periodicidade || "mensal";
            const sufixo = getSuffix(periodicidade);
            return (
              <Card
                key={plano.id}
                className="relative cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
                onClick={() => handlePaidPlan(plano.id)}
              >
                {periodicidade === "vitalicio" && (
                  <Badge className="absolute -top-2 right-4 bg-primary">Vitalício</Badge>
                )}
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">{plano.nome}</CardTitle>
                  <CardDescription className="text-xl font-bold text-foreground">
                    R$ {Number(plano.valor).toFixed(2)}
                    <span className="text-sm font-normal text-muted-foreground">{sufixo}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {plano.descricao && (
                    <p className="text-muted-foreground mb-3">{plano.descricao}</p>
                  )}
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {plano.max_eventos ?? "∞"} eventos
                    </p>
                    <p className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {plano.max_usuarios ?? "∞"} usuários
                    </p>
                    <p className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-muted-foreground" />
                      {(plano as any).storage_limit ?? 5}GB armazenamento
                    </p>
                  </div>
                  <Button variant="outline" className="w-full mt-4">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Selecionar Plano
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {planos.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>Nenhum plano disponível no momento.</p>
            <Button variant="link" onClick={handleFreeTrial} className="mt-2">
              Iniciar teste grátis de 7 dias
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
