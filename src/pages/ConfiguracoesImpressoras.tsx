import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer as PrinterIcon, RefreshCw } from "lucide-react";
import { BobinaProfilesSection } from "@/components/printer-settings/BobinaProfilesSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { listBobinaProfiles, resolveBobinaProfile } from "@/lib/bobina-profile-service";
import { legacyProfileFromModel } from "@/lib/label-layout-engine";
import { printBobinaTestPage } from "@/lib/material-label-print";
import { getPrinterPermissions } from "@/lib/printer-permissions";
import {
  isDesktopRuntime,
  isPrinterCurrentlyInstalled,
  listPrinterConfigs,
  listSystemPrinters,
  printHtmlDocument,
  resolveEffectivePrinterConfig,
  savePrinterConfig,
} from "@/lib/printer-service";
import { PRINTER_PURPOSE_LABELS, type PrinterConfig, type PrinterPurpose, type SystemPrinter } from "@/lib/printer-types";
import {
  clearTerminalPrinterOverride,
  hasTerminalPrinterOverride,
  saveTerminalPrinterOverride,
} from "@/lib/terminal-printer-config";

const PURPOSES: PrinterPurpose[] = ["etiqueta", "cupom", "documento"];

const DEFAULT_FORMAT: Record<PrinterPurpose, { format: string; width?: number; height?: number }> = {
  etiqueta: { format: "50x30mm", width: 50, height: 30 },
  cupom: { format: "58mm", width: 58 },
  documento: { format: "A4" },
};

type PrinterDraft = { printerName: string; format: string; width: string; height: string; bobinaProfileId: string };

/** Shared by the initial draft-seeding effect and "usar padrão da empresa"
 * (handleClearOverride) so the two never drift into different field-mapping
 * logic for the same PrinterConfig -> form-state conversion. */
function draftFromConfig(purpose: PrinterPurpose, config: PrinterConfig | undefined): PrinterDraft {
  return {
    printerName: config?.nome_impressora ?? "",
    format: config?.formato ?? DEFAULT_FORMAT[purpose].format,
    width: config?.largura_mm != null ? String(config.largura_mm) : DEFAULT_FORMAT[purpose].width != null ? String(DEFAULT_FORMAT[purpose].width) : "",
    height: config?.altura_mm != null ? String(config.altura_mm) : DEFAULT_FORMAT[purpose].height != null ? String(DEFAULT_FORMAT[purpose].height) : "",
    bobinaProfileId: config?.perfil_bobina_padrao_id ?? "",
  };
}

// Physical size for the test print - documento is always A4, the other two
// purposes use the saved format falling back to a generic receipt-ish size
// (matches the original web-only buildTestHtml behavior exactly; only the
// return shape changed so both the web <style> string and the desktop
// rasterization container below can share it).
function testPrintSizeMm(purpose: PrinterPurpose, config: PrinterConfig | undefined): { widthMm: number; heightMm: number } {
  if (purpose === "documento") return { widthMm: 210, heightMm: 297 };
  const width = config?.largura_mm ?? DEFAULT_FORMAT[purpose].width;
  if (!width) return { widthMm: 80, heightMm: 40 };
  return { widthMm: width, heightMm: config?.altura_mm ?? 40 };
}

function testPrintBodyMarkup(purpose: PrinterPurpose, config: PrinterConfig | undefined) {
  const label = PRINTER_PURPOSE_LABELS[purpose];
  return `<h3>Teste de impressão</h3><p>Finalidade: ${label}</p><p>Impressora configurada: ${config?.nome_impressora ?? "(nenhuma)"}</p>`;
}

