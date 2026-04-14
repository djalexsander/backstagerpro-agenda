import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, FileDown, CalendarDays, Edit, Trash2, Eye, ChevronDown, ChevronUp, FileText, ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { format, parseISO, isSameDay, startOfMonth, endOfMonth, isWithinInterval, isSameMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { exportAgendaPDF } from "@/lib/pdf-export";
import type { PdfBranding } from "@/lib/pdf-branding";
import { useToast } from "@/hooks/use-toast";
import { AgendaStats } from "@/components/agenda/AgendaStats";
import { AgendaFilters } from "@/components/agenda/AgendaFilters";
import { EventRowExpansion } from "@/components/agenda/EventRowExpansion";
import { statusColors, statusLabels } from "@/components/agenda/statusColors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Agenda() {
  const navigate = useNavigate();
  const { isAdmin, isUsuario, empresaId, empresaNome, empresaLogoUrl, empresaReadOnly } = useAuth();
  const { canCreateEvent, maxEventos, currentEventos } = usePlanLimits();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [agendaPage, setAgendaPage] = useState(0);
  const AGENDA_PAGE_SIZE = 25;

  // Export dialog state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "month" | "period">("all");
  const [exportMonthVal, setExportMonthVal] = useState(format(new Date(), "MM"));
  const [exportYearVal, setExportYearVal] = useState(format(new Date(), "yyyy"));
  const [exportStart, setExportStart] = useState("");
  const [exportEnd, setExportEnd] = useState("");

  const { data: events = [] } = useQuery({
    queryKey: ["events", empresaId, isUsuario],
    queryFn: async () => {
      if (!empresaId) return [];
      let query = supabase.from("events").select("*").order("date", { ascending: true }).eq("empresa_id", empresaId);
      if (isUsuario) {
        query = query.eq("status", "confirmado");
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const eventIds = events.map((e) => e.id);
  const { data: allEventDays = [] } = useQuery({
    queryKey: ["all-event-days", eventIds],
    queryFn: async () => {
      if (eventIds.length === 0) return [];
      const { data, error } = await supabase.from("event_days").select("*").in("event_id", eventIds).order("day_number", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: eventIds.length > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast({ title: "Evento excluído!" });
      setDeleteId(null);
    },
    onError: () => toast({ title: "Erro ao excluir", variant: "destructive" }),
  });

  const getEventArtists = (eventId: string): string[] => {
    const days = allEventDays.filter((d) => d.event_id === eventId);
    const artists = days.map((d) => d.artist).filter(Boolean) as string[];
    return [...new Set(artists)];
  };

  const getEventArtistsDisplay = (eventId: string, fallback: string) => {
    const artists = getEventArtists(eventId);
    if (artists.length === 0) return fallback;
    if (artists.length <= 2) return artists.join(", ");
    return `${artists[0]}, ${artists[1]} +${artists.length - 2}`;
  };

  const cities = [...new Set(events.map((e) => e.city))].sort();
  const eventDates = events.filter((e) => e.date).map((e) => parseISO(e.date));

  // Count events per date for calendar indicators
  const eventsPerDate = useMemo(() => {
    const map: Record<string, number> = {};
    events.forEach((e) => {
      if (e.date) {
        const key = e.date;
        map[key] = (map[key] || 0) + 1;
      }
    });
    return map;
  }, [events]);

  const filtered = events.filter((e) => {
    const allArtists = getEventArtists(e.id).join(" ") || e.artist;
    const matchesSearch =
      search === "" ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      allArtists.toLowerCase().includes(search.toLowerCase()) ||
      e.city.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
    const matchesCity = cityFilter === "all" || e.city === cityFilter;
    const matchesDate = !selectedDate || isSameDay(parseISO(e.date), selectedDate);
    let matchesPeriod = true;
    if (periodStart && periodEnd) {
      matchesPeriod = isWithinInterval(parseISO(e.date), { start: parseISO(periodStart), end: parseISO(periodEnd) });
    } else if (periodStart) {
      matchesPeriod = parseISO(e.date) >= parseISO(periodStart);
    } else if (periodEnd) {
      matchesPeriod = parseISO(e.date) <= parseISO(periodEnd);
    }
    return matchesSearch && matchesStatus && matchesCity && matchesDate && matchesPeriod;
  });

  // Reset page when filters change
  const filteredKey = `${search}${statusFilter}${cityFilter}${selectedDate}${periodStart}${periodEnd}`;
  useEffect(() => { setAgendaPage(0); }, [filteredKey]);

  const agendaTotalPages = Math.max(1, Math.ceil(filtered.length / AGENDA_PAGE_SIZE));
  const paginatedFiltered = filtered.slice(agendaPage * AGENDA_PAGE_SIZE, (agendaPage + 1) * AGENDA_PAGE_SIZE);

  // Stats for current month
  const now = new Date();
  const monthEvents = events.filter((e) => e.date && isSameMonth(parseISO(e.date), now));
  const totalShows = monthEvents.reduce((sum, e) => sum + (e.num_days || 1), 0);
  const allMonthArtists = new Set<string>();
  monthEvents.forEach((e) => {
    const artists = getEventArtists(e.id);
    if (artists.length > 0) artists.forEach((a) => allMonthArtists.add(a));
    else if (e.artist) allMonthArtists.add(e.artist);
  });

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Agenda</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              <FileDown className="h-4 w-4 mr-1" /> Exportar PDF
            </Button>
            {isAdmin && !empresaReadOnly && (
              canCreateEvent ? (
                <Button size="sm" onClick={() => navigate("/evento/novo")}>
                  <Plus className="h-4 w-4 mr-1" /> Criar Evento
                </Button>
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button size="sm" disabled>
                          <Plus className="h-4 w-4 mr-1" /> Criar Evento
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Limite atingido: {currentEventos}/{maxEventos} eventos. Faça upgrade do plano.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )
            )}
          </div>
        </div>

        <AgendaStats totalEvents={monthEvents.length} totalShows={totalShows} totalArtists={allMonthArtists.size} />

        {/* Export Dialog */}
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
                    <SelectItem value="period">Por período</SelectItem>
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
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button variant="outline" onClick={() => {
                let toExport = filtered;
                if (exportMode === "month") {
                  const ms = startOfMonth(new Date(parseInt(exportYearVal), parseInt(exportMonthVal) - 1));
                  const me = endOfMonth(ms);
                  toExport = filtered.filter((e) => e.date && isWithinInterval(parseISO(e.date), { start: ms, end: me }));
                } else if (exportMode === "period" && exportStart && exportEnd) {
                  toExport = filtered.filter((e) => e.date && isWithinInterval(parseISO(e.date), { start: parseISO(exportStart), end: parseISO(exportEnd) }));
                }
                if (toExport.length === 0) return;
                exportAgendaPDF(toExport, { empresaNome, empresaLogoUrl } as PdfBranding, "png");
                setExportOpen(false);
              }}>
                <ImageIcon className="h-4 w-4 mr-1" /> Exportar PNG
              </Button>
              <Button onClick={() => {
                let toExport = filtered;
                if (exportMode === "month") {
                  const ms = startOfMonth(new Date(parseInt(exportYearVal), parseInt(exportMonthVal) - 1));
                  const me = endOfMonth(ms);
                  toExport = filtered.filter((e) => e.date && isWithinInterval(parseISO(e.date), { start: ms, end: me }));
                } else if (exportMode === "period" && exportStart && exportEnd) {
                  toExport = filtered.filter((e) => e.date && isWithinInterval(parseISO(e.date), { start: parseISO(exportStart), end: parseISO(exportEnd) }));
                }
                if (toExport.length === 0) return;
                exportAgendaPDF(toExport, { empresaNome, empresaLogoUrl } as PdfBranding);
                setExportOpen(false);
              }}>
                <FileDown className="h-4 w-4 mr-1" /> Exportar PDF
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir evento?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita. O evento e todos os dados relacionados serão removidos.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Calendar Sidebar */}
          <div className="rounded-lg border bg-card p-2">
            <div className="flex items-center gap-2 px-2 pb-2 border-b border-border mb-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Calendário</span>
              {selectedDate && (
                <Button variant="ghost" size="sm" className="ml-auto text-xs h-6 px-2" onClick={() => setSelectedDate(undefined)}>Limpar</Button>
              )}
            </div>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => setSelectedDate(date)}
              locale={ptBR}
              modifiers={{ hasEvent: eventDates }}
              modifiersClassNames={{ hasEvent: "bg-primary/20 text-primary font-bold" }}
              className="w-full"
              components={{
                DayContent: ({ date }) => {
                  const key = format(date, "yyyy-MM-dd");
                  const count = eventsPerDate[key] || 0;
                  return (
                    <div className="relative flex items-center justify-center w-full h-full">
                      {date.getDate()}
                      {count > 1 && (
                        <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[8px] rounded-full h-3.5 w-3.5 flex items-center justify-center font-bold">
                          {count}
                        </span>
                      )}
                      {count === 1 && (
                        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-primary" />
                      )}
                    </div>
                  );
                },
              }}
            />
          </div>

          {/* Main Content */}
          <div className="space-y-4">
            <AgendaFilters
              search={search} onSearchChange={setSearch}
              statusFilter={statusFilter} onStatusChange={setStatusFilter}
              cityFilter={cityFilter} onCityChange={setCityFilter}
              cities={cities}
              periodStart={periodStart} onPeriodStartChange={setPeriodStart}
              periodEnd={periodEnd} onPeriodEndChange={setPeriodEnd}
            />

            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Artista(s)</TableHead>
                    <TableHead className="hidden md:table-cell">Cidade</TableHead>
                    <TableHead className="hidden md:table-cell">Dias</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum evento encontrado.</TableCell></TableRow>
                  ) : (
                    paginatedFiltered.map((event) => {
                      const artists = getEventArtists(event.id);
                      const displayArtists = getEventArtistsDisplay(event.id, event.artist);
                      const allArtistsText = artists.length > 0 ? artists.join(", ") : event.artist;
                      const isExpanded = expandedRow === event.id;

                      return (
                        <TableRow key={event.id} className="group">
                          <TableCell className="font-medium whitespace-nowrap">{format(parseISO(event.date), "dd/MM/yyyy")}</TableCell>
                          <TableCell>
                            <Badge className={`${statusColors[event.status] || "bg-muted text-muted-foreground"} capitalize text-[10px]`}>
                              {statusLabels[event.status] || event.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium cursor-pointer hover:text-primary" onClick={() => navigate(`/evento/${event.id}`)}>
                            {event.name}
                          </TableCell>
                          <TableCell>
                            {artists.length > 2 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-default">{displayArtists}</span>
                                </TooltipTrigger>
                                <TooltipContent><p className="text-xs">{allArtistsText}</p></TooltipContent>
                              </Tooltip>
                            ) : (
                              <span>{displayArtists}</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{event.city}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant="outline">{event.num_days || 1} dia(s)</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpandedRow(isExpanded ? null : event.id)}>
                                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Expandir dias</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/evento/${event.id}`)}>
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Ver detalhes</TooltipContent>
                              </Tooltip>
                              {isAdmin && !empresaReadOnly && (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/evento/${event.id}/editar`)}>
                                        <Edit className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Editar</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(event.id)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Excluir</TooltipContent>
                                  </Tooltip>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>

              {/* Expanded rows rendered outside table for layout */}
              {paginatedFiltered.map((event) =>
                expandedRow === event.id && empresaId ? (
                  <div key={`exp-${event.id}`} className="border-t">
                    <EventRowExpansion eventId={event.id} numDays={event.num_days || 1} empresaId={empresaId} />
                  </div>
                ) : null
              )}

              {/* Pagination */}
              {agendaTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Mostrando {agendaPage * AGENDA_PAGE_SIZE + 1}–{Math.min((agendaPage + 1) * AGENDA_PAGE_SIZE, filtered.length)} de {filtered.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={agendaPage === 0} onClick={() => setAgendaPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {agendaPage + 1} / {agendaTotalPages}
                    </span>
                    <Button variant="outline" size="sm" disabled={agendaPage >= agendaTotalPages - 1} onClick={() => setAgendaPage(p => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
