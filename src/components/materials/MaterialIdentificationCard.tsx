import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Loader2, QrCode, ScanBarcode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  MATERIAL_IDENTIFICATION_STATUS_LABELS,
  MATERIAL_IDENTIFICATION_TYPE_LABELS,
  type MaterialWithRelations,
} from "@/lib/material-types";
import {
  generateMaterialBarcode,
  generateMaterialQrCode,
} from "@/lib/material-service";

export function MaterialIdentificationCard({
  material,
  canGenerate,
  onChanged,
}: {
  material: MaterialWithRelations;
  canGenerate: boolean;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [busyAction, setBusyAction] = useState<"qr" | "barcode" | null>(null);
  const [copied, setCopied] = useState(false);
  const qrPending =
    material.tipo_identificacao !== "codigo_barras" &&
    !material.conteudo_qr_code;

  const runGeneration = async (kind: "qr" | "barcode") => {
    setBusyAction(kind);
    try {
      if (kind === "qr") {
        await generateMaterialQrCode(material.id);
      } else {
        await generateMaterialBarcode(material.id);
      }
      await onChanged();
      toast({
        title:
          kind === "qr"
            ? "QR Code gerado com segurança"
            : "Código de barras gerado",
      });
    } catch (error) {
      toast({
        title: "Não foi possível gerar a identificação",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const copyQrContent = async () => {
    if (!material.conteudo_qr_code) return;
    try {
      await navigator.clipboard.writeText(material.conteudo_qr_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: "Não foi possível copiar o conteúdo",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-4 w-4 text-primary" />
            Identificação física
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {
                MATERIAL_IDENTIFICATION_TYPE_LABELS[
                  material.tipo_identificacao
                ]
              }
            </Badge>
            <Badge
              variant={
                material.status_identificacao === "ativa"
                  ? "default"
                  : "secondary"
              }
            >
              {
                MATERIAL_IDENTIFICATION_STATUS_LABELS[
                  material.status_identificacao
                ]
              }
            </Badge>
            {qrPending && <Badge variant="destructive">QR pendente</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-[190px_1fr]">
        <div className="flex min-h-44 items-center justify-center rounded-lg border bg-white p-3">
          {material.conteudo_qr_code ? (
            <QRCodeSVG
              value={material.conteudo_qr_code}
              size={166}
              level="M"
              title={`QR Code de ${material.nome}`}
            />
          ) : (
            <div className="text-center text-sm text-muted-foreground">
              <QrCode className="mx-auto mb-2 h-8 w-8" />
              QR Code ainda não gerado
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">
              Identificador técnico imutável
            </p>
            <code className="mt-1 block break-all rounded bg-muted px-2 py-1.5 text-xs">
              {material.identificador_unico}
            </code>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Conteúdo do QR Code</p>
            <code className="mt-1 block break-all rounded bg-muted px-2 py-1.5 text-xs">
              {material.conteudo_qr_code || "Não gerado"}
            </code>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Código de barras</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 text-xs">
                {material.codigo_barras || "Não informado"}
              </code>
              <ScanBarcode className="h-5 w-5 shrink-0 text-muted-foreground" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Conteúdo textual compatível com futura renderização Code 128.
            </p>
          </div>

          {material.identificacao_gerada_em && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Gerada em</p>
                <p className="mt-1 text-sm font-medium">
                  {new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(material.identificacao_gerada_em))}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Responsável pela geração
                </p>
                <code className="mt-1 block break-all text-xs">
                  {material.identificacao_gerada_por || "Sistema"}
                </code>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {material.conteudo_qr_code ? (
              <Button type="button" variant="outline" onClick={copyQrContent}>
                {copied ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copied ? "Copiado" : "Copiar conteúdo"}
              </Button>
            ) : (
              canGenerate && (
                <Button
                  type="button"
                  onClick={() => runGeneration("qr")}
                  disabled={busyAction !== null}
                >
                  {busyAction === "qr" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <QrCode className="mr-2 h-4 w-4" />
                  )}
                  Gerar QR Code
                </Button>
              )
            )}

            {!material.codigo_barras && canGenerate && (
              <Button
                type="button"
                variant="outline"
                onClick={() => runGeneration("barcode")}
                disabled={busyAction !== null}
              >
                {busyAction === "barcode" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ScanBarcode className="mr-2 h-4 w-4" />
                )}
                Gerar código de barras
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Nome, categoria, localização, status e valores não fazem parte do
            QR Code. A leitura usa apenas o UUID para consultar os dados atuais.
          </p>
          {material.tipo_controle === "quantidade" && (
            <p className="text-xs font-medium text-muted-foreground">
              Este identificador representa o cadastro agregado do material,
              não cada unidade física do saldo.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
