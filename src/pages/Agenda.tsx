import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Plus, FileDown, Search, CalendarDays } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO, isSameDay, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { exportAgendaPDF } from "@/lib/pdf-export";

const statusColors: Record<string, string> = {
  confirmado: "bg-accent text-accent-foreground",
  pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  cancelado: "bg-destructive text-destructive-foreground",
};

export default function Agenda() {
  const navigate = useNavigate();
  const { isAdmin, empresaId } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "month" | "period">("all");
  const [exportMonthVal, setExportMonthVal] = useState(format(new Date(), "MM"));
  const [exportYearVal, setExportYearVal] = useState(format(new Date(), "yyyy"));
  const [exportStart, setExportStart] = useState("");
  const [exportEnd, setExportEnd] = useState("");

  const { data: events = [] } = useQuery({
    queryKey: ["events", empresaId],
    queryFn: async () => {
      let query = supabase.from("events").select("*").order("date", { ascending: true });
      if (empresaId) query = query.eq("empresa_id", empresaId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const cities = [...new Set(events.map((e) => e.city))].sort();
  const eventDates = events.filter((e) => e.date).map((e) => parseISO(e.date));

  const filtered = events.filter((e) => {
    const matchesSearch = search === "" || e.name.toLowerCase().includes(search.toLowerCase()) || e.artist.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
    const matchesCity = cityFilter === "all" || e.city === cityFilter;
    const matchesDate = !selectedDate || isSameDay(parseISO(e.date), selectedDate);
    return matchesSearch && matchesStatus && matchesCity && matchesDate;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Agenda</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
            <FileDown className="h-4 w-4 mr-1" /> Exportar PDF
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => navigate("/evento/novo")}>
              <Plus className="h-4 w-4 mr-1" /> Criar Evento
            </Button>
          )}
        </div>
      </div>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Exportar Agenda em PDF</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de Exportação</Label>
              <Select value={exportMode} onValueChange={(v) => setExportMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os eventos</SelectItem>
                  <SelectItem value="month">Por mês</SelectItem>
                  <SelectItem value="period">Por período (início e fim)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {exportMode === "month" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mês</Label>
                  <Select value={exportMonthVal} onValueChange={setExportMonthVal}>
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
                  <Select value={exportYearVal} onValueChange={setExportYearVal}>
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
            <Button onClick={() => {
              let toExport = filtered;
              if (exportMode === "month") {
                const ms = startOfMonth(new Date(parseInt(exportYearVal), parseInt(exportMonthVal) - 1));
                const me = endOfMonth(ms);
                toExport = filtered.filter((e) => e.date && isWithinInterval(parseISO(e.date), { start: ms, end: me }));
              } else if (exportMode === "period" && exportStart && exportEnd) {
                toExport = filtered.filter((e) => e.date && isWithinInterval(parseISO(e.date), { start: parseISO(exportStart), end: parseISO(exportEnd) }));
              }
              if (toExport.length === 0) {
                return;
              }
              exportAgendaPDF(toExport);
              setExportOpen(false);
            }}>
              <FileDown className="h-4 w-4 mr-1" /> Exportar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <div className="rounded-lg border bg-card p-2">
          <div className="flex items-center gap-2 px-2 pb-2 border-b border-border mb-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Calendário</span>
            {selectedDate && (
              <Button variant="ghost" size="sm" className="ml-auto text-xs h-6 px-2" onClick={() => setSelectedDate(undefined)}>Limpar</Button>
            )}
          </div>
          <Calendar mode="single" selected={selectedDate} onSelect={(date) => { setSelectedDate(date); }} locale={ptBR}
            modifiers={{ hasEvent: eventDates }} modifiersClassNames={{ hasEvent: "bg-primary/20 text-primary font-bold" }} className="w-full" />
          {selectedDate && isAdmin && (
            <div className="px-2 pt-2 border-t border-border mt-2">
              <Button size="sm" className="w-full" onClick={() => navigate(`/evento/novo?date=${format(selectedDate, "yyyy-MM-dd")}`)}>
                <Plus className="h-4 w-4 mr-1" /> Criar Evento em {format(selectedDate, "dd/MM/yyyy")}
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por evento ou artista..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="confirmado">Confirmado</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={cityFilter} onValueChange={setCityFilter}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Cidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Artista</TableHead>
                  <TableHead className="hidden md:table-cell">Cidade</TableHead>
                  <TableHead className="hidden lg:table-cell">Local</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum evento encontrado.</TableCell></TableRow>
                ) : (
                  filtered.map((event) => (
                    <TableRow key={event.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate(`/evento/${event.id}`)}>
                      <TableCell className="font-medium whitespace-nowrap">{format(parseISO(event.date), "dd/MM/yyyy")}</TableCell>
                      <TableCell><Badge className={`${statusColors[event.status]} capitalize`}>{event.status}</Badge></TableCell>
                      <TableCell className="font-medium">{event.name}</TableCell>
                      <TableCell>{event.artist}</TableCell>
                      <TableCell className="hidden md:table-cell">{event.city}</TableCell>
                      <TableCell className="hidden lg:table-cell">{event.venue}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