function buildTestHtml(
  purpose: PrinterPurpose,
  config: PrinterConfig | undefined,
  size = testPrintSizeMm(purpose, config),
) {
  const { widthMm, heightMm } = size;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Teste - ${PRINTER_PURPOSE_LABELS[purpose]}</title>
    <style>@page{size:${widthMm}mm ${heightMm}mm;margin:4mm;} body{font-family:Arial,sans-serif;padding:8px;}</style>
    </head><body>${testPrintBodyMarkup(purpose, config)}</body></html>`;
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

  // Bobina profiles are company-wide (not per-purpose), but only the
  // etiqueta card offers a picker for them - see section 7/8 of the
  // request: a printer isn't permanently tied to one size, it just points
  // at whichever profile is currently loaded.
  const bobinaProfilesQuery = useQuery({
    queryKey: ["bobina-profiles", companyId],
    queryFn: () => listBobinaProfiles(companyId!),
    enabled: Boolean(companyId && permissions.visualizar),
  });

  const [drafts, setDrafts] = useState<Record<PrinterPurpose, PrinterDraft>>({
    etiqueta: { printerName: "", format: "", width: "", height: "", bobinaProfileId: "" },
    cupom: { printerName: "", format: "", width: "", height: "", bobinaProfileId: "" },
    documento: { printerName: "", format: "", width: "", height: "", bobinaProfileId: "" },
  });
  // Whether THIS terminal has its own saved selection per purpose (see
  // src/lib/terminal-printer-config.ts) - drives the status line/badge and
  // the "usar padrão da empresa" action in each card below.
  const [terminalOverrideActive, setTerminalOverrideActive] = useState<Record<PrinterPurpose, boolean>>({
    etiqueta: false, cupom: false, documento: false,
  });
  // Per-purpose opt-in checked right before "Salvar": when on, saving also
  // writes the company-wide default (empresa_impressora_config) in addition
  // to this terminal's local override, so a fresh/never-configured terminal
  // has something sensible to fall back to. Off by default so the ordinary
  // save action never silently touches another terminal's fallback.
  const [setAsCompanyDefault, setSetAsCompanyDefault] = useState<Record<PrinterPurpose, boolean>>({
    etiqueta: false, cupom: false, documento: false,
  });

  /** Local override (if this terminal has one) layered over the company
   * default - the same resolution every real print job goes through
   * (resolveEffectivePrinterConfig, called internally by getConfiguredPrinter
   * in printer-service.ts). Keeping the settings screen on this exact
   * function is what guarantees "o que a tela mostra é o que vai imprimir". */
  function getEffectiveConfig(purpose: PrinterPurpose): PrinterConfig | undefined {
    if (!companyId) return undefined;
    return resolveEffectivePrinterConfig(companyId, configsQuery.data ?? [], purpose) ?? undefined;
  }

  useEffect(() => {
    if (!companyId) return;
    setTerminalOverrideActive({
      etiqueta: hasTerminalPrinterOverride(companyId, "etiqueta"),
      cupom: hasTerminalPrinterOverride(companyId, "cupom"),
      documento: hasTerminalPrinterOverride(companyId, "documento"),
    });
  }, [companyId]);

  useEffect(() => {
    if (!configsQuery.data || !companyId) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const purpose of PURPOSES) {
        const effective = resolveEffectivePrinterConfig(companyId, configsQuery.data!, purpose);
        next[purpose] = draftFromConfig(purpose, effective ?? undefined);
      }
      return next;
    });
  }, [configsQuery.data, companyId]);

  const saveMutation = useMutation({
    mutationFn: async (purpose: PrinterPurpose) => {
      const draft = drafts[purpose];
      saveTerminalPrinterOverride(companyId!, purpose, {
        printerName: draft.printerName,
        format: draft.format,
        widthMm: draft.width ? Number(draft.width) : null,
        heightMm: draft.height ? Number(draft.height) : null,
        orientation: "retrato",
        bobinaProfileId: purpose === "etiqueta" ? (draft.bobinaProfileId || null) : null,
      });
      if (setAsCompanyDefault[purpose]) {
        await savePrinterConfig(companyId!, {
          purpose,
          printerName: draft.printerName,
          format: draft.format,
          widthMm: draft.width ? Number(draft.width) : undefined,
          heightMm: draft.height ? Number(draft.height) : undefined,
          bobinaProfileId: purpose === "etiqueta" ? (draft.bobinaProfileId || null) : undefined,
        });
      }
    },
    onSuccess: async (_result, purpose) => {
      setTerminalOverrideActive((current) => ({ ...current, [purpose]: true }));
      if (setAsCompanyDefault[purpose]) {
        await queryClient.invalidateQueries({ queryKey: ["printer-configs", companyId] });
      }
      toast({
        title: "Configuração salva neste terminal",
        description: setAsCompanyDefault[purpose] ? "Também definida como padrão da empresa." : undefined,
      });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }),
  });

  function handleClearOverride(purpose: PrinterPurpose) {
    if (!companyId) return;
    clearTerminalPrinterOverride(companyId, purpose);
    setTerminalOverrideActive((current) => ({ ...current, [purpose]: false }));
    // Override is gone, so this now resolves straight to the company default.
    const fallback = resolveEffectivePrinterConfig(companyId, configsQuery.data ?? [], purpose);
    setDrafts((current) => ({ ...current, [purpose]: draftFromConfig(purpose, fallback ?? undefined) }));
    toast({ title: "Configuração deste terminal removida", description: "Este terminal volta a usar o padrão da empresa." });
  }

  const testPrintMutation = useMutation({
    mutationFn: async (purpose: PrinterPurpose) => {
      const config = getEffectiveConfig(purpose);
      // Etiqueta goes through the exact same bobina pipeline a real batch
      // uses (printBobinaTestPage - section 11 of the request), not the
      // generic single-box test page below. cupom/documento are untouched.
      if (purpose === "etiqueta") {
        const profile = resolveBobinaProfile(bobinaProfilesQuery.data ?? [], config?.perfil_bobina_padrao_id)
          ?? legacyProfileFromModel({
            largura_mm: config?.largura_mm ?? DEFAULT_FORMAT.etiqueta.width ?? 50,
            altura_mm: config?.altura_mm ?? DEFAULT_FORMAT.etiqueta.height ?? 30,
          });
        await printBobinaTestPage(companyId!, profile);
        return;
      }
      const { widthMm, heightMm } = testPrintSizeMm(purpose, config);
      await printHtmlDocument({
        companyId: companyId!,
        purpose,
        documentName: `Teste - ${PRINTER_PURPOSE_LABELS[purpose]}`,
        widthMm: purpose === "documento" ? 210 : undefined,
        heightMm: purpose === "documento" ? 297 : undefined,
        dynamicHeight: purpose === "cupom",
        paginate: false,
        html: (layout) => buildTestHtml(purpose, config, {
          widthMm: layout.widthMm,
          heightMm: layout.heightMm ?? heightMm,
        }),
      });
    },
    onSuccess: (_result, purpose) => {
      if (!desktop) return;
      const config = getEffectiveConfig(purpose);
      toast({ title: "Teste enviado para a impressora", description: config?.nome_impressora });
    },
    onError: (error: Error) => toast({ title: "Não foi possível testar a impressão", description: error.message, variant: "destructive" }),
  });

  const handleTestPrint = (purpose: PrinterPurpose) => testPrintMutation.mutate(purpose);

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
            const config = getEffectiveConfig(purpose);
            const draft = drafts[purpose];
            const hasOverride = terminalOverrideActive[purpose];
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
                  {hasOverride ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs">
                      <span>Configuração específica deste terminal</span>
                      {permissions.configurar && (
                        <Button
                          type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
                          onClick={() => handleClearOverride(purpose)}
                        >
                          Usar padrão da empresa
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Usando a configuração padrão da empresa neste terminal.</p>
                  )}
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
                  {purpose === "etiqueta" && (
                    <div className="space-y-2">
                      <Label htmlFor={`bobina-profile-${purpose}`}>Perfil de bobina</Label>
                      <Select
                        value={draft.bobinaProfileId || "none"}
                        onValueChange={(value) => setDrafts((current) => ({ ...current, etiqueta: { ...current.etiqueta, bobinaProfileId: value === "none" ? "" : value } }))}
                        disabled={!permissions.configurar}
                      >
                        <SelectTrigger id={`bobina-profile-${purpose}`}><SelectValue placeholder="Nenhum (usa o tamanho do modelo)" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhum (usa o tamanho do modelo)</SelectItem>
                          {(bobinaProfilesQuery.data ?? []).map((bobinaProfile) => (
                            <SelectItem key={bobinaProfile.id} value={bobinaProfile.id}>
                              {bobinaProfile.nome} · {Number(bobinaProfile.largura_etiqueta_mm)}×{Number(bobinaProfile.altura_etiqueta_mm)}mm · {bobinaProfile.colunas} col.
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Uma mesma impressora pode trocar de perfil quando a bobina física é trocada.</p>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 pt-2">
                    {permissions.configurar && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`company-default-${purpose}`}
                          checked={setAsCompanyDefault[purpose]}
                          onCheckedChange={(checked) =>
                            setSetAsCompanyDefault((current) => ({ ...current, [purpose]: checked === true }))}
                        />
                        <Label htmlFor={`company-default-${purpose}`} className="text-xs font-normal text-muted-foreground">
                          Definir também como padrão da empresa
                        </Label>
                      </div>
                    )}
                    <div className="flex gap-2">
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
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <BobinaProfilesSection companyId={companyId} canManage={permissions.configurar} />
    </div>
  );
}
