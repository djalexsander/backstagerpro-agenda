import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import { Check, Copy, Loader2, Printer, QrCode, ScanBarcode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { buildMaterialQrContent } from "@/lib/material-identification";
import {
  MATERIAL_IDENTIFICATION_STATUS_LABELS,
  MATERIAL_IDENTIFICATION_TYPE_LABELS,
  type MaterialWithRelations,
} from "@/lib/material-types";
import {
  generateMaterialBarcode,
  generateMaterialQrCode,
  replaceMaterialBarcode,
} from "@/lib/material-service";
import { MaterialBarcodePreview } from "./MaterialBarcodePreview";

type IdentificationKind = "qr" | "barcode";
type BusyAction = IdentificationKind | "replace-barcode";

export function MaterialIdentificationCard({
  material,
  canGenerate,
  canPrint = false,
  onChanged,
}: {
  material: MaterialWithRelations;
  canGenerate: boolean;
  canPrint?: boolean;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [qrContent, setQrContent] = useState(material.conteudo_qr_code);
  const [barcode, setBarcode] = useState(material.codigo_barras);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [copiedKind, setCopiedKind] = useState<IdentificationKind | null>(null);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);

  useEffect(() => {
    setQrContent(material.conteudo_qr_code);
    setBarcode(material.codigo_barras);
    setCopiedKind(null);
  }, [material.id, material.conteudo_qr_code, material.codigo_barras]);

  const qrPending =
    material.tipo_identificacao !== "codigo_barras" && !qrContent;

  const runGeneration = async (kind: IdentificationKind) => {
    setBusyAction(kind);
    try {
      if (kind === "qr" && qrContent) {
        setQrContent(buildMaterialQrContent(material.identificador_unico));
        toast({ title: "Visualização do QR Code reconstruída" });
        return;
      }

      if (kind === "qr") {
        const generatedQr = await generateMaterialQrCode(material.id);
        setQrContent(generatedQr);
      } else {
        const generatedBarcode = await generateMaterialBarcode(material.id);
        setBarcode(generatedBarcode);
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

  const copyValue = async (kind: IdentificationKind) => {
    const value = kind === "qr" ? qrContent : barcode;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKind(kind);
      window.setTimeout(() => setCopiedKind(null), 1500);
    } catch {
      toast({
        title: "Não foi possível copiar o conteúdo",
        variant: "destructive",
      });
    }
  };

  const replaceBarcode = async () => {
    setBusyAction("replace-barcode");
    try {
      const generatedBarcode = await replaceMaterialBarcode(material.id);
      setBarcode(generatedBarcode);
      setReplaceDialogOpen(false);
      await onChanged();
      toast({ title: "Código de barras substituído" });
    } catch (error) {
      toast({
        title: "Não foi possível substituir o código de barras",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
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
              {MATERIAL_IDENTIFICATION_TYPE_LABELS[material.tipo_identificacao]}
            </Badge>
            <Badge
              variant={
                material.status_identificacao === "ativa"
                  ? "default"
                  : "secondary"
              }
            >
              {MATERIAL_IDENTIFICATION_STATUS_LABELS[material.status_identificacao]}
            </Badge>
            {qrPending && <Badge variant="destructive">QR pendente</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-[190px_1fr]">
        <div
          className="flex min-h-44 items-center justify-center rounded-lg border bg-white p-3"
          data-testid="material-identification-qr-preview"
        >
          {qrContent ? (
            <QRCodeSVG
              value={qrContent}
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

        <div className="min-w-0 space-y-4">
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
              {qrContent || "Não gerado"}
            </code>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Código de barras</p>
            {barcode ? (
              <>
                <div
                  className="flex min-h-28 items-center justify-center overflow-hidden rounded-md border bg-white p-2"
                  data-testid="material-identification-barcode-preview"
                >
                  <MaterialBarcodePreview value={barcode} />
                </div>
                <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs">
                  {barcode}
                </code>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded bg-muted px-2 py-1.5 text-xs">
                  Não informado
                </code>
                <ScanBarcode className="h-5 w-5 shrink-0 text-muted-foreground" />
              </div>
            )}
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
            {canPrint && (
              busyAction === null ? (
                <Button type="button" variant="outline" asChild>
                  <Link to={`/etiquetas?material_id=${encodeURIComponent(material.id)}`}>
                    <Printer className="mr-2 h-4 w-4" />
                    Imprimir etiqueta
                  </Link>
                </Button>
              ) : (
                <Button type="button" variant="outline" disabled>
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir etiqueta
                </Button>
              )
            )}

            {qrContent && (
              <Button
                type="button"
                variant="outline"
                onClick={() => copyValue("qr")}
              >
                {copiedKind === "qr" ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copiedKind === "qr" ? "Copiado" : "Copiar QR Code"}
              </Button>
            )}

            {canGenerate && (
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
            )}

            {barcode ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyValue("barcode")}
                >
                  {copiedKind === "barcode" ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  {copiedKind === "barcode"
                    ? "Copiado"
                    : "Copiar código de barras"}
                </Button>
                {canGenerate && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReplaceDialogOpen(true)}
                    disabled={busyAction !== null}
                  >
                    <ScanBarcode className="mr-2 h-4 w-4" />
                    Substituir código de barras
                  </Button>
                )}
              </>
            ) : (
              canGenerate && (
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
              )
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
      <AlertDialog
        open={replaceDialogOpen}
        onOpenChange={(open) =>
          busyAction !== "replace-barcode" && setReplaceDialogOpen(open)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir código de barras?</AlertDialogTitle>
            <AlertDialogDescription>
              Um novo código automático será gerado e salvo. Etiquetas físicas
              antigas podem deixar de corresponder a este material. Esta ação
              não altera o QR Code nem o identificador técnico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction === "replace-barcode"}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busyAction === "replace-barcode"}
              onClick={(event) => {
                event.preventDefault();
                void replaceBarcode();
              }}
            >
              {busyAction === "replace-barcode" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirmar substituição
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
