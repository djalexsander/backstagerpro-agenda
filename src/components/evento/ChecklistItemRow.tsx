import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Pencil, Check, X, CheckCircle2, Circle } from "lucide-react";
import type { ChecklistItem } from "@/hooks/useEventChecklist";

interface Props {
  item: ChecklistItem;
  isAdmin: boolean;
  onToggle: (id: string, current: boolean) => void;
  onUpdate: (id: string, data: { descricao?: string; observacao?: string }) => Promise<void>;
  onDelete: (id: string) => void;
}

export function ChecklistItemRow({ item, isAdmin, onToggle, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [editDesc, setEditDesc] = useState(item.descricao);
  const [editObs, setEditObs] = useState(item.observacao || "");

  const handleSave = async () => {
    await onUpdate(item.id, {
      descricao: editDesc.trim() || item.descricao,
      observacao: editObs.trim() || undefined,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditDesc(item.descricao);
    setEditObs(item.observacao || "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="p-3 rounded-md border bg-muted/20 space-y-2">
        <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="text-sm" placeholder="Descrição" />
        <Textarea value={editObs} onChange={(e) => setEditObs(e.target.value)} rows={2} className="text-sm" placeholder="Observação (opcional)" />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={handleCancel}><X className="h-3.5 w-3.5 mr-1" /> Cancelar</Button>
          <Button size="sm" onClick={handleSave}><Check className="h-3.5 w-3.5 mr-1" /> Salvar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-3 p-3 rounded-md border transition-colors ${item.concluido ? "bg-accent/30 border-accent/50" : "bg-background border-border"}`}>
      <Checkbox checked={item.concluido} onCheckedChange={() => onToggle(item.id, item.concluido)} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${item.concluido ? "line-through text-muted-foreground" : ""}`}>{item.descricao}</p>
        {item.observacao && <p className="text-xs text-muted-foreground mt-1">{item.observacao}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {item.concluido ? <CheckCircle2 className="h-4 w-4 text-accent-foreground" /> : <Circle className="h-4 w-4 text-muted-foreground/40" />}
        {isAdmin && (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDelete(item.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
