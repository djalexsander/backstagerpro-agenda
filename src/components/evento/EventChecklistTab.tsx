import { useState } from "react";
import { useEventChecklist, CHECKLIST_CATEGORIES, type ChecklistCategory } from "@/hooks/useEventChecklist";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, CheckCircle2, Circle, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ChecklistPdfImport } from "./ChecklistPdfImport";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Props {
  eventId: string;
}

export function EventChecklistTab({ eventId }: Props) {
  const { isAdmin, empresaId } = useAuth();
  const { toast } = useToast();
  const {
    isLoading, addItem, toggleItem, deleteItem, batchAddItems,
    total, concluidos, progress, byCategory, items,
  } = useEventChecklist(eventId);

  const [newDesc, setNewDesc] = useState("");
  const [newCat, setNewCat] = useState<ChecklistCategory>("observacoes_gerais");
  const [newObs, setNewObs] = useState("");
  const [showForm, setShowForm] = useState(false);

  const handleAdd = async () => {
    if (!newDesc.trim()) return;
    try {
      await addItem.mutateAsync({ descricao: newDesc.trim(), categoria: newCat, observacao: newObs.trim() || undefined });
      setNewDesc("");
      setNewObs("");
      toast({ title: "Item adicionado ao checklist" });
    } catch {
      toast({ title: "Erro ao adicionar item", variant: "destructive" });
    }
  };

  const handleToggle = async (id: string, current: boolean) => {
    try {
      await toggleItem.mutateAsync({ id, concluido: !current });
    } catch {
      toast({ title: "Erro ao atualizar item", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteItem.mutateAsync(id);
      toast({ title: "Item removido" });
    } catch {
      toast({ title: "Erro ao remover item", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-lg">Checklist Técnico</h3>
            </div>
            <Badge variant={progress === 100 ? "default" : "secondary"} className="text-sm">
              {concluidos}/{total} concluídos
            </Badge>
          </div>
          <Progress value={progress} className="h-3" />
          <p className="text-xs text-muted-foreground mt-1">{progress}% completo</p>
        </CardContent>
      </Card>

      {/* Add Item Form */}
      {isAdmin && (
        <Card>
          <CardContent className="pt-6">
            {!showForm ? (
              <Button onClick={() => setShowForm(true)} variant="outline" className="w-full">
                <Plus className="h-4 w-4 mr-2" /> Adicionar Item ao Checklist
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Select value={newCat} onValueChange={(v) => setNewCat(v as ChecklistCategory)}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHECKLIST_CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Descrição do item..."
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  />
                </div>
                <Textarea
                  placeholder="Observação (opcional)"
                  value={newObs}
                  onChange={(e) => setNewObs(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setNewDesc(""); setNewObs(""); }}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleAdd} disabled={!newDesc.trim() || addItem.isPending}>
                    <Plus className="h-4 w-4 mr-1" /> Adicionar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Checklist by Category */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum item no checklist.</p>
            {isAdmin && <p className="text-sm mt-1">Adicione itens para organizar a produção técnica do evento.</p>}
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" defaultValue={byCategory.map(c => c.value)} className="space-y-2">
          {byCategory.map(cat => (
            <AccordionItem key={cat.value} value={cat.value} className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{cat.label}</span>
                  <Badge variant={cat.concluidos === cat.total ? "default" : "outline"} className="text-xs">
                    {cat.concluidos}/{cat.total}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pb-2">
                  {cat.items.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 p-3 rounded-md border transition-colors ${
                        item.concluido ? "bg-accent/30 border-accent/50" : "bg-background border-border"
                      }`}
                    >
                      <Checkbox
                        checked={item.concluido}
                        onCheckedChange={() => handleToggle(item.id, item.concluido)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${item.concluido ? "line-through text-muted-foreground" : ""}`}>
                          {item.descricao}
                        </p>
                        {item.observacao && (
                          <p className="text-xs text-muted-foreground mt-1">{item.observacao}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.concluido ? (
                          <CheckCircle2 className="h-4 w-4 text-accent-foreground" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground/40" />
                        )}
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
