import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, TrendingUp, TrendingDown, DollarSign, Pencil, Trash2, FileDown, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportFinancialPDF, exportFinancialTotalPDF } from "@/lib/pdf-export";
import { parseISO, isWithinInterval, startOfMonth, endOfMonth, format } from "date-fns";

const fieldLabels: Record<string, string> = {
  cache: "Cachê",
  transport: "Transporte",
  food: "Alimentação",
  lodging: "Hospedagem",
  other_costs: "Outros Custos",
};

const fieldKeys = ["cache", "transport", "food", "lodging", "other_costs"] as const;

export default function Financeiro() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { empresaId } = useAuth();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [form, setForm] = useState({ cache: "", transport: "", food: "", lodging: "", other_costs: "" });
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "month" | "period">("all");
  const [exportMonth, setExportMonth] = useState(format(new Date(), "yyyy-MM"));
  const [exportStart, setExportStart] = useState("");
  const [exportEnd, setExportEnd] = useState("");

  const { data: financials = [] } = useQuery({
    queryKey: ["financials", empresaId],
    queryFn: async () => {
      let query = supabase.from("financials").select("*, events(name, artist, date)").order("created_at", { ascending: false });
      if (empresaId) query = query.eq("empresa_id", empresaId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: events = [] } = useQuery({
    queryKey: ["events-list", empresaId],
    queryFn: async () => {
      let query = supabase.from("events").select("id, name").order("date", { ascending: false });
      if (empresaId) query = query.eq("empresa_id", empresaId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const eventsWithoutFinancials = events.filter(
    (e) => !financials.some((f) => f.event_id === e.id) || (editItem && editItem.event_id === e.id)
  );

  const openAdd = () => {
    setEditItem(null);
    setSelectedEvent("");
    setForm({ cache: "", transport: "", food: "", lodging: "", other_costs: "" });
    setOpen(true);
  };

  const openEdit = (f: any) => {
    setEditItem(f);
    setSelectedEvent(f.event_id);
    setForm({
      cache: String(f.cache || 0),
      transport: String(f.transport || 0),
      food: String(f.food || 0),
      lodging: String(f.lodging || 0),
      other_costs: String(f.other_costs || 0),
    });
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        event_id: selectedEvent,
        empresa_id: empresaId,
        cache: parseFloat(form.cache) || 0,
        transport: parseFloat(form.transport) || 0,
        food: parseFloat(form.food) || 0,
        lodging: parseFloat(form.lodging) || 0,
        other_costs: parseFloat(form.other_costs) || 0,
      };

      if (editItem) {
        const { error } = await supabase.from("financials").update(payload as any).eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("financials").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financials"] });
      setOpen(false);
      setEditItem(null);
      setForm({ cache: "", transport: "", food: "", lodging: "", other_costs: "" });
      setSelectedEvent("");
      toast({ title: editItem ? "Registro atualizado!" : "Dados financeiros salvos!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("financials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financials"] });
      toast({ title: "Registro excluído!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const fmt = (n: number | null) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

  const totalCache = financials.reduce((s, f) => s + (f.cache || 0), 0);
  const totalCosts = financials.reduce((s, f) => s + (f.transport || 0) + (f.food || 0) + (f.lodging || 0) + (f.other_costs || 0), 0);
  const totalProfit = totalCache - totalCosts;

  const getProfit = (f: any) => (f.cache || 0) - (f.transport || 0) - (f.food || 0) - (f.lodging || 0) - (f.other_costs || 0);

  const getFilteredForExport = () => {
    if (exportMode === "all") return financials;
    if (exportMode === "month" && exportMonth) {
      const [y, m] = exportMonth.split("-").map(Number);
      const monthStart = startOfMonth(new Date(y, m - 1));
      const monthEnd = endOfMonth(new Date(y, m - 1));
      return financials.filter((f) => {
        const eventDate = (f as any).events?.date;
        if (!eventDate) return false;
        return isWithinInterval(parseISO(eventDate), { start: monthStart, end: monthEnd });
      });
    }
    if (exportMode === "period" && exportStart && exportEnd) {
      return financials.filter((f) => {
        const eventDate = (f as any).events?.date;
        if (!eventDate) return false;
        return isWithinInterval(parseISO(eventDate), { start: parseISO(exportStart), end: parseISO(exportEnd) });
      });
    }
    return financials;
  };

  const handleExport = () => {
    const filtered = getFilteredForExport();
    if (filtered.length === 0) {
      toast({ title: "Nenhum registro encontrado para o período selecionado.", variant: "destructive" });
      return;
    }
    let title = "Consolidado";
    if (exportMode === "month" && exportMonth) {
      const [y, m] = exportMonth.split("-");
      title = `Mês ${m}/${y}`;
    } else if (exportMode === "period" && exportStart && exportEnd) {
      title = `${exportStart.split("-").reverse().join("/")} a ${exportEnd.split("-").reverse().join("/")}`;
    }
    exportFinancialTotalPDF(filtered, title);
    setExportOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Financeiro</h1>
        <div className="flex gap-2">
          {financials.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              <FileDown className="h-4 w-4 mr-1" /> Exportar
            </Button>
          )}
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? "Editar Registro Financeiro" : "Novo Registro Financeiro"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Evento</Label>
              <Select value={selectedEvent} onValueChange={setSelectedEvent} disabled={!!editItem}>
                <SelectTrigger><SelectValue placeholder="Selecione o evento" /></SelectTrigger>
                <SelectContent>
                  {editItem ? (
                    <SelectItem value={editItem.event_id}>{(editItem as any).events?.name || "Evento"}</SelectItem>
                  ) : (
                    eventsWithoutFinancials.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)
                  )}
                </SelectContent>
              </Select>
            </div>
            {fieldKeys.map((key) => (
              <div key={key} className="space-y-2">
                <Label>{fieldLabels[key]}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form[key]}
                  onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={() => saveMutation.mutate()} disabled={!selectedEvent || saveMutation.isPending}>
              {saveMutation.isPending ? "Salvando..." : editItem ? "Atualizar" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-lg font-bold">{fmt(totalCache)}</p>
                <p className="text-xs text-muted-foreground">Total Cachê</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-lg font-bold">{fmt(totalCosts)}</p>
                <p className="text-xs text-muted-foreground">Total Custos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${totalProfit >= 0 ? "bg-accent/10" : "bg-destructive/10"}`}>
                {totalProfit >= 0 ? <TrendingUp className="h-5 w-5 text-accent" /> : <TrendingDown className="h-5 w-5 text-destructive" />}
              </div>
              <div>
                <p className={`text-lg font-bold ${totalProfit >= 0 ? "text-accent" : "text-destructive"}`}>{fmt(totalProfit)}</p>
                <p className="text-xs text-muted-foreground">Resultado</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Evento</TableHead>
              <TableHead className="text-right">Cachê</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Transporte</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Alimentação</TableHead>
              <TableHead className="text-right hidden md:table-cell">Hospedagem</TableHead>
              <TableHead className="text-right hidden md:table-cell">Outros</TableHead>
              <TableHead className="text-right">Lucro/Prejuízo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {financials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Nenhum registro financeiro.
                </TableCell>
              </TableRow>
            ) : (
              financials.map((f) => {
                const profit = getProfit(f);
                return (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{(f as any).events?.name || "—"}</TableCell>
                    <TableCell className="text-right">{fmt(f.cache)}</TableCell>
                    <TableCell className="text-right hidden sm:table-cell">{fmt(f.transport)}</TableCell>
                    <TableCell className="text-right hidden sm:table-cell">{fmt(f.food)}</TableCell>
                    <TableCell className="text-right hidden md:table-cell">{fmt(f.lodging)}</TableCell>
                    <TableCell className="text-right hidden md:table-cell">{fmt(f.other_costs)}</TableCell>
                    <TableCell className={`text-right font-semibold ${profit >= 0 ? "text-accent" : "text-destructive"}`}>
                      {fmt(profit)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => exportFinancialPDF(f)} title="Exportar PDF">
                          <FileDown className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(f)} title="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMutation.mutate(f.id)} title="Excluir">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
          {financials.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold">Total</TableCell>
                <TableCell className="text-right font-bold">{fmt(totalCache)}</TableCell>
                <TableCell className="text-right font-bold hidden sm:table-cell">{fmt(financials.reduce((s, f) => s + (f.transport || 0), 0))}</TableCell>
                <TableCell className="text-right font-bold hidden sm:table-cell">{fmt(financials.reduce((s, f) => s + (f.food || 0), 0))}</TableCell>
                <TableCell className="text-right font-bold hidden md:table-cell">{fmt(financials.reduce((s, f) => s + (f.lodging || 0), 0))}</TableCell>
                <TableCell className="text-right font-bold hidden md:table-cell">{fmt(financials.reduce((s, f) => s + (f.other_costs || 0), 0))}</TableCell>
                <TableCell className={`text-right font-bold ${totalProfit >= 0 ? "text-accent" : "text-destructive"}`}>{fmt(totalProfit)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}
