import { useState } from "react";
import { useEventChecklist, CHECKLIST_CATEGORIES, type ChecklistCategory } from "@/hooks/useEventChecklist";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Plus, ClipboardList, FileText, FileImage, Upload, ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ChecklistPdfImport } from "./ChecklistPdfImport";
import { ChecklistItemRow } from "./ChecklistItemRow";
import { ChecklistExportModal } from "./ChecklistExportModal";
import { exportChecklistPDF } from "@/lib/pdf-export-checklist";
import type { ExportFormat } from "@/lib/pdf-export";

interface Props {
  eventId: string;
  eventName?: string;
}

export function EventChecklistTab({ eventId, eventName }: Props) {
  const { isAdmin, empresaId } = useAuth();
  const { toast } = useToast();
  const {
    items, isLoading, addItem, toggleItem, updateItem, deleteItem, batchAddItems,
    total, concluidos, progress, byCategory,
  } = useEventChecklist(eventId);

  const [newDesc, setNewDesc] = useState("");
  const [newCat, setNewCat] = useState<ChecklistCategory>("observacoes_gerais");
  const [newObs, setNewObs] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");

  // Branding
  const { data: empresa } = useQuery({
    queryKey: ["empresa-branding", empresaId],
    queryFn: async () => {
      if (!empresaId) return null;
      const { data } = await supabase.from("empresas").select("nome_empresa, logo_url").eq("id", empresaId).single();
      return data;
    },
    enabled: !!empresaId,
  });

  const pendentes = total - concluidos;

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
    try { await toggleItem.mutateAsync({ id, concluido: !current }); } catch {
      toast({ title: "Erro ao atualizar item", variant: "destructive" });
    }
  };

  const handleUpdate = async (id: string, data: { descricao?: string; observacao?: string }) => {
    try { await updateItem.mutateAsync({ id, ...data }); toast({ title: "Item atualizado" }); } catch {
      toast({ title: "Erro ao atualizar item", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try { await deleteItem.mutateAsync(id); toast({ title: "Item removido" }); } catch {
      toast({ title: "Erro ao remover item", variant: "destructive" });
    }
  };

  const openExport = (fmt: ExportFormat) => {
    setExportFormat(fmt);
    setExportOpen(true);
  };

  const handleExport = async (filter: { mode: "completo" | "por_categoria" | "pendentes" | "concluidos"; categoria?: string }) => {
    try {
      await exportChecklistPDF({
        items,
        eventName: eventName || "Evento",
        format: exportFormat,
        branding: { empresaNome: empresa?.nome_empresa, empresaLogoUrl: empresa?.logo_url },
        filter,
      });
    } catch {
      toast({ title: "Erro ao exportar checklist", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <ClipboardList className="h-5 w-5 text-primary shrink-0" />
              <div>
                <h3 className="font-semibold text-lg leading-tight">Checklist Técnico</h3>
                {eventName && <p className="text-xs text-muted-foreground truncate">{eventName}</p>}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">{total} itens</Badge>
              <Badge variant="default" className="text-xs">{concluidos} concluídos</Badge>
              <Badge variant="secondary" className="text-xs">{pendentes} pendentes</Badge>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Progress value={progress} className="h-2.5 flex-1" />
            <span className="text-xs font-medium text-muted-foreground w-10 text-right">{progress}%</span>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={() => openExport("pdf")}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => openExport("png")}>
              <FileImage className="h-4 w-4 mr-1" /> PNG
            </Button>
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar Item
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add Item Form */}
      {isAdmin && showAddForm && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex gap-2">
              <Select value={newCat} onValueChange={(v) => setNewCat(v as ChecklistCategory)}>
                <SelectTrigger className="w-[180px]">
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
            <Textarea placeholder="Observação (opcional)" value={newObs} onChange={(e) => setNewObs(e.target.value)} rows={2} />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setShowAddForm(false); setNewDesc(""); setNewObs(""); }}>Cancelar</Button>
              <Button size="sm" onClick={handleAdd} disabled={!newDesc.trim() || addItem.isPending}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import */}
      {isAdmin && empresaId && (
        <ChecklistPdfImport eventId={eventId} empresaId={empresaId} onImportItems={batchAddItems} />
      )}

      {/* Items by Category */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum item no checklist.</p>
            {isAdmin && <p className="text-sm mt-1">Adicione itens manualmente ou importe uma lista de material.</p>}
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
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      isAdmin={isAdmin}
                      onToggle={handleToggle}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {/* Export Modal */}
      <ChecklistExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        format={exportFormat}
        eventName={eventName || "Evento"}
        categories={byCategory.map(c => ({ value: c.value, label: c.label }))}
        onConfirm={handleExport}
      />
    </div>
  );
}
