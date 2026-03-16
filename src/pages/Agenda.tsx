import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Plus, FileDown, Search, CalendarDays } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { exportAgendaPDF } from "@/lib/pdf-export";

const statusColors: Record<string, string> = {
  confirmado: "bg-accent text-accent-foreground",
  pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  cancelado: "bg-destructive text-destructive-foreground",
};

export default function Agenda() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*").order("date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const cities = [...new Set(events.map((e) => e.city))].sort();

  // Dates that have events (for calendar highlighting)
  const eventDates = events.map((e) => parseISO(e.date));

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
          <Button variant="outline" size="sm" onClick={() => exportAgendaPDF(filtered)}>
            <FileDown className="h-4 w-4 mr-1" /> Exportar PDF
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => navigate("/evento/novo")}>
              <Plus className="h-4 w-4 mr-1" /> Criar Evento
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Calendar sidebar */}
        <div className="rounded-lg border bg-card p-2">
          <div className="flex items-center gap-2 px-2 pb-2 border-b border-border mb-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Calendário</span>
            {selectedDate && (
              <Button variant="ghost" size="sm" className="ml-auto text-xs h-6 px-2" onClick={() => setSelectedDate(undefined)}>
                Limpar
              </Button>
            )}
          </div>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            locale={ptBR}
            modifiers={{ hasEvent: eventDates }}
            modifiersClassNames={{ hasEvent: "bg-primary/20 text-primary font-bold" }}
            className="w-full"
          />
        </div>

        {/* Table section */}
        <div className="space-y-4">
          {/* Filters */}
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

          {/* Table */}
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
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum evento encontrado.</TableCell>
                  </TableRow>
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
