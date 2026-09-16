import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Copy, ExternalLink, Loader2, Music, QrCode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePlatformBranding } from "@/hooks/useSystemSettings";
import {
  formatEmpresaDocumentoInput,
  isValidCpfCnpj,
} from "@/lib/empresa-dados";

type AsaasCharge = {
  paymentId: string;
  asaasPaymentId: string;
  amount: number;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
  invoiceUrl: string | null;
};

type JsonResponseReader = {
  json: () => Promise<unknown>;
  clone?: () => JsonResponseReader;
};

function responseErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const message = (value as Record<string, unknown>).error;
  return typeof message === "string" && message.trim() ? message : null;
}

async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === "object") {
    const context = (error as { context?: JsonResponseReader }).context;
    if (context?.json) {
      try {
        const body = await (context.clone?.() ?? context).json();
        const message = responseErrorMessage(body);
        if (message) return message;
      } catch {
        // A response body is optional; fall back to the client error below.
      }
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Não foi possível gerar a cobrança PIX.";
}

function parseAsaasCharge(value: unknown): AsaasCharge {
  if (!value || typeof value !== "object") {
    throw new Error("A resposta da cobrança Asaas é inválida.");
  }

  const data = value as Record<string, unknown>;
  const apiError = responseErrorMessage(data);
  if (apiError) throw new Error(apiError);

  const amount = Number(data.amount);
  if (
    data.success !== true ||
    typeof data.payment_id !== "string" ||
    typeof data.asaas_payment_id !== "string" ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error("A resposta da cobrança Asaas é inválida.");
  }

  const optionalString = (field: unknown) =>
    typeof field === "string" && field.trim() ? field : null;

  return {
    paymentId: data.payment_id,
    asaasPaymentId: data.asaas_payment_id,
    amount,
    pixQrCode: optionalString(data.pix_qr_code),
    pixCopyPaste: optionalString(data.pix_copy_paste),
    invoiceUrl: optionalString(data.invoice_url),
  };
}

export default function PagamentoPlano() {
  const { planoId } = useParams<{ planoId: string }>();
  const { empresaId, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { platformLogoUrl, platformName } = usePlatformBranding();
  const chargeRequestInFlightRef = useRef(false);
  const [settingPlan, setSettingPlan] = useState(false);
  const [planSet, setPlanSet] = useState(false);
  const [documento, setDocumento] = useState<string | null>(null);
  const [documentoSalvoNestaTela, setDocumentoSalvoNestaTela] = useState<string | null>(null);
  const [documentoError, setDocumentoError] = useState<string | null>(null);
  const [cobranca, setCobranca] = useState<AsaasCharge | null>(null);
  const [cobrancaError, setCobrancaError] = useState<string | null>(null);
  const [cobrancaExistente, setCobrancaExistente] = useState(false);

  // Fetch plano details
  const { data: plano } = useQuery({
    queryKey: ["plano-pagamento", planoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos")
        .select("*")
        .eq("id", planoId!)
        .eq("ativo", true)
        .eq("disponivel_novo_cadastro", true)
        .eq("categoria", "plano_base")
        .in("periodicidade", ["mensal", "anual"])
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
        .select("nome_empresa, cpf_cnpj")
        .eq("id", empresaId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const documentoExibido = documento ?? formatEmpresaDocumentoInput(empresa?.cpf_cnpj || "");
  const documentoDigits = documentoExibido.replace(/\D/g, "");
  const documentoPersistido = documentoSalvoNestaTela ?? empresa?.cpf_cnpj?.replace(/\D/g, "") ?? "";
  const documentoSalvoValido =
    isValidCpfCnpj(documentoDigits) && documentoDigits === documentoPersistido;

  const saveDocumentoMutation = useMutation({
    mutationFn: async (cpfCnpj: string) => {
      if (!empresaId) throw new Error("Empresa não identificada.");
      const { data, error } = await supabase
        .from("empresas")
        .update({ cpf_cnpj: cpfCnpj })
        .eq("id", empresaId)
        .select("id, cpf_cnpj")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") {
          throw new Error("Este CPF/CNPJ já está cadastrado em outra empresa.");
        }
        if (error.code === "23514") {
          throw new Error("Informe um CPF com 11 dígitos ou CNPJ com 14 dígitos.");
        }
        throw new Error(error.message || "Não foi possível salvar o CPF/CNPJ.");
      }
      if (!data) throw new Error("Não foi possível localizar a empresa para atualização.");
      return data.cpf_cnpj;
    },
    onSuccess: (cpfCnpj) => {
      setDocumento(formatEmpresaDocumentoInput(cpfCnpj || ""));
      setDocumentoSalvoNestaTela(cpfCnpj);
      setDocumentoError(null);
      queryClient.invalidateQueries({ queryKey: ["empresa-cadastro", empresaId] });
      queryClient.invalidateQueries({ queryKey: ["empresa-dados"] });
      toast({ title: "CPF/CNPJ salvo!", description: "Documento pronto para a cobrança via Asaas." });
    },
    onError: (error: Error) => {
      setDocumentoError(error.message);
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    },
  });

  const handleSaveDocumento = () => {
    if (!isValidCpfCnpj(documentoDigits)) {
      setDocumentoError("Informe um CPF ou CNPJ válido.");
      return;
    }
    setDocumentoError(null);
    saveDocumentoMutation.mutate(documentoDigits);
  };

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
    } catch (error: unknown) {
      toast({
        title: "Erro ao confirmar plano",
        description: error instanceof Error ? error.message : "Não foi possível confirmar o plano.",
        variant: "destructive",
      });
    } finally {
      setSettingPlan(false);
    }
  };

  const createChargeMutation = useMutation({
    mutationFn: async () => {
      if (!planoId) throw new Error("Plano não identificado.");

      const { data, error } = await supabase.functions.invoke("create-asaas-charge", {
        body: { plano_id: planoId },
      });
      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      return parseAsaasCharge(data);
    },
    onSuccess: (charge) => {
      setCobranca(charge);
      setCobrancaError(
        charge.pixQrCode && charge.pixCopyPaste
          ? null
          : "A cobrança foi criada, mas o Asaas não retornou os dados PIX completos. Nenhum PIX alternativo foi gerado.",
      );
    },
    onError: (error: Error) => {
      const existingCharge = /active charge already exists|cobrança ativa já existe/i.test(error.message);
      setCobrancaExistente(existingCharge);
      setCobrancaError(
        existingCharge
          ? "Já existe uma cobrança ativa para este plano. Aguarde a confirmação do pagamento pelo Asaas."
          : error.message,
      );
    },
    onSettled: () => {
      chargeRequestInFlightRef.current = false;
    },
  });

  const handleCreateCharge = () => {
    if (
      chargeRequestInFlightRef.current ||
      createChargeMutation.isPending ||
      cobranca ||
      cobrancaExistente
    ) {
      return;
    }
    if (!documentoSalvoValido) {
      setCobrancaError("Salve um CPF ou CNPJ válido antes de gerar a cobrança.");
      return;
    }

    chargeRequestInFlightRef.current = true;
    setCobrancaError(null);
    createChargeMutation.mutate();
  };

  const copyPix = async () => {
    if (!cobranca?.pixCopyPaste) return;
    try {
      await navigator.clipboard.writeText(cobranca.pixCopyPaste);
      toast({ title: "Código PIX copiado!" });
    } catch {
      toast({ title: "Não foi possível copiar o código PIX", variant: "destructive" });
    }
  };

  const periodicidade = plano?.periodicidade || "mensal";
  const sufixo = periodicidade === "vitalicio" ? "" : periodicidade === "anual" ? "/ano" : "/mês";

  const pixQrCodeSrc = cobranca?.pixQrCode
    ? cobranca.pixQrCode.startsWith("data:")
      ? cobranca.pixQrCode
      : `data:image/png;base64,${cobranca.pixQrCode}`
    : null;

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

        {/* Billing document required by create-asaas-charge. */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Dados para cobrança</CardTitle>
            <CardDescription>
              Informe o CPF ou CNPJ da empresa antes de gerar uma cobrança via Asaas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="billing-cpf-cnpj">CPF ou CNPJ</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="billing-cpf-cnpj"
                  value={documentoExibido}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  aria-invalid={Boolean(documentoError)}
                  onChange={(event) => {
                    setDocumento(formatEmpresaDocumentoInput(event.target.value));
                    setDocumentoError(null);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSaveDocumento}
                  disabled={saveDocumentoMutation.isPending}
                >
                  {saveDocumentoMutation.isPending ? "Salvando..." : "Salvar CPF/CNPJ"}
                </Button>
              </div>
              {documentoError && <p className="text-xs text-destructive">{documentoError}</p>}
              <p className="text-xs text-muted-foreground">
                A máscara é apenas visual; o documento é salvo somente com dígitos.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Step 1: Confirm plan choice */}
        {!planSet ? (
          <Card className="mb-6">
            <CardContent className="py-8 text-center space-y-4">
              <QrCode className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">
                Confirme a escolha do plano antes de gerar a cobrança PIX.
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
                  <><QrCode className="h-4 w-4 mr-2" /> Confirmar escolha do plano</>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : !cobranca ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <QrCode className="h-5 w-5" />
                Cobrança PIX via Asaas
              </CardTitle>
              <CardDescription>
                O valor e os dados PIX serão gerados pelo Asaas com base no plano escolhido.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!documentoSalvoValido && (
                <p className="text-sm text-muted-foreground">
                  Salve um CPF ou CNPJ válido para liberar a geração da cobrança.
                </p>
              )}
              {cobrancaError && (
                <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {cobrancaError}
                </div>
              )}
              <Button
                size="lg"
                className="w-full"
                onClick={handleCreateCharge}
                disabled={
                  !documentoSalvoValido ||
                  createChargeMutation.isPending ||
                  cobrancaExistente
                }
              >
                {createChargeMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando cobrança...</>
                ) : (
                  <><QrCode className="h-4 w-4 mr-2" /> Gerar cobrança PIX</>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <QrCode className="h-5 w-5" />
                Pagamento via PIX
              </CardTitle>
              <CardDescription>
                Cobrança gerada pelo Asaas. A liberação ocorrerá após a confirmação do pagamento pelo webhook.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">Valor da cobrança</p>
                <p className="text-2xl font-bold">
                  {cobranca.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </p>
              </div>

              {cobrancaError && (
                <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {cobrancaError}
                </div>
              )}

              {pixQrCodeSrc && (
                <div className="flex justify-center">
                  <div className="rounded-lg bg-white p-4">
                    <img
                      src={pixQrCodeSrc}
                      alt="QR Code PIX gerado pelo Asaas"
                      className="h-[200px] w-[200px]"
                    />
                  </div>
                </div>
              )}

              {cobranca.pixCopyPaste && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Código PIX Copia e Cola:</p>
                    <div className="flex gap-2">
                      <code className="max-h-20 flex-1 overflow-auto break-all rounded-md bg-muted p-3 text-xs">
                        {cobranca.pixCopyPaste}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Copiar código PIX"
                        onClick={copyPix}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {cobranca.invoiceUrl && (
                <Button asChild variant="outline" className="w-full">
                  <a href={cobranca.invoiceUrl} target="_blank" rel="noopener noreferrer">
                    Abrir cobrança no Asaas
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}

              <p className="text-center text-xs text-muted-foreground">
                Não é necessário enviar comprovante. Aguarde a confirmação automática do pagamento.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
