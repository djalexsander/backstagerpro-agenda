import { useState, useMemo, useRef, useCallback } from "react";
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
import { Plus, TrendingUp, TrendingDown, DollarSign, Pencil, Trash2, FileDown, X, Users, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { exportFinancialPDF, exportFinancialTotalPDF } from "@/lib/pdf-export";
import { parseISO, isWithinInterval, startOfMonth, endOfMonth, format } from "date-fns";
import { FinanceCards } from "@/components/financeiro/FinanceCards";

const fieldLabels: Record<string, string> = {
  cache: "Cachê",
  transport: "Transporte",
  lodging: "Hospedagem",
};

const fieldKeys = ["cache", "transport", "lodging"] as const;

type ExtraCost = { name: string; value: number };
type CacheParcela = { numero: number; valor: number; vencimento: string; pago: boolean };
type CacheDetail = {
  valorTotal: number;
  entrada: number;
  entradaPaga: boolean;
  parcelado: boolean;
  parcelas: CacheParcela[];
  recebimentoEvento: boolean;
  dataRecebimento: string;
  recebimentoPago: boolean;
};
type EmployeeExpense = {
  employeeId: string;
  name: string;
  funcao: string;
  cache: number;
  food: number;
};

function parseEmployeeExpenses(raw: any): EmployeeExpense[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (raw.length > 0 && 'nome' in raw[0] && !('employeeId' in raw[0])) {
      return raw.map((f: any) => ({
        employeeId: '', name: f.nome, funcao: '', cache: f.valor || 0, food: 0,
      }));
    }
    return raw;
  }
  try { return JSON.parse(raw); } catch { return []; }
}

function sumEmployeeExpenses(emps: EmployeeExpense[]): number {
  return emps.reduce((s, e) => s + (e.cache || 0) + (e.food || 0), 0);
}

