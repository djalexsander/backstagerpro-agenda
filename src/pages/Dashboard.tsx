import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Calendar, Clock, MapPin, Music, CheckCircle, AlertCircle, DollarSign, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  format, isAfter, startOfToday, endOfWeek, startOfWeek, parseISO,
  differenceInDays, differenceInHours, startOfMonth, endOfMonth, subMonths
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";

const statusColors: Record<string, string> = {
  confirmado: "bg-accent text-accent-foreground",
  pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  cancelado: "bg-destructive text-destructive-foreground",
};

const fmt = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const PIE_COLORS = [
  "hsl(160, 84%, 39%)",  // accent/confirmado
  "hsl(38, 92%, 50%)",   // warning/pendente
  "hsl(0, 84%, 60%)",    // destructive/cancelado
];

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function Dashboard() {
  const navigate = useNavigate();
  const { empresaId } = useAuth();

  const { data: events = [] } = useQuery({
    queryKey: ["events", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("events").select("*").order("date", { ascending: true }).eq("empresa_id", empresaId);
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

  const { data: financials = [] } = useQuery({
    queryKey: ["financials-dashboard", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("financials").select("*, events(name, date)").eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const getEventArtists = (eventId: string): string => {
    const days = allEventDays.filter((d) => d.event_id === eventId);
    if (days.length === 0) return "";
    const artists = days.map((d) => d.artist).filter(Boolean);
    if (artists.length === 0) return "";
    if (artists.length <= 2) return artists.join(", ");
    return `${artists[0]} +${artists.length - 1}`;
  };

  const today = startOfToday();
  const weekStart = startOfWeek(today, { locale: ptBR });
  const weekEnd = endOfWeek(today, { locale: ptBR });

  const upcomingEvents = events.filter((e) => isAfter(parseISO(e.date), today) || format(parseISO(e.date), "yyyy-MM-dd") === format(today, "yyyy-MM-dd"));
  const nextEvent = upcomingEvents[0];
  const weekEvents = events.filter((e) => {
    const d = parseISO(e.date);
    return d >= weekStart && d <= weekEnd;
  });

  const confirmed = events.filter((e) => e.status === "confirmado").length;
  const pending = events.filter((e) => e.status === "pendente").length;
  const canceled = events.filter((e) => e.status === "cancelado").length;

  const getCountdown = () => {
    if (!nextEvent) return null;
    const eventDate = parseISO(nextEvent.date);
    const days = differenceInDays(eventDate, today);
    if (days > 0) return `${days} dia${days > 1 ? "s" : ""}`;
    const hours = differenceInHours(eventDate, new Date());
    if (hours > 0) return `${hours}h`;
    return "Hoje!";
  };

  // Financial metrics
  const parseExtras = (raw: any): number => {
    if (!raw) return 0;
    const arr = Array.isArray(raw) ? raw : [];
    return arr.reduce((s: number, e: any) => s + (e.value || 0), 0);
  };

  const totalReceita = financials.reduce((s, f) => s + (f.cache || 0), 0);
  const totalDespesas = financials.reduce((s, f) =>
    s + (f.transport || 0) + (f.food || 0) + (f.lodging || 0) + (f.other_costs || 0) + parseExtras((f as any).extra_costs), 0);
  const totalLucro = totalReceita - totalDespesas;

  // Monthly chart data (last 6 months)
  const monthlyData = useMemo(() => {
    const months: { name: string; receita: number; despesas: number; lucro: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(today, i);
      const mStart = startOfMonth(monthDate);
      const mEnd = endOfMonth(monthDate);
      const label = MONTH_NAMES[monthDate.getMonth()];

      let receita = 0, despesas = 0;
      financials.forEach((f) => {
        const eventDate = (f as any).events?.date;
        if (!eventDate) return;
        const d = parseISO(eventDate);
        if (d >= mStart && d <= mEnd) {
          receita += f.cache || 0;
          despesas += (f.transport || 0) + (f.food || 0) + (f.lodging || 0) + (f.other_costs || 0) + parseExtras((f as any).extra_costs);
        }
      });
      months.push({ name: label, receita, despesas, lucro: receita - despesas });
    }
    return months;
  }, [financials, today]);

  // Status pie data
  const statusData = useMemo(() => {
    const data = [];
    if (confirmed > 0) data.push({ name: "Confirmados", value: confirmed });
    if (pending > 0) data.push({ name: "Pendentes", value: pending });
    if (canceled > 0) data.push({ name: "Cancelados", value: canceled });
    return data;
  }, [confirmed, pending, canceled]);

  const chartConfig = {
    receita: { label: "Receita", color: "hsl(160, 84%, 39%)" },
    despesas: { label: "Despesas", color: "hsl(0, 84%, 60%)" },
    lucro: { label: "Lucro", color: "hsl(347, 77%, 50%)" },
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>

      {/* Event stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center"><Calendar className="h-4 w-4 text-primary" /></div>
              <div><p className="text-xl font-bold">{events.length}</p><p className="text-xs text-muted-foreground">Total eventos</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center"><CheckCircle className="h-4 w-4 text-accent" /></div>
              <div><p className="text-xl font-bold">{confirmed}</p><p className="text-xs text-muted-foreground">Confirmados</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-[hsl(var(--warning))]/10 flex items-center justify-center"><AlertCircle className="h-4 w-4 text-[hsl(var(--warning))]" /></div>
              <div><p className="text-xl font-bold">{pending}</p><p className="text-xs text-muted-foreground">Pendentes</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertCircle className="h-4 w-4 text-destructive" /></div>
              <div><p className="text-xl font-bold">{canceled}</p><p className="text-xs text-muted-foreground">Cancelados</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center"><DollarSign className="h-4 w-4 text-accent" /></div>
              <div><p className="text-lg font-bold text-accent">{fmt(totalReceita)}</p><p className="text-xs text-muted-foreground">Receita total</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center"><TrendingDown className="h-4 w-4 text-destructive" /></div>
              <div><p className="text-lg font-bold text-destructive">{fmt(totalDespesas)}</p><p className="text-xs text-muted-foreground">Despesas total</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-primary" /></div>
              <div><p className={`text-lg font-bold ${totalLucro >= 0 ? "text-accent" : "text-destructive"}`}>{fmt(totalLucro)}</p><p className="text-xs text-muted-foreground">Lucro líquido</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly bar chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Financeiro Mensal</CardTitle>
          </CardHeader>
          <CardContent>
            {financials.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhum dado financeiro cadastrado.</p>
            ) : (
              <ChartContainer config={chartConfig} className="h-[240px] w-full">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" className="text-xs fill-muted-foreground" tick={{ fontSize: 12 }} />
                  <YAxis className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(value) => fmt(Number(value))} />} />
                  <Bar dataKey="receita" fill="hsl(160, 84%, 39%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="despesas" fill="hsl(0, 84%, 60%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Status pie chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status dos Eventos</CardTitle>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhum evento cadastrado.</p>
            ) : (
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="45%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                      {statusData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Next event */}
      {nextEvent && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/evento/${nextEvent.id}`)}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Próximo Evento</CardTitle>
              <Badge className="text-base px-3 py-1 bg-primary text-primary-foreground">{getCountdown()}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h2 className="text-xl md:text-2xl font-bold mb-3">{nextEvent.name}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground"><Music className="h-4 w-4" /> {getEventArtists(nextEvent.id) || nextEvent.artist}</div>
              <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="h-4 w-4" /> {format(parseISO(nextEvent.date), "dd/MM/yyyy", { locale: ptBR })}</div>
              <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" /> {nextEvent.city} – {nextEvent.venue}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Week events */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Eventos da Semana</h2>
        {weekEvents.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum evento esta semana.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {weekEvents.map((event) => (
              <Card key={event.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/evento/${event.id}`)}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-sm truncate flex-1 mr-2">{event.name}</h3>
                    <Badge className={`text-xs shrink-0 ${statusColors[event.status]}`}>{event.status}</Badge>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1"><Music className="h-3 w-3" /> {getEventArtists(event.id) || event.artist}</div>
                    <div className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {format(parseISO(event.date), "EEE, dd/MM", { locale: ptBR })}</div>
                    <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {event.city}</div>
                    {event.num_days > 1 && (
                      <div className="flex items-center gap-1">📅 {event.num_days} dias</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
