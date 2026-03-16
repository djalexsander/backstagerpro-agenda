import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Financeiro() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { empresaId } = useAuth();
  const [open, setOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [form, setForm] = useState({ cache: "", transport: "", food: "", lodging: "", other_costs: "" });

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
    queryKey: ["events", empresaId],
    queryFn: async () => {
      let query = supabase.from("events").select("id, name").order("date", { ascending: false });
      if (empresaId) query = query.eq("empresa_id", empresaId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const eventsWithoutFinancials = events.filter((e) => !financials.some((f) => f.event_id === e.id));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("financials").insert({
        event_id: selectedEvent,
        empresa_id: empresaId,
        cache: parseFloat(form.cache) || 0,
        transport: parseFloat(form.transport) || 0,
        food: parseFloat(form.food) || 0,
        lodging: parseFloat(form.lodging) || 0,
        other_costs: parseFloat(form.other_costs) || 0,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financials"] });
      setOpen(false);
      setForm({ cache: "", transport: "", food: "", lodging: "", other_costs: "" });
      setSelectedEvent("");
      toast({ title: "Dados financeiros salvos!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const fmt = (n: number | null) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

  const totalCache = financials.reduce((s, f) => s + (f.cache || 0), 0);
  const totalCosts = financials.reduce((s, f) => s + (f.transport || 0) + (f.food || 0) + (f.lodging || 0) + (f.other_costs || 0), 0);
  const totalProfit = totalCache - totalCosts;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Financeiro</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Adicionar</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Registro Financeiro</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Evento</Label>
                <Select value={selectedEvent} onValueChange={setSelectedEvent}>
                  <SelectTrigger><SelectValue placeholder="Selecione o evento" /></SelectTrigger>
                  <SelectContent>
                    {eventsWithoutFinancials.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(["cache", "transport", "food", "lodging", "other_costs"] as const).map((key) => (
                <div key={key} className="space-y-2">
                  <Label>{{ cache: "Cachê", transport: "Transporte", food: "Alimentação", lodging: "Hospedagem", other_costs: "Outros Custos" }[key]}</Label>
                  <Input type="number" step="0.01" value={form[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
              <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={!selectedEvent || saveMutation.isPending}>
                {saveMutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center"><DollarSign className="h-5 w-5 text-accent" /></div><div><p className="text-lg font-bold">{fmt(totalCache)}</p><p className="text-xs text-muted-foreground">Total Cachê</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center"><TrendingDown className="h-5 w-5 text-destructive" /></div><div><p className="text-lg font-bold">{fmt(totalCosts)}</p><p className="text-xs text-muted-foreground">Total Custos</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><div className={`h-10 w-10 rounded-lg flex items-center justify-center ${totalProfit >= 0 ? "bg-accent/10" : "bg-destructive/10"}`}>{totalProfit >= 0 ? <TrendingUp className="h-5 w-5 text-accent" /> : <TrendingDown className="h-5 w-5 text-destructive" />}</div><div><p className={`text-lg font-bold ${totalProfit >= 0 ? "text-accent" : "text-destructive"}`}>{fmt(totalProfit)}</p><p className="text-xs text-muted-foreground">Resultado</p></div></div></CardContent></Card>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {financials.map((f) => {
              const profit = (f.cache || 0) - (f.transport || 0) - (f.food || 0) - (f.lodging || 0) - (f.other_costs || 0);
              return (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{(f as any).events?.name || "—"}</TableCell>
                  <TableCell className="text-right">{fmt(f.cache)}</TableCell>
                  <TableCell className="text-right hidden sm:table-cell">{fmt(f.transport)}</TableCell>
                  <TableCell className="text-right hidden sm:table-cell">{fmt(f.food)}</TableCell>
                  <TableCell className="text-right hidden md:table-cell">{fmt(f.lodging)}</TableCell>
                  <TableCell className="text-right hidden md:table-cell">{fmt(f.other_costs)}</TableCell>
                  <TableCell className={`text-right font-semibold ${profit >= 0 ? "text-accent" : "text-destructive"}`}>{fmt(profit)}</TableCell>
                </TableRow>
              );
            })}
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
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}