function parseExtraCosts(raw: any): ExtraCost[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function sumExtraCosts(extras: ExtraCost[]): number {
  return extras.reduce((s, e) => s + (e.value || 0), 0);
}

export default function Financeiro() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { empresaId, empresaNome, empresaLogoUrl } = useAuth();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [form, setForm] = useState({ cache: "", transport: "", lodging: "" });
  const [transportDetail, setTransportDetail] = useState({ km: "", valorGasto: "", pedagio: "" });
  const [transportOpen, setTransportOpen] = useState(false);
  const [lodgingDetail, setLodgingDetail] = useState({ qtdFuncionarios: "", valorDia: "", qtdDias: "" });
  const [lodgingOpen, setLodgingOpen] = useState(false);
  const [cacheOpen, setCacheOpen] = useState(false);
  const defaultCacheDetail: CacheDetail = {
    valorTotal: 0, entrada: 0, entradaPaga: false, parcelado: false,
    parcelas: [], recebimentoEvento: true, dataRecebimento: "", recebimentoPago: false,
  };
  const [cacheDetail, setCacheDetail] = useState<CacheDetail>(defaultCacheDetail);
  const [extraCosts, setExtraCosts] = useState<ExtraCost[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<EmployeeExpense[]>([]);
  const [funcDialogOpen, setFuncDialogOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "month" | "period">("all");
  const [exportMonth, setExportMonth] = useState(format(new Date(), "yyyy-MM"));
  const [exportStart, setExportStart] = useState("");
  const [exportEnd, setExportEnd] = useState("");

  const { data: financials = [] } = useQuery({
    queryKey: ["financials", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("financials").select("*, events(name, artist, date)").order("created_at", { ascending: false }).eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: events = [] } = useQuery({
    queryKey: ["events-list", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("events").select("id, name").order("date", { ascending: false }).eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: dbEmployees = [] } = useQuery({
    queryKey: ["funcionarios", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("funcionarios").select("*").eq("empresa_id", empresaId).order("nome");
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const eventsWithoutFinancials = events.filter(
    (e) => !financials.some((f) => f.event_id === e.id) || (editItem && editItem.event_id === e.id)
  );

  const openAdd = () => {
    setEditItem(null);
    setSelectedEvent("");
    setForm({ cache: "", transport: "", lodging: "" });
    setTransportDetail({ km: "", valorGasto: "", pedagio: "" });
    setTransportOpen(false);
    setLodgingDetail({ qtdFuncionarios: "", valorDia: "", qtdDias: "" });
    setLodgingOpen(false);
    setCacheOpen(false);
    setCacheDetail(defaultCacheDetail);
    setExtraCosts([]);
    setSelectedEmployees([]);
    setOpen(true);
  };

  const openEdit = (f: any) => {
    setEditItem(f);
    setSelectedEvent(f.event_id);
    setForm({
      cache: String(f.cache || 0),
      transport: String(f.transport || 0),
      lodging: String(f.lodging || 0),
    });
    // Try to parse transport detail from extra metadata if available
    const savedDetail = (f as any).transport_detail;
    if (savedDetail) {
      setTransportDetail({ km: String(savedDetail.km || ""), valorGasto: String(savedDetail.valorGasto || ""), pedagio: String(savedDetail.pedagio || "") });
      setTransportOpen(true);
    } else {
      setTransportDetail({ km: "", valorGasto: "", pedagio: "" });
      setTransportOpen(Number(f.transport || 0) > 0);
    }
    const savedLodging = (f as any).lodging_detail;
    if (savedLodging) {
      setLodgingDetail({ qtdFuncionarios: String(savedLodging.qtdFuncionarios || ""), valorDia: String(savedLodging.valorDia || ""), qtdDias: String(savedLodging.qtdDias || "") });
      setLodgingOpen(true);
    } else {
      setLodgingDetail({ qtdFuncionarios: "", valorDia: "", qtdDias: "" });
      setLodgingOpen(Number(f.lodging || 0) > 0);
    }
    const savedCache = (f as any).cache_detail;
    if (savedCache) {
      setCacheDetail(savedCache);
      setCacheOpen(true);
    } else {
      setCacheDetail({ ...defaultCacheDetail, valorTotal: Number(f.cache || 0) });
      setCacheOpen(Number(f.cache || 0) > 0);
    }
    setExtraCosts(parseExtraCosts((f as any).extra_costs));
    setSelectedEmployees(parseEmployeeExpenses((f as any).funcionarios_cache));
    setOpen(true);
  };

  const addExtraCost = () => {
    setExtraCosts((prev) => [...prev, { name: "", value: 0 }]);
  };

  const updateExtraCost = (index: number, field: "name" | "value", val: string) => {
    setExtraCosts((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: field === "value" ? parseFloat(val) || 0 : val } : item
      )
    );
  };

  const removeExtraCost = (index: number) => {
    setExtraCosts((prev) => prev.filter((_, i) => i !== index));
  };

  // Employee helpers
  const handleAddEmployee = (empId: string) => {
    const emp = dbEmployees.find((e: any) => e.id === empId);
    if (!emp) return;
    if (selectedEmployees.some((se) => se.employeeId === empId)) return;
      setSelectedEmployees((prev) => [
      ...prev,
      {
        employeeId: (emp as any).id,
        name: (emp as any).nome,
        funcao: (emp as any).funcao || "",
        cache: Number((emp as any).cache_padrao) || 0,
        food: 0,
      },
    ]);
  };

  const updateEmployeeCache = (index: number, value: number) => {
    setSelectedEmployees((prev) => prev.map((e, i) => (i === index ? { ...e, cache: value } : e)));
  };

  const updateEmployeeFood = (index: number, value: number) => {
    setSelectedEmployees((prev) => prev.map((e, i) => (i === index ? { ...e, food: value } : e)));
  };

  const removeEmployee = (index: number) => {
    setSelectedEmployees((prev) => prev.filter((_, i) => i !== index));
  };

  const totalFuncionarios = sumEmployeeExpenses(selectedEmployees);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validExtras = extraCosts.filter((e) => e.name.trim() !== "");
      const totalEmps = sumEmployeeExpenses(selectedEmployees);
      const totalFood = selectedEmployees.reduce((s, e) => s + (e.food || 0), 0);
      const payload = {
        event_id: selectedEvent,
        empresa_id: empresaId,
        cache: parseFloat(form.cache) || 0,
        transport: parseFloat(form.transport) || 0,
        food: totalFood,
        lodging: parseFloat(form.lodging) || 0,
        other_costs: totalEmps - totalFood,
        extra_costs: validExtras,
        funcionarios_cache: selectedEmployees,
        cache_detail: cacheOpen ? cacheDetail : null,
        transport_detail: transportOpen ? { km: transportDetail.km, valorGasto: transportDetail.valorGasto, pedagio: transportDetail.pedagio } : null,
        lodging_detail: lodgingOpen ? { qtdFuncionarios: lodgingDetail.qtdFuncionarios, valorDia: lodgingDetail.valorDia, qtdDias: lodgingDetail.qtdDias } : null,
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
      setForm({ cache: "", transport: "", lodging: "" });
      setCacheDetail(defaultCacheDetail);
      setCacheOpen(false);
      setExtraCosts([]);
      setSelectedEmployees([]);
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

  const togglePaymentMutation = useMutation({
    mutationFn: async ({ financialId, cacheDetail: newDetail }: { financialId: string; cacheDetail: CacheDetail }) => {
      const { error } = await supabase.from("financials").update({ cache_detail: newDetail as any }).eq("id", financialId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financials"] });
      toast({ title: "Pagamento atualizado!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const fmt = (n: number | null) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

  const getExtraCostsTotal = (f: any) => sumExtraCosts(parseExtraCosts((f as any).extra_costs));

  // Calculate paid cache from cache_detail
  const getCachePago = (f: any): number => {
    const detail = (f as any).cache_detail as CacheDetail | null;
    if (!detail) return f.cache || 0; // no detail = assume fully paid (legacy)
    let paid = 0;
    if (detail.entrada > 0 && detail.entradaPaga) paid += detail.entrada;
    if (detail.parcelado) {
      paid += (detail.parcelas || []).filter(p => p.pago).reduce((s, p) => s + p.valor, 0);
    } else {
      if (detail.recebimentoPago) paid += (detail.valorTotal - (detail.entrada || 0));
    }
    return paid;
  };

  const getCachePendente = (f: any): number => {
    return (f.cache || 0) - getCachePago(f);
  };

  const totalCache = financials.reduce((s, f) => s + (f.cache || 0), 0);
  const totalCachePago = financials.reduce((s, f) => s + getCachePago(f), 0);
  const totalCachePendente = totalCache - totalCachePago;
  const totalFixedCosts = financials.reduce((s, f) => s + (f.transport || 0) + (f.food || 0) + (f.lodging || 0) + (f.other_costs || 0), 0);
  const totalExtraCosts = financials.reduce((s, f) => s + getExtraCostsTotal(f), 0);
  const totalCosts = totalFixedCosts + totalExtraCosts;
  const totalProfit = totalCachePago - totalCosts;

  const getProfit = (f: any) => getCachePago(f) - (f.transport || 0) - (f.food || 0) - (f.lodging || 0) - (f.other_costs || 0) - getExtraCostsTotal(f);

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
    exportFinancialTotalPDF(filtered, title, { empresaNome, empresaLogoUrl });
    setExportOpen(false);
  };

  // Available employees not yet selected
  const availableEmployees = dbEmployees.filter(
    (e: any) => !selectedEmployees.some((se) => se.employeeId === e.id)
  );

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

      {/* Export Dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Exportar Relatório Financeiro</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de Exportação</Label>
              <Select value={exportMode} onValueChange={(v) => setExportMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os registros</SelectItem>
                  <SelectItem value="month">Por mês</SelectItem>
                  <SelectItem value="period">Por período (início e fim)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {exportMode === "month" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mês</Label>
                  <Select value={exportMonth.split("-")[1] || "01"} onValueChange={(v) => setExportMonth((prev) => `${prev.split("-")[0]}-${v}`)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"].map((m, i) => (
                        <SelectItem key={i} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ano</Label>
                  <Select value={exportMonth.split("-")[0] || "2026"} onValueChange={(v) => setExportMonth((prev) => `${v}-${prev.split("-")[1]}`)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i)).map((y) => (
                        <SelectItem key={y} value={y}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {exportMode === "period" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Data Início</Label>
                  <Input type="date" value={exportStart} onChange={(e) => setExportStart(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Data Fim</Label>
                  <Input type="date" value={exportEnd} onChange={(e) => setExportEnd(e.target.value)} />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleExport}>
              <FileDown className="h-4 w-4 mr-1" /> Exportar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? "Editar Registro Financeiro" : "Novo Registro Financeiro"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (selectedEvent && !saveMutation.isPending) saveMutation.mutate();
            }}
          >
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
              {/* Cachê - expandable payment tracking */}
              <div className="space-y-2">
                <Label
                  className="cursor-pointer flex items-center justify-between hover:text-primary transition-colors"
                  onClick={() => setCacheOpen(!cacheOpen)}
                >
                  <span>Cachê {form.cache && Number(form.cache) > 0 ? `— ${fmt(Number(form.cache))}` : ""}</span>
                  <span className="text-xs text-muted-foreground">{cacheOpen ? "▲ Fechar" : "▼ Detalhar"}</span>
                </Label>
                {!cacheOpen && (
                  <Input
                    type="number" step="0.01"
                    value={form.cache}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, cache: e.target.value }));
                      setCacheDetail(p => ({ ...p, valorTotal: parseFloat(e.target.value) || 0 }));
                    }}
                    placeholder="0.00"
                    onFocus={() => setCacheOpen(true)}
                  />
                )}
                {cacheOpen && (
                  <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
                    <div className="space-y-2">
                      <Label className="text-xs">Valor Total do Cachê</Label>
                      <Input
                        type="number" step="0.01"
                        value={cacheDetail.valorTotal || ""}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setCacheDetail(p => ({ ...p, valorTotal: val }));
                          setForm(p => ({ ...p, cache: e.target.value }));
                        }}
                        placeholder="0.00" className="h-8 text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Valor de Entrada</Label>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={cacheDetail.entradaPaga}
                            onCheckedChange={(checked) => setCacheDetail(p => ({ ...p, entradaPaga: !!checked }))}
                          />
                          <span className="text-xs text-muted-foreground">Pago</span>
                        </div>
                      </div>
                      <Input
                        type="number" step="0.01"
                        value={cacheDetail.entrada || ""}
                        onChange={(e) => setCacheDetail(p => ({ ...p, entrada: parseFloat(e.target.value) || 0 }))}
                        placeholder="0.00" className="h-8 text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Forma de Recebimento do Restante</Label>
                      <Select
                        value={cacheDetail.parcelado ? "parcelado" : "avista"}
                        onValueChange={(v) => {
                          const parcelado = v === "parcelado";
                          setCacheDetail(p => ({
                            ...p,
                            parcelado,
                            parcelas: parcelado && p.parcelas.length === 0
                              ? [{ numero: 1, valor: p.valorTotal - (p.entrada || 0), vencimento: "", pago: false }]
                              : p.parcelas,
                          }));
                        }}
                      >
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="avista">À Vista (Pagamento Único)</SelectItem>
                          <SelectItem value="parcelado">Parcelado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {!cacheDetail.parcelado && (
                      <div className="space-y-2 p-2 rounded border bg-background">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={cacheDetail.recebimentoEvento}
                            onCheckedChange={(checked) => setCacheDetail(p => ({ ...p, recebimentoEvento: !!checked, dataRecebimento: "" }))}
                          />
                          <span className="text-xs">Receber no dia do evento</span>
                        </div>
                        {!cacheDetail.recebimentoEvento && (
                          <div className="space-y-1">
                            <Label className="text-xs">Data do Recebimento</Label>
                            <Input
                              type="date"
                              value={cacheDetail.dataRecebimento}
                              onChange={(e) => setCacheDetail(p => ({ ...p, dataRecebimento: e.target.value }))}
                              className="h-8 text-sm"
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          <Checkbox
                            checked={cacheDetail.recebimentoPago}
                            onCheckedChange={(checked) => setCacheDetail(p => ({ ...p, recebimentoPago: !!checked }))}
                          />
                          <span className="text-xs font-medium">
                            Restante {fmt(cacheDetail.valorTotal - (cacheDetail.entrada || 0))} — {cacheDetail.recebimentoPago ? "Pago ✓" : "Pendente"}
                          </span>
                        </div>
                      </div>
                    )}

                    {cacheDetail.parcelado && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold">Parcelas</Label>
                          <Button
                            type="button" variant="outline" size="sm" className="h-6 text-xs px-2"
                            onClick={() => {
                              const restante = cacheDetail.valorTotal - (cacheDetail.entrada || 0);
                              const numParcelas = cacheDetail.parcelas.length + 1;
                              const valorParcela = Math.round((restante / numParcelas) * 100) / 100;
                              setCacheDetail(p => ({
                                ...p,
                                parcelas: Array.from({ length: numParcelas }, (_, i) => ({
                                  numero: i + 1,
                                  valor: p.parcelas[i]?.valor ?? valorParcela,
                                  vencimento: p.parcelas[i]?.vencimento ?? "",
                                  pago: p.parcelas[i]?.pago ?? false,
                                })),
                              }));
                            }}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Parcela
                          </Button>
                        </div>
                        {cacheDetail.parcelas.map((parcela, i) => (
                          <div key={i} className="p-2 rounded border bg-background space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium">Parcela {parcela.numero}</span>
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  checked={parcela.pago}
                                  onCheckedChange={(checked) => {
                                    setCacheDetail(p => ({
                                      ...p,
                                      parcelas: p.parcelas.map((pp, pi) => pi === i ? { ...pp, pago: !!checked } : pp),
                                    }));
                                  }}
                                />
                                <span className="text-xs">{parcela.pago ? "Pago ✓" : "Pendente"}</span>
                                {cacheDetail.parcelas.length > 1 && (
                                  <Button
                                    type="button" variant="ghost" size="icon"
                                    className="h-5 w-5 text-destructive"
                                    onClick={() => {
                                      setCacheDetail(p => ({
                                        ...p,
                                        parcelas: p.parcelas.filter((_, pi) => pi !== i).map((pp, pi) => ({ ...pp, numero: pi + 1 })),
                                      }));
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs">Valor</Label>
                                <Input
                                  type="number" step="0.01"
                                  value={parcela.valor || ""}
                                  onChange={(e) => {
                                    setCacheDetail(p => ({
                                      ...p,
                                      parcelas: p.parcelas.map((pp, pi) => pi === i ? { ...pp, valor: parseFloat(e.target.value) || 0 } : pp),
                                    }));
                                  }}
                                  className="h-7 text-xs" placeholder="0.00"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Vencimento</Label>
                                <Input
                                  type="date"
                                  value={parcela.vencimento}
                                  onChange={(e) => {
                                    setCacheDetail(p => ({
                                      ...p,
                                      parcelas: p.parcelas.map((pp, pi) => pi === i ? { ...pp, vencimento: e.target.value } : pp),
                                    }));
                                  }}
                                  className="h-7 text-xs"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          Total Parcelas: <span className="font-semibold text-foreground">{fmt(cacheDetail.parcelas.reduce((s, p) => s + p.valor, 0))}</span>
                          {" | "}Restante a parcelar: <span className="font-semibold text-foreground">{fmt(cacheDetail.valorTotal - (cacheDetail.entrada || 0))}</span>
                        </p>
                      </div>
                    )}

                    {/* Summary */}
                    <div className="pt-2 border-t space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>Total Cachê:</span>
                        <span className="font-semibold">{fmt(cacheDetail.valorTotal)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-accent" /> Recebido:</span>
                        <span className="font-semibold text-accent">{fmt(
                          (cacheDetail.entradaPaga ? cacheDetail.entrada : 0) +
                          (cacheDetail.parcelado
                            ? cacheDetail.parcelas.filter(p => p.pago).reduce((s, p) => s + p.valor, 0)
                            : (cacheDetail.recebimentoPago ? cacheDetail.valorTotal - (cacheDetail.entrada || 0) : 0))
                        )}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-yellow-500" /> Pendente:</span>
                        <span className="font-semibold text-yellow-500">{fmt(
                          cacheDetail.valorTotal -
                          (cacheDetail.entradaPaga ? cacheDetail.entrada : 0) -
                          (cacheDetail.parcelado
                            ? cacheDetail.parcelas.filter(p => p.pago).reduce((s, p) => s + p.valor, 0)
                            : (cacheDetail.recebimentoPago ? cacheDetail.valorTotal - (cacheDetail.entrada || 0) : 0))
                        )}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Hospedagem - clicável com detalhes */}
              <div className="space-y-2">
                <Label
                  className="cursor-pointer flex items-center justify-between hover:text-primary transition-colors"
                  onClick={() => setLodgingOpen(!lodgingOpen)}
                >
                  <span>Hospedagem {form.lodging && Number(form.lodging) > 0 ? `— ${fmt(Number(form.lodging))}` : ""}</span>
                  <span className="text-xs text-muted-foreground">{lodgingOpen ? "▲ Fechar" : "▼ Detalhar"}</span>
                </Label>
                {!lodgingOpen && (
                  <Input
                    type="number" step="0.01"
                    value={form.lodging}
                    onChange={(e) => setForm((p) => ({ ...p, lodging: e.target.value }))}
                    placeholder="0.00"
                    onFocus={() => setLodgingOpen(true)}
                  />
                )}
                {lodgingOpen && (
                  <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Qtd. Funcionários</Label>
                        <Input
                          type="number" step="1"
                          value={lodgingDetail.qtdFuncionarios}
                          onChange={(e) => {
                            const qtd = e.target.value;
                            setLodgingDetail(p => ({ ...p, qtdFuncionarios: qtd }));
                            const total = (parseFloat(qtd) || 0) * (parseFloat(lodgingDetail.valorDia) || 0) * (parseFloat(lodgingDetail.qtdDias) || 1);
                            setForm(p => ({ ...p, lodging: total ? String(total) : "" }));
                          }}
                          placeholder="0" className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Qtd. Dias</Label>
                        <Input
                          type="number" step="1"
                          value={lodgingDetail.qtdDias}
                          onChange={(e) => {
                            const dias = e.target.value;
                            setLodgingDetail(p => ({ ...p, qtdDias: dias }));
                            const total = (parseFloat(lodgingDetail.qtdFuncionarios) || 0) * (parseFloat(lodgingDetail.valorDia) || 0) * (parseFloat(dias) || 1);
                            setForm(p => ({ ...p, lodging: total ? String(total) : "" }));
                          }}
                          placeholder="1" className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Valor/Dia</Label>
                        <Input
                          type="number" step="0.01"
                          value={lodgingDetail.valorDia}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLodgingDetail(p => ({ ...p, valorDia: val }));
                            const total = (parseFloat(lodgingDetail.qtdFuncionarios) || 0) * (parseFloat(val) || 0) * (parseFloat(lodgingDetail.qtdDias) || 1);
                            setForm(p => ({ ...p, lodging: total ? String(total) : "" }));
                          }}
                          placeholder="0.00" className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Total</Label>
                        <Input
                          type="number" step="0.01"
                          value={form.lodging}
                          onChange={(e) => setForm(p => ({ ...p, lodging: e.target.value }))}
                          placeholder="0.00" className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label
                  className="cursor-pointer flex items-center justify-between hover:text-primary transition-colors"
                  onClick={() => setTransportOpen(!transportOpen)}
                >
                  <span>Transporte {form.transport && Number(form.transport) > 0 ? `— ${fmt(Number(form.transport))}` : ""}</span>
                  <span className="text-xs text-muted-foreground">{transportOpen ? "▲ Fechar" : "▼ Detalhar"}</span>
                </Label>
                {!transportOpen && (
                  <Input
                    type="number"
                    step="0.01"
                    value={form.transport}
                    onChange={(e) => setForm((p) => ({ ...p, transport: e.target.value }))}
                    placeholder="0.00"
                    onFocus={() => setTransportOpen(true)}
                  />
                )}
                {transportOpen && (
                  <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">KM Rodados</Label>
                        <Input
                          type="number" step="0.01"
                          value={transportDetail.km}
                          onChange={(e) => setTransportDetail(p => ({ ...p, km: e.target.value }))}
                          placeholder="0" className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Valor de Combustível</Label>
                        <Input
                          type="number" step="0.01"
                          value={transportDetail.valorGasto}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTransportDetail(p => ({ ...p, valorGasto: val }));
                            const total = (parseFloat(val) || 0) + (parseFloat(transportDetail.pedagio) || 0);
                            setForm(p => ({ ...p, transport: total ? String(total) : "" }));
                          }}
                          placeholder="0.00" className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Pedágio</Label>
                        <Input
                          type="number" step="0.01"
                          value={transportDetail.pedagio}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTransportDetail(p => ({ ...p, pedagio: val }));
                            const total = (parseFloat(transportDetail.valorGasto) || 0) + (parseFloat(val) || 0);
                            setForm(p => ({ ...p, transport: total ? String(total) : "" }));
                          }}
                          placeholder="0.00" className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Total Transporte: <span className="font-semibold text-foreground">{fmt(Number(form.transport) || 0)}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Funcionários do Evento */}
              <div className="space-y-3 pt-2 border-t border-border">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4" /> Funcionários do Evento
                </Label>

                {availableEmployees.length > 0 && (
                  <Select onValueChange={handleAddEmployee}>
                    <SelectTrigger>
                      <SelectValue placeholder="Adicionar funcionário..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEmployees.map((e: any) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.nome} {e.funcao ? `(${e.funcao})` : ""} — {fmt(Number(e.cache_padrao))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {dbEmployees.length === 0 && (
                  <p className="text-xs text-muted-foreground">Cadastre funcionários em Funcionários no menu lateral.</p>
                )}

                {selectedEmployees.map((emp, i) => (
                  <div key={i} className="p-3 rounded-lg border bg-muted/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{emp.name}</p>
                        {emp.funcao && <p className="text-xs text-muted-foreground uppercase">{emp.funcao}</p>}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEmployee(i)}
                        className="shrink-0 text-destructive hover:text-destructive h-8 w-8"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Cachê</Label>
                        <Input
                          type="number" step="0.01"
                          value={emp.cache || ""}
                          onChange={(e) => updateEmployeeCache(i, parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm" placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Alimentação</Label>
                        <Input
                          type="number" step="0.01"
                          value={emp.food || ""}
                          onChange={(e) => updateEmployeeFood(i, parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm" placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {selectedEmployees.length > 0 && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm font-semibold text-primary">
                      Total Funcionários: {fmt(totalFuncionarios)}
                    </span>
                  </div>
                )}
              </div>

              {extraCosts.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <Label className="text-sm font-semibold">Despesas Extras</Label>
                  {extraCosts.map((extra, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder="Nome da despesa"
                        value={extra.name}
                        onChange={(e) => updateExtraCost(i, "name", e.target.value)}
                        className="flex-1"
                        data-extra-name={i}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const valueInput = e.currentTarget.closest("form")?.querySelector<HTMLInputElement>(`[data-extra-value="${i}"]`);
                            valueInput?.focus();
                          }
                        }}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={extra.value || ""}
                        onChange={(e) => updateExtraCost(i, "value", e.target.value)}
                        className="w-28"
                        data-extra-value={i}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const nextName = e.currentTarget.closest("form")?.querySelector<HTMLInputElement>(`[data-extra-name="${i + 1}"]`);
                            if (nextName) {
                              nextName.focus();
                            } else if (selectedEvent && !saveMutation.isPending) {
                              saveMutation.mutate();
                            }
                          }
                        }}
                      />
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeExtraCost(i)} className="shrink-0 text-destructive hover:text-destructive">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button type="button" variant="outline" size="sm" onClick={addExtraCost} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Adicionar Despesa Extra
              </Button>
            </div>
            <DialogFooter className="mt-4">
              <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
              <Button type="submit" disabled={!selectedEvent || saveMutation.isPending}>
                {saveMutation.isPending ? "Salvando..." : editItem ? "Atualizar" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <FinanceCards
        financials={financials}
        getCachePago={getCachePago}
        getCachePendente={getCachePendente}
        onTogglePayment={(financialId, detail) => togglePaymentMutation.mutate({ financialId, cacheDetail: detail })}
      />

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Evento</TableHead>
              <TableHead className="text-right">Cachê</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Transporte</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Alimentação</TableHead>
              <TableHead className="text-right hidden md:table-cell">Hospedagem</TableHead>
              <TableHead className="text-right hidden md:table-cell">Funcionários</TableHead>
              <TableHead className="text-right hidden lg:table-cell">Extras</TableHead>
              <TableHead className="text-right">Lucro/Prejuízo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {financials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Nenhum registro financeiro.
                </TableCell>
              </TableRow>
            ) : (
              financials.map((f) => {
                const profit = getProfit(f);
                const extras = parseExtraCosts((f as any).extra_costs);
                const extrasTotal = sumExtraCosts(extras);
                return (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">
                      {(f as any).events?.name || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div>{fmt(f.cache)}</div>
                      {(() => {
                        const pendente = getCachePendente(f);
                        const pago = getCachePago(f);
                        if ((f as any).cache_detail && pendente > 0) {
                          return (
                            <div className="flex flex-col items-end gap-0.5 mt-0.5">
                              <Badge variant="outline" className="text-[10px] px-1 py-0 border-accent text-accent">{fmt(pago)} recebido</Badge>
                              <Badge variant="outline" className="text-[10px] px-1 py-0 border-yellow-500 text-yellow-500">{fmt(pendente)} pendente</Badge>
                            </div>
                          );
                        } else if ((f as any).cache_detail && pendente <= 0) {
                          return <Badge variant="outline" className="text-[10px] px-1 py-0 border-accent text-accent mt-0.5">Pago ✓</Badge>;
                        }
                        return null;
                      })()}
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell">{fmt(f.transport)}</TableCell>
                    <TableCell className="text-right hidden sm:table-cell">{fmt(f.food)}</TableCell>
                    <TableCell className="text-right hidden md:table-cell">{fmt(f.lodging)}</TableCell>
                    <TableCell className="text-right hidden md:table-cell">{fmt(f.other_costs)}</TableCell>
                    <TableCell className="text-right hidden lg:table-cell">{fmt(extrasTotal)}</TableCell>
                    <TableCell className={`text-right font-semibold ${profit >= 0 ? "text-accent" : "text-destructive"}`}>
                      {fmt(profit)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => exportFinancialPDF(f, { empresaNome, empresaLogoUrl })} title="Exportar PDF">
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
                <TableCell className="text-right font-bold">
                  <div>{fmt(totalCache)}</div>
                  {totalCachePendente > 0 && (
                    <div className="text-[10px] font-normal text-yellow-500">{fmt(totalCachePendente)} pendente</div>
                  )}
                </TableCell>
                <TableCell className="text-right font-bold hidden sm:table-cell">{fmt(financials.reduce((s, f) => s + (f.transport || 0), 0))}</TableCell>
                <TableCell className="text-right font-bold hidden sm:table-cell">{fmt(financials.reduce((s, f) => s + (f.food || 0), 0))}</TableCell>
                <TableCell className="text-right font-bold hidden md:table-cell">{fmt(financials.reduce((s, f) => s + (f.lodging || 0), 0))}</TableCell>
                <TableCell className="text-right font-bold hidden md:table-cell">{fmt(financials.reduce((s, f) => s + (f.other_costs || 0), 0))}</TableCell>
                <TableCell className="text-right font-bold hidden lg:table-cell">{fmt(totalExtraCosts)}</TableCell>
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
