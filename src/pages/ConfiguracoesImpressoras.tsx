import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer as PrinterIcon, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { getPrinterPermissions } from "@/lib/printer-permissions";
import {
  isDesktopRuntime,
  isPrinterCurrentlyInstalled,
  listPrinterConfigs,
  listSystemPrinters,
  openPrintWindow,
  savePrinterConfig,
} from "@/lib/printer-service";
import { PRINTER_PURPOSE_LABELS, type PrinterConfig, type PrinterPurpose, type SystemPrinter } from "@/lib/printer-types";

const PURPOSES: PrinterPurpose[] = ["etiqueta", "cupom", "documento"];

const DEFAULT_FORMAT: Record<PrinterPurpose, { format: string; width?: number; height?: number }> = {
  etiqueta: { format: "50x30mm", width: 50, height: 30 },
  cupom: { format: "58mm", width: 58 },
  documento: { format: "A4" },
};

function buildTestHtml(purpose: PrinterPurpose, config: PrinterConfig | undefined) {
  const label = PRINTER_PURPOSE_LABELS[purpose];
  const width = config?.largura_mm ?? DEFAULT_FORMAT[purpose].width;
  const size = purpose === "documento" ? "210mm 297mm" : width ? `${width}mm ${config?.altura_mm ?? 40}mm` : "80mm 40mm";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Teste - ${label}</title>
    <style>@page{size:${size};margin:4mm;} body{font-family:Arial,sans-serif;padding:8px;}</style>
    </head><body><h3>Teste de impressão</h3><p>Finalidade: ${label}</p><p>Impressora configurada: ${config?.nome_impressora ?? "(nenhuma)"}</p>
    <script>window.addEventListener('load',function(){window.focus();window.print();});</script></body></html>`;
}

// Isolated so the desktop/web branching in the main component stays
// readable - this is the one piece with real state (loading/error/offline)
// instead of a plain controlled input.
function PrinterPicker({
  id,
  value,
  onChange,
  systemPrinters,
  isLoading,
  isError,
  errorMessage,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  systemPrinters: SystemPrinter[] | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  disabled: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />Detectando impressoras...
      </div>
    );
  }
  if (isError) {
    return <p className="text-sm text-destructive">{errorMessage ?? "Não foi possível detectar as impressoras do Windows."}</p>;
  }
  const printers = systemPrinters ?? [];
  const installed = isPrinterCurrentlyInstalled(value, printers);
  return (
    <div className="space-y-1.5">
      {printers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma impressora instalada foi encontrada.</p>
      ) : (
        <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id}><SelectValue placeholder="Selecione a impressora" /></SelectTrigger>
          <SelectContent>
            {printers.map((printer) => (
              <SelectItem key={printer.name} value={printer.name}>
                {printer.name}{printer.isDefault ? " · padrão do Windows" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {value && !installed && (
        <p className="text-xs text-destructive">"{value}" não encontrada/offline. Selecione outra impressora instalada ou reconecte o dispositivo.</p>
      )}
    </div>
  );
}

export default function ConfiguracoesImpressoras() {
  const { toast } = useToast();
  const { role, empresaId: companyId, isMasterAdmin } = useAuth();
  const queryClient = useQueryClient();
  const permissions = getPrinterPermissions({ role, companySelected: Boolean(companyId) });

  const desktop = isDesktopRuntime();

  const configsQuery = useQuery({
    queryKey: ["printer-configs", companyId],
    queryFn: () => listPrinterConfigs(companyId!),
    enabled: Boolean(companyId && permissions.visualizar),
  });

  const systemPrintersQuery = useQuery({
    queryKey: ["system-printers"],
    queryFn: listSystemPrinters,
    enabled: desktop,
  });
  const defaultSystemPrinter = systemPrintersQuery.data?.find((printer) => printer.isDefault);

  const [drafts, setDrafts] = useState<Record<PrinterPurpose, { printerName: string; format: string; width: string; height: string }>>({
    etiqueta: { printerName: "", format: "", width: "", height: "" },
    cupom: { printerName: "", format: "", width: "", height: "" },
    documento: { printerName: "", format: "", width: "", height: "" },
  });

  useEffect(() => {
    if (!configsQuery.data) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const purpose of PURPOSES) {
        const existing = configsQuery.data!.find((item) => item.finalidade === purpose);
        next[purpose] = {
          printerName: existing?.nome_impressora ?? "",
          format: existing?.formato ?? DEFAULT_FORMAT[purpose].format,
          width: existing?.largura_mm != null ? String(existing.largura_mm) : DEFAULT_FORMAT[purpose].width != null ? String(DEFAULT_FORMAT[purpose].width) : "",
          height: existing?.altura_mm != null ? String(existing.altura_mm) : DEFAULT_FORMAT[purpose].height != null ? String(DEFAULT_FORMAT[purpose].height) : "",
        };
      }
      return next;
    });
  }, [configsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (purpose: PrinterPurpose) => {
      const draft = drafts[purpose];
      return savePrinterConfig(companyId!, {
        purpose,
        printerName: draft.printerName,
        format: draft.format,
        widthMm: draft.width ? Number(draft.width) : undefined,
        heightMm: draft.height ? Number(draft.height) : undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["printer-configs", companyId] });
      toast({ title: "Configuração de impressora salva" });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }),
  });

  const handleTestPrint = (purpose: PrinterPurpose) => {
    const config = configsQuery.data?.find((item) => item.finalidade === purpose);
    if (desktop && config?.nome_impressora) {
      toast({
        title: "Escolha a impressora na janela que vai abrir",
        description: `Este app ainda não envia a impressão direto para o dispositivo - selecione "${config.nome_impressora}" na janela de impressão do sistema.`,
      });
    }
    openPrintWindow(buildTestHtml(purpose, config));
  };

  if (!companyId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Impressoras</h1>
        <p className="text-muted-foreground">
          {isMasterAdmin
            ? "Sua conta master não está vinculada a uma empresa operacional."
            : "Empresa não identificada."}
        </p>
      </div>
    );
  }
  if (!permissions.visualizar) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Impressoras</h1>
        <Card className="border-amber-500/50"><CardContent className="p-4 text-sm">Você não tem acesso a esta configuração.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><PrinterIcon className="h-6 w-6" />Impressoras</h1>
        <p className="text-muted-foreground">Defina qual impressora e formato usar para cada tipo de impressão.</p>
      </div>
      <Card className="border-muted-foreground/20">
        <CardContent className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          {desktop ? (
            <span>
              Aplicativo desktop detectado — as impressoras abaixo foram detectadas automaticamente no Windows.
              {defaultSystemPrinter && <> Padrão do sistema: <strong className="text-foreground">{defaultSystemPrinter.name}</strong>.</>}
            </span>
          ) : (
            <span>
              Navegador não tem acesso à lista de impressoras instaladas — a seleção real da impressora acontece na janela de impressão do
              sistema/navegador. Aqui você define apenas o formato e um apelido para lembrar qual impressora usar.
            </span>
          )}
          {desktop && (
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => systemPrintersQuery.refetch()}
              disabled={systemPrintersQuery.isFetching}
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${systemPrintersQuery.isFetching ? "animate-spin" : ""}`} />
              Atualizar lista
            </Button>
          )}
        </CardContent>
      </Card>

      {configsQuery.isLoading ? (
        <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {PURPOSES.map((purpose) => {
            const config = configsQuery.data?.find((item) => item.finalidade === purpose);
            const draft = drafts[purpose];
            return (
              <Card key={purpose}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    {PRINTER_PURPOSE_LABELS[purpose]}
                    {config && <Badge variant={config.ativo ? "default" : "secondary"}>{config.ativo ? "Configurado" : "Inativo"}</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {purpose === "etiqueta" && "Etiquetas de materiais, código de barras e QR Code."}
                    {purpose === "cupom" && "Comprovante de locação, retirada, devolução e recibos."}
                    {purpose === "documento" && "Relatórios de clientes, contratos e documentos A4."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={`printer-name-${purpose}`}>Impressora{desktop ? "" : " (apelido)"}</Label>
                    {desktop ? (
                      <PrinterPicker
                        id={`printer-name-${purpose}`}
                        value={draft.printerName}
                        onChange={(value) => setDrafts((current) => ({ ...current, [purpose]: { ...current[purpose], printerName: value } }))}
                        systemPrinters={systemPrintersQuery.data}
                        isLoading={systemPrintersQuery.isLoading}
                        isError={systemPrintersQuery.isError}
                        errorMessage={systemPrintersQuery.error instanceof Error ? systemPrintersQuery.error.message : undefined}
                        disabled={!permissions.configurar}
                      />
                    ) : (
                      <Input
                        id={`printer-name-${purpose}`}
                        value={draft.printerName}
                        onChange={(event) => setDrafts((current) => ({ ...current, [purpose]: { ...current[purpose], printerName: event.target.value } }))}
                        placeholder={purpose === "etiqueta" ? "PT-260" : purpose === "cupom" ? "EPSON TM-T20" : "HP LaserJet"}
                        disabled={!permissions.configurar}
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor={`printer-format-${purpose}`}>Formato</Label>
                      <Input
                        id={`printer-format-${purpose}`}
                        value={draft.format}
                        onChange={(event) => setDrafts((current) => ({ ...current, [purpose]: { ...current[purpose], format: event.target.value } }))}
                        disabled={!permissions.configurar}
                      />
                    </div>
                    {purpose !== "documento" && (
                      <div className="space-y-2">
                        <Label htmlFor={`printer-width-${purpose}`}>Largura (mm)</Label>
                        <Input
                          id={`printer-width-${purpose}`}
                          type="number"
                          value={draft.width}
                          onChange={(event) => setDrafts((current) => ({ ...current, [purpose]: { ...current[purpose], width: event.target.value } }))}
                          disabled={!permissions.configurar}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 pt-2">
                    {permissions.configurar && (
                      <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(purpose)}>
                        {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Salvar
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => handleTestPrint(purpose)}>
                      Testar impressão
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
