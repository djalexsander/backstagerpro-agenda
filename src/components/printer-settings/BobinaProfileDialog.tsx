import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { saveBobinaProfile } from "@/lib/bobina-profile-service";
import {
  BLANK_BOBINA_PROFILE_INPUT,
  bobinaProfileToFormInput,
  saveInputToLayoutInput,
  type BobinaProfile,
  type SaveBobinaProfileInput,
} from "@/lib/bobina-profile-types";
import { BOBINA_DPI_LABELS, BOBINA_DPI_MODES, validateBobinaProfile, type BobinaDpiMode } from "@/lib/label-layout-engine";
import type { PrinterOrientation } from "@/lib/printer-types";
import { BobinaPreview } from "./BobinaPreview";

export function BobinaProfileDialog({ open, onOpenChange, companyId, profile, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; companyId: string; profile: BobinaProfile | null; onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<SaveBobinaProfileInput>(BLANK_BOBINA_PROFILE_INPUT);

  useEffect(() => {
    if (!open) return;
    setForm(profile ? bobinaProfileToFormInput(profile) : BLANK_BOBINA_PROFILE_INPUT);
  }, [open, profile]);

  const update = <K extends keyof SaveBobinaProfileInput>(key: K, value: SaveBobinaProfileInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const mutation = useMutation({
    mutationFn: () => saveBobinaProfile(companyId, form),
    onSuccess: async () => {
      await onSaved();
      toast({ title: profile ? "Perfil de bobina atualizado" : "Perfil de bobina criado" });
      onOpenChange(false);
    },
    onError: (error: Error) => toast({ title: "Não foi possível salvar o perfil", description: error.message, variant: "destructive" }),
  });

  const layoutInput = saveInputToLayoutInput(form);
  const error = validateBobinaProfile(layoutInput);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{profile ? "Editar perfil de bobina" : "Novo perfil de bobina"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-[1.15fr_1fr]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do perfil</Label>
              <Input value={form.nome} onChange={(event) => update("nome", event.target.value)} placeholder='Ex.: "50x30 - 2 colunas"' />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Largura da etiqueta (mm)</Label>
                <Input type="number" min={0.1} step={0.1} value={form.larguraEtiquetaMm} onChange={(event) => update("larguraEtiquetaMm", Number(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Altura da etiqueta (mm)</Label>
                <Input type="number" min={0.1} step={0.1} value={form.alturaEtiquetaMm} onChange={(event) => update("alturaEtiquetaMm", Number(event.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Etiquetas por linha (colunas)</Label>
                <Input type="number" min={1} max={20} step={1} value={form.colunas} onChange={(event) => update("colunas", Math.round(Number(event.target.value)))} />
              </div>
              <div className="space-y-2">
                <Label>Orientação</Label>
                <Select value={form.orientacao} onValueChange={(value) => update("orientacao", value as PrinterOrientation)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retrato">Retrato</SelectItem>
                    <SelectItem value="paisagem">Paisagem</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Espaçamento horizontal (mm)</Label>
                <Input type="number" min={0} step={0.1} value={form.espacamentoHorizontalMm} onChange={(event) => update("espacamentoHorizontalMm", Number(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Espaçamento vertical / gap (mm)</Label>
                <Input type="number" min={0} step={0.1} value={form.espacamentoVerticalMm} onChange={(event) => update("espacamentoVerticalMm", Number(event.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Margem esquerda (mm)</Label>
                <Input type="number" min={0} step={0.1} value={form.margemEsquerdaMm} onChange={(event) => update("margemEsquerdaMm", Number(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Margem direita (mm)</Label>
                <Input type="number" min={0} step={0.1} value={form.margemDireitaMm} onChange={(event) => update("margemDireitaMm", Number(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Margem superior (mm)</Label>
                <Input type="number" min={0} step={0.1} value={form.margemSuperiorMm} onChange={(event) => update("margemSuperiorMm", Number(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Margem inferior (mm)</Label>
                <Input type="number" min={0} step={0.1} value={form.margemInferiorMm} onChange={(event) => update("margemInferiorMm", Number(event.target.value))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Largura total da mídia/bobina (mm) <span className="font-normal text-xs text-muted-foreground">(opcional - valida se as colunas cabem)</span></Label>
              <Input
                type="number" min={0} step={0.1} value={form.larguraMidiaMm ?? ""}
                onChange={(event) => update("larguraMidiaMm", event.target.value ? Number(event.target.value) : null)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Offset horizontal - calibração (mm)</Label>
                <Input type="number" step={0.1} value={form.offsetHorizontalMm} onChange={(event) => update("offsetHorizontalMm", Number(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Offset vertical - calibração (mm)</Label>
                <Input type="number" step={0.1} value={form.offsetVerticalMm} onChange={(event) => update("offsetVerticalMm", Number(event.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Densidade (DPI)</Label>
                <Select value={form.dpi} onValueChange={(value) => update("dpi", value as BobinaDpiMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BOBINA_DPI_MODES.map((mode) => <SelectItem key={mode} value={mode}>{BOBINA_DPI_LABELS[mode]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.dpi === "personalizado" && (
                <div className="space-y-2">
                  <Label>DPI personalizado</Label>
                  <Input
                    type="number" min={72} max={1200} value={form.dpiPersonalizado ?? ""}
                    onChange={(event) => update("dpiPersonalizado", event.target.value ? Number(event.target.value) : null)}
                  />
                </div>
              )}
            </div>
            <label className="flex items-center justify-between text-sm">
              Definir como perfil padrão
              <Switch checked={form.padrao} onCheckedChange={(checked) => update("padrao", checked)} />
            </label>
          </div>
          <div className="flex flex-col items-center justify-start gap-3 rounded-md border border-dashed p-4">
            <p className="text-xs font-medium text-muted-foreground">Pré-visualização</p>
            <BobinaPreview profile={layoutInput} />
            <p className="text-center text-xs text-muted-foreground">A prévia usa o mesmo cálculo de layout da impressão real.</p>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={Boolean(error) || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Salvando..." : "Salvar perfil"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
