import { useState, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Music, QrCode, Copy, ArrowLeft, Upload, Clock, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePlatformBranding } from "@/hooks/useSystemSettings";
import { gerarPayloadPix } from "@/lib/pix";

export default function PagamentoPlano() {
  const { planoId } = useParams<{ planoId: string }>();
  const { empresaId, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { platformLogoUrl, platformName } = usePlatformBranding();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [settingPlan, setSettingPlan] = useState(false);
  const [planSet, setPlanSet] = useState(false);
  const [comprovanteEnviado, setComprovanteEnviado] = useState(false);

  // Fetch plano details
  const { data: plano } = useQuery({
    queryKey: ["plano-pagamento", planoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos")
        .select("*")
        .eq("id", planoId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!planoId,
  });

  // Fetch empresa
  const { data: empresa } = useQuery({
    queryKey: ["empresa-cadastro", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("nome_empresa")
        .eq("id", empresaId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Fetch PIX settings from system_settings
  const { data: pixSettings } = useQuery({
    queryKey: ["pix-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value")
        .like("key", "pix_%");
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value || ""; });
      return map;
    },
  });

  // Generate PIX payload
  const pixPayload = useMemo(() => {
    if (!pixSettings || !plano) return null;
    try {
      return gerarPayloadPix({
        chave: pixSettings.pix_chave || "",
        nome: pixSettings.pix_nome_recebedor || "",
        cidade: pixSettings.pix_cidade || "",
        valor: Number(plano.valor),
      });
    } catch { return null; }
  }, [pixSettings, plano]);

  // Set the plan via choose-plan edge function
  const handleConfirmPlan = async () => {
    if (!planoId) return;
    setSettingPlan(true);
    try {
      const res = await supabase.functions.invoke("choose-plan", {
        body: { tipo: "paid", plano_id: planoId },
      });
      if (res.data?.error) throw new Error(res.data.error);
      await refreshProfile();
      setPlanSet(true);
    } catch (err: any) {
      toast({ title: "Erro ao confirmar plano", description: err.message, variant: "destructive" });
    } finally {
      setSettingPlan(false);
    }
  };

  const copyPix = () => {
    if (pixPayload) {
      navigator.clipboard.writeText(pixPayload);
      toast({ title: "Código PIX copiado!" });
    }
  };

  const handleUploadComprovante = async (file: File) => {
    if (!empresaId || !planoId || !plano) return;

    setLoading(true);
    try {
      // 1. Create pagamento record
      const { data: pagamento, error: pagErr } = await supabase
        .from("pagamentos")
        .insert({
          empresa_id: empresaId,
          plano_id: planoId,
          valor: plano.valor,
          status: "pendente",
          metodo: "pix",
          descricao: `Assinatura ${plano.nome} - ${empresa?.nome_empresa || ""}`,
        })
        .select("id")
        .single();
      if (pagErr) throw pagErr;

      // 2. Upload comprovante
      const ext = file.name.split(".").pop();
      const path = `${empresaId}/${pagamento.id}-comprovante.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("comprovantes")
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      // 3. Update pagamento with comprovante path
      await supabase
        .from("pagamentos")
        .update({ comprovante_path: path } as any)
        .eq("id", pagamento.id);

      // 4. Update empresa status to pagamento_em_analise
      await supabase
        .from("empresas")
        .update({ status_pagamento: "pagamento_em_analise" } as any)
        .eq("id", empresaId);

      // 5. Insert notificação for master
      await supabase.from("notificacoes_master").insert({
        empresa_id: empresaId,
        tipo: "comprovante_enviado",
        mensagem: `${empresa?.nome_empresa} enviou comprovante para o plano ${plano.nome}`,
        dados: { plano_id: planoId, plano_nome: plano.nome, pagamento_id: pagamento.id },
      });

      // 6. Refresh profile to pick up new status
      await refreshProfile();

      setComprovanteEnviado(true);
      toast({ title: "Comprovante enviado!", description: "Aguarde a aprovação do administrador." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Máximo 5MB", variant: "destructive" });
      return;
    }
    handleUploadComprovante(file);
  };

  const periodicidade = (plano as any)?.periodicidade || "mensal";
  const sufixo = periodicidade === "vitalicio" ? "" : periodicidade === "anual" ? "/ano" : "/mês";

  if (comprovanteEnviado) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <CardContent className="pt-8 pb-8 space-y-4">
              <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Clock className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-bold">Comprovante Enviado!</h2>
              <p className="text-muted-foreground">
                Seu comprovante foi recebido e está em análise. O acesso será liberado automaticamente após a confirmação do pagamento.
              </p>
              <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-1">
                <p><strong>Plano:</strong> {plano?.nome}</p>
                <p><strong>Valor:</strong> R$ {Number(plano?.valor || 0).toFixed(2)}{sufixo}</p>
                <p><strong>Status:</strong> <span className="text-warning font-medium">Em Análise</span></p>
              </div>
              <Button onClick={() => navigate("/aguardando-pagamento", { replace: true })} className="w-full">
                Acompanhar Status do Pagamento
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
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

        <Button variant="ghost" size="sm" onClick={() => navigate("/escolher-plano")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Voltar aos planos
        </Button>

        {/* Plan Summary */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Pagamento do Plano</CardTitle>
            <CardDescription>Complete o pagamento para ativar seu plano</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plano</span>
                <span className="font-semibold">{plano?.nome || "..."}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valor</span>
                <span className="font-semibold text-lg">
                  R$ {Number(plano?.valor || 0).toFixed(2)}{sufixo}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Step 1: Confirm plan choice */}
        {!planSet ? (
          <Card className="mb-6">
            <CardContent className="py-8 text-center space-y-4">
              <QrCode className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">
                Confirme a escolha do plano para visualizar os dados de pagamento PIX.
              </p>
              <Button
                size="lg"
                onClick={handleConfirmPlan}
                disabled={settingPlan || !plano}
                className="w-full"
              >
                {settingPlan ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Confirmando...</>
                ) : (
                  <><QrCode className="h-4 w-4 mr-2" /> Confirmar e Ver PIX — R$ {Number(plano?.valor || 0).toFixed(2)}</>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* PIX Payment — Manual */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <QrCode className="h-5 w-5" />
                  Pagamento via PIX
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {pixPayload && (
                  <>
                    <div className="flex justify-center">
                      <div className="bg-white p-4 rounded-lg">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixPayload)}`}
                          alt="QR Code PIX"
                          className="w-[200px] h-[200px]"
                        />
                      </div>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">Código PIX Copia e Cola:</p>
                      <div className="flex gap-2">
                        <code className="flex-1 text-xs bg-muted p-3 rounded-md break-all max-h-20 overflow-auto">
                          {pixPayload}
                        </code>
                        <Button variant="outline" size="icon" onClick={copyPix}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
                {pixSettings && (
                  <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-1">
                    <p className="font-medium text-foreground">Dados do recebedor:</p>
                    <p><strong>Nome:</strong> {pixSettings.pix_nome_recebedor}</p>
                    <p><strong>Chave ({pixSettings.pix_tipo_chave}):</strong> {pixSettings.pix_chave}</p>
                    <p><strong>Banco:</strong> {pixSettings.pix_banco}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Upload Comprovante */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Upload className="h-5 w-5" />
                  Enviar Comprovante
                </CardTitle>
                <CardDescription>
                  Após realizar o pagamento, envie o comprovante para ativar seu plano
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={onFileChange}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="w-full"
                  size="lg"
                >
                  {loading ? "Enviando..." : "Selecionar e Enviar Comprovante"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Aceita imagens e PDF • Máximo 5MB
                </p>
                <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">ℹ️ Informações importantes:</p>
                  <p>• Envie o comprovante de pagamento para agilizar a ativação</p>
                  <p>• O administrador irá confirmar o pagamento manualmente</p>
                  <p>• Você receberá acesso assim que o pagamento for aprovado</p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
