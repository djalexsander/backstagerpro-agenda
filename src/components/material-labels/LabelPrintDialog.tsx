import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { BobinaPreview } from "@/components/printer-settings/BobinaPreview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { listBobinaProfiles, resolveBobinaProfile } from "@/lib/bobina-profile-service";
import { computeSheetGeometry, legacyProfileFromModel } from "@/lib/label-layout-engine";
import { labelBatchTotal, labelModelToSnapshot, materialToLabelSnapshot } from "@/lib/material-label-domain";
import { printLabelBatch } from "@/lib/material-label-print";
import { registerLabelPrintBatch } from "@/lib/material-label-service";
import type { LabelBatchSelection, LabelModel } from "@/lib/material-label-types";
import { getConfiguredPrinter, isDesktopRuntime, listPrinterConfigs, resolveEffectivePrinterConfig } from "@/lib/printer-service";
import { LabelCanvas } from "./LabelCanvas";

const MAX_PREVIEW_ROWS = 24;

export function LabelPrintDialog({ open, onOpenChange, companyId, companyName, model, items, onPrinted }: {
  open: boolean; onOpenChange: (open: boolean) => void; companyId: string; companyName: string;
  model: LabelModel | null; items: LabelBatchSelection[]; onPrinted: () => Promise<void>;
}) {
  const { toast } = useToast();
  const total = labelBatchTotal(items);
  const preview = useMemo(() => items.map((item) => ({
    key: item.material.id, quantity: item.quantity, material: materialToLabelSnapshot(item.material, companyName),
  })), [items, companyName]);

  // Resolved on both desktop and web (unlike getConfiguredPrinter below,
  // these two reads never throw when nothing is configured yet), so the
  // exact same profile drives the layout preview and the real print job
  // everywhere - not just on desktop, and not a second calculation for the
  // preview (see computeSheetGeometry usage further down).
  const printerConfigsQuery = useQuery({
    queryKey: ["printer-configs", companyId],
    queryFn: () => listPrinterConfigs(companyId),
    enabled: open && Boolean(companyId),
  });
  const bobinaProfilesQuery = useQuery({
    queryKey: ["bobina-profiles", companyId],
    queryFn: () => listBobinaProfiles(companyId),
    enabled: open && Boolean(companyId),
  });
  const effectivePrinterConfig = resolveEffectivePrinterConfig(companyId, printerConfigsQuery.data ?? [], "etiqueta");
  const linkedProfileId = effectivePrinterConfig?.perfil_bobina_padrao_id;
  const bobinaProfiles = bobinaProfilesQuery.data ?? [];
  const resolvedProfile = resolveBobinaProfile(bobinaProfiles, linkedProfileId) ?? bobinaProfiles.find((candidate) => candidate.padrao) ?? null;
  const effectiveProfile = model ? (resolvedProfile ?? legacyProfileFromModel(model)) : null;

  const flatPreviewNames = useMemo(
    () => items.flatMap((item) => Array.from({ length: item.quantity }, () => item.material.nome)),
    [items],
  );
  const geometry = effectiveProfile ? computeSheetGeometry(effectiveProfile) : null;
  const totalRows = geometry ? Math.max(1, Math.ceil(flatPreviewNames.length / geometry.columns)) : 1;
  const previewRows = Math.min(totalRows, MAX_PREVIEW_ROWS);

  // One client_uuid per dialog opening, reused across retries within it
  // (not regenerated per mutate() call): registrar_solicitacao_impressao_lote_etiquetas
  // is idempotent by client_uuid (see docs/stage-6-physical-printing-homologation.md,
  // "simular retry com a mesma chave idempotente"), so if the desktop print
  // step fails *after* the batch is already registered, clicking the button
  // again reuses the same batch instead of registering a duplicate history row.
  const clientUuidRef = useRef<string>();
  useEffect(() => { if (open) clientUuidRef.current = crypto.randomUUID(); }, [open]);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!model || !items.length || total < 1 || items.some((item) => item.quantity < 1 || item.quantity > 500)) throw new Error("Revise o modelo, os materiais e as quantidades.");
      const clientUuid = clientUuidRef.current ?? crypto.randomUUID();

      const configuredPrinter = isDesktopRuntime()
        ? await getConfiguredPrinter(companyId, "etiqueta")
        : undefined;
      const printProfile = configuredPrinter
        ? resolveBobinaProfile(bobinaProfiles, configuredPrinter.perfil_bobina_padrao_id)
          ?? bobinaProfiles.find((candidate) => candidate.padrao)
          ?? null
        : resolvedProfile;
      const record = await registerLabelPrintBatch(companyId, { model, items, clientUuid });
      await printLabelBatch(companyId, record, configuredPrinter, printProfile);
      return record;
    },
    onSuccess: async () => { await onPrinted(); toast({ title: "Lote de impressão solicitado", description: "Uma única solicitação registrou todos os materiais e snapshots." }); onOpenChange(false); },
    onError: (error: Error) => toast({ title: "Não foi possível imprimir", description: error.message, variant: "destructive" }),
  });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>Pré-visualizar lote e imprimir</DialogTitle></DialogHeader>
    {model && effectiveProfile && <div className="space-y-4"><div className="rounded-md border p-3 text-sm"><strong>{items.length} material(is) · {total} etiqueta(s)</strong>{items.map((item) => <p key={item.material.id}>{item.material.nome} × {item.quantity}</p>)}</div>
      <div className="grid gap-4 rounded-md bg-muted p-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Layout na bobina {resolvedProfile ? `— ${resolvedProfile.nome}` : "— nenhum perfil selecionado, imprimindo em 1 coluna"}
          </p>
          <div className="max-h-[45vh] overflow-auto rounded-md bg-background p-2">
            <BobinaPreview
              profile={effectiveProfile}
              rows={previewRows}
              cellLabel={(row, column) => flatPreviewNames[row * (geometry?.columns ?? 1) + column] ?? ""}
            />
          </div>
          {totalRows > previewRows && <p className="text-center text-[11px] text-muted-foreground">Mostrando as primeiras {previewRows} de {totalRows} linhas.</p>}
        </div>
        {preview[0] && <div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">Conteúdo da etiqueta</p><div className="w-fit bg-white shadow"><LabelCanvas model={labelModelToSnapshot(model)} material={preview[0].material} scale={0.72} /></div></div>}
      </div>
      <p className="text-center text-xs text-muted-foreground">A prévia usa o mesmo cálculo de layout da impressão real. A escala e margens físicas finais dependem do navegador, driver e impressora.</p></div>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={!model || !items.length || total < 1 || total > 5000 || mutation.isPending} onClick={() => mutation.mutate()}><Printer className="mr-2 h-4 w-4" />{mutation.isPending ? "Preparando..." : "Registrar lote e imprimir"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
