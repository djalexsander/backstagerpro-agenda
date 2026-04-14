import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FileImage, FileText, Loader2 } from "lucide-react";
import type { ExportFormat } from "@/lib/pdf-export";

type FilterMode = "completo" | "por_categoria" | "pendentes" | "concluidos";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format: ExportFormat;
  eventName: string;
  categories: { value: string; label: string }[];
  onConfirm: (filter: { mode: FilterMode; categoria?: string }) => Promise<void>;
}

export function ChecklistExportModal({ open, onOpenChange, format, eventName, categories, onConfirm }: Props) {
  const [mode, setMode] = useState<FilterMode>("completo");
  const [selectedCat, setSelectedCat] = useState(categories[0]?.value || "");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm({ mode, categoria: mode === "por_categoria" ? selectedCat : undefined });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const Icon = format === "png" ? FileImage : FileText;
  const label = format === "png" ? "PNG" : "PDF";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            Exportar Checklist em {label}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{eventName}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Filtro de exportação</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as FilterMode)} className="space-y-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="completo" id="exp-completo" />
                <Label htmlFor="exp-completo" className="font-normal cursor-pointer">Checklist completo</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="por_categoria" id="exp-cat" />
                <Label htmlFor="exp-cat" className="font-normal cursor-pointer">Por categoria</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pendentes" id="exp-pend" />
                <Label htmlFor="exp-pend" className="font-normal cursor-pointer">Somente pendentes</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="concluidos" id="exp-done" />
                <Label htmlFor="exp-done" className="font-normal cursor-pointer">Somente concluídos</Label>
              </div>
            </RadioGroup>
          </div>

          {mode === "por_categoria" && categories.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Categoria</Label>
              <RadioGroup value={selectedCat} onValueChange={setSelectedCat} className="space-y-1.5">
                {categories.map((c) => (
                  <div key={c.value} className="flex items-center gap-2">
                    <RadioGroupItem value={c.value} id={`cat-${c.value}`} />
                    <Label htmlFor={`cat-${c.value}`} className="font-normal cursor-pointer">{c.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Icon className="h-4 w-4 mr-1" />}
            Gerar {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
