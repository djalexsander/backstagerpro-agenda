import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle, LogOut, Music } from "lucide-react";
import { usePlatformBranding } from "@/hooks/useSystemSettings";

export default function AguardandoPagamento() {
  const { statusPagamento, refreshProfile, signOut, isMasterAdmin } = useAuth();
  const navigate = useNavigate();
  const { platformLogoUrl, platformName } = usePlatformBranding();

  // Poll every 10s for status change
  useEffect(() => {
    const interval = setInterval(async () => {
      await refreshProfile();
    }, 10000);
    return () => clearInterval(interval);
  }, [refreshProfile]);

  // Auto-redirect when payment is confirmed
  useEffect(() => {
    if (isMasterAdmin) {
      navigate("/agenda", { replace: true });
      return;
    }
    if (statusPagamento === "pago" || statusPagamento === "aprovado" || !statusPagamento) {
      navigate("/agenda", { replace: true });
    }
  }, [statusPagamento, isMasterAdmin, navigate]);

  const statusLabel = statusPagamento === "pagamento_em_analise"
    ? "Pagamento em Análise"
    : "Aguardando Pagamento";

  const statusDescription = statusPagamento === "pagamento_em_analise"
    ? "Seu comprovante foi recebido e está sendo analisado. O acesso será liberado automaticamente após a confirmação."
    : "Estamos aguardando a confirmação do seu pagamento. Assim que for confirmado, seu acesso será liberado automaticamente.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-8">
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

        <Card className="text-center">
          <CardContent className="pt-8 pb-8 space-y-5">
            <div className="mx-auto h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
              {statusPagamento === "pagamento_em_analise" ? (
                <CheckCircle className="h-10 w-10 text-primary animate-pulse" />
              ) : (
                <Clock className="h-10 w-10 text-primary animate-pulse" />
              )}
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold">{statusLabel}</h2>
              <p className="text-muted-foreground">{statusDescription}</p>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground space-y-1">
              <p>• Esta página atualiza automaticamente a cada 10 segundos</p>
              <p>• Você será redirecionado assim que o pagamento for confirmado</p>
              <p>• Em caso de dúvidas, entre em contato com o suporte</p>
            </div>

            <div className="pt-2">
              <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
                <LogOut className="h-4 w-4 mr-2" />
                Sair da conta
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
