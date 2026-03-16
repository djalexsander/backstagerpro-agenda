import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, MapPin, Music, CheckCircle, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format, isAfter, startOfToday, endOfWeek, startOfWeek, parseISO, differenceInDays, differenceInHours } from "date-fns";
import { ptBR } from "date-fns/locale";

const statusColors: Record<string, string> = {
  confirmado: "bg-accent text-accent-foreground",
  pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  cancelado: "bg-destructive text-destructive-foreground",
};

export default function Dashboard() {
  const navigate = useNavigate();

  const { data: events = [] } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*").order("date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

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

  const getCountdown = () => {
    if (!nextEvent) return null;
    const eventDate = parseISO(nextEvent.date);
    const days = differenceInDays(eventDate, today);
    if (days > 0) return `${days} dia${days > 1 ? "s" : ""}`;
    const hours = differenceInHours(eventDate, new Date());
    if (hours > 0) return `${hours}h`;
    return "Hoje!";
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{events.length}</p>
                <p className="text-sm text-muted-foreground">Total de eventos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-bold">{confirmed}</p>
                <p className="text-sm text-muted-foreground">Confirmados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[hsl(var(--warning))]/10 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-[hsl(var(--warning))]" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pending}</p>
                <p className="text-sm text-muted-foreground">Pendentes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Next Event Hero */}
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
              <div className="flex items-center gap-2 text-muted-foreground">
                <Music className="h-4 w-4" /> {nextEvent.artist}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" /> {format(parseISO(nextEvent.date), "dd/MM/yyyy", { locale: ptBR })}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" /> {nextEvent.city} – {nextEvent.venue}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Week Events */}
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
                    <div className="flex items-center gap-1"><Music className="h-3 w-3" /> {event.artist}</div>
                    <div className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {format(parseISO(event.date), "EEE, dd/MM", { locale: ptBR })}</div>
                    <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {event.city}</div>
                    {event.show_time && <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {event.show_time.slice(0, 5)}</div>}
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
