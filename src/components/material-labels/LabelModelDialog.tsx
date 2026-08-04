import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_LABEL_FIELDS, LABEL_FIELD_LABELS, LABEL_IDENTIFICATION_LABELS, LABEL_SIZE_PRESETS, validateLabelModel } from "@/lib/material-label-domain";
import { saveLabelModel } from "@/lib/material-label-service";
import type { LabelField, LabelIdentificationType, LabelModel } from "@/lib/material-label-types";

export function LabelModelDialog({ open, onOpenChange, companyId, model, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; companyId: string; model: LabelModel | null; onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [width, setWidth] = useState(60); const [height, setHeight] = useState(40);
  const [type, setType] = useState<LabelIdentificationType>("qr_code");
  const [fields, setFields] = useState<LabelField[]>(DEFAULT_LABEL_FIELDS);
  const [fontSize, setFontSize] = useState(10); const [border, setBorder] = useState(false); const [isDefault, setIsDefault] = useState(false);
  const [innerMargin, setInnerMargin] = useState(1.5); const [innerGap, setInnerGap] = useState(1.5);
  useEffect(() => { if (!open) return; setName(model?.nome ?? ""); setDescription(model?.descricao ?? ""); setWidth(Number(model?.largura_mm ?? 60)); setHeight(Number(model?.altura_mm ?? 40)); setType(model?.tipo_identificacao ?? "qr_code"); setFields(model?.campos ?? DEFAULT_LABEL_FIELDS); setFontSize(model?.tamanho_fonte ?? 10); setBorder(model?.mostrar_borda ?? false); setIsDefault(model?.padrao ?? false); setInnerMargin(Number(model?.margem_interna_mm ?? 1.5)); setInnerGap(Number(model?.espacamento_interno_mm ?? 1.5)); }, [open, model]);
  const mutation = useMutation({
    mutationFn: () => saveLabelModel(companyId, { id: model?.id, expectedUpdatedAt: model?.updated_at, name, description, widthMm: width, heightMm: height, identificationType: type, fields, fontSize, showBorder: border, isDefault, innerMarginMm: innerMargin, innerGapMm: innerGap }),
    onSuccess: async () => { await onSaved(); toast({ title: model ? "Modelo atualizado" : "Modelo criado" }); onOpenChange(false); },
    onError: (error: Error) => toast({ title: "Não foi possível salvar o modelo", description: error.message, variant: "destructive" }),
  });
  const error = validateLabelModel({ name, widthMm: width, heightMm: height, fontSize, fields, innerMarginMm: innerMargin, innerGapMm: innerGap });
  const toggleField = (field: LabelField, checked: boolean) => setFields((current) => checked ? [...current, field] : current.filter((value) => value !== field));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{model ? "Editar modelo" : "Novo modelo de etiqueta"}</DialogTitle></DialogHeader>
    <div className="grid gap-4 py-2 sm:grid-cols-2">
      <div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="space-y-2"><Label>Preset de tamanho</Label><Select onValueChange={(value) => { const preset = LABEL_SIZE_PRESETS[Number(value)]; setWidth(preset.width); setHeight(preset.height); }}><SelectTrigger><SelectValue placeholder="Escolha opcionalmente" /></SelectTrigger><SelectContent>{LABEL_SIZE_PRESETS.map((preset, index) => <SelectItem key={preset.name} value={String(index)}>{preset.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2 sm:col-span-2"><Label>Descrição</Label><Input value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Largura (mm)</Label><Input type="number" min={20} max={210} value={width} onChange={(event) => setWidth(Number(event.target.value))} /></div><div className="space-y-2"><Label>Altura (mm)</Label><Input type="number" min={10} max={297} value={height} onChange={(event) => setHeight(Number(event.target.value))} /></div></div>
      <div className="space-y-2"><Label>Identificação</Label><Select value={type} onValueChange={(value) => setType(value as LabelIdentificationType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(LABEL_IDENTIFICATION_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2 sm:col-span-2"><Label>Campos, na ordem de exibição</Label><div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">{Object.entries(LABEL_FIELD_LABELS).map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><Checkbox checked={fields.includes(value as LabelField)} onCheckedChange={(checked) => toggleField(value as LabelField, checked === true)} />{label}</label>)}</div></div>
      <div className="space-y-2"><Label>Tamanho da fonte (pt)</Label><Input type="number" min={6} max={24} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Margem interna (mm)</Label><Input type="number" min={0} max={10} step={0.25} value={innerMargin} onChange={(event) => setInnerMargin(Number(event.target.value))} /></div><div className="space-y-2"><Label>Espaçamento interno (mm)</Label><Input type="number" min={0} max={10} step={0.25} value={innerGap} onChange={(event) => setInnerGap(Number(event.target.value))} /></div></div>
      <div className="flex flex-col justify-end gap-3"><label className="flex items-center justify-between text-sm">Mostrar borda <Switch checked={border} onCheckedChange={setBorder} /></label><label className="flex items-center justify-between text-sm">Modelo padrão <Switch checked={isDefault} onCheckedChange={setIsDefault} /></label></div>
      <p className="text-xs text-muted-foreground sm:col-span-2">A escala e margens físicas finais dependem do navegador, driver e impressora.</p>
    </div>
    {error && <p className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={Boolean(error) || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Salvando..." : "Salvar modelo"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
