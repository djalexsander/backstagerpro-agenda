import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleAccess } from "@/components/ModuleGate";
import { MODULE_KEYS } from "@/constants/module-keys";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  LayoutDashboard, Calendar, Clock, MapPin, Music, Users, Truck,
  FileText, ArrowRight, AlertCircle, CheckCircle2, ChevronRight
} from "lucide-react";
import { format, parseISO, isAfter, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";

const statusLabels: Record<string, string> = {
  confirmado: "Confirmado",
  pendente: "Pendente",
  cancelado: "Cancelado",
  em_negociacao: "Em Negociação",
  finalizado: "Finalizado",
};

const statusColors: Record<string, string> = {
  confirmado: "bg-accent text-accent-foreground",
  pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  cancelado: "bg-destructive text-destructive-foreground",
  em_negociacao: "bg-secondary text-secondary-foreground",
  finalizado: "bg-primary text-primary-foreground",
};

export default function PainelOperacional() {
  const navigate = useNavigate();
  const { empresaId } = useAuth();
  const { canAccess } = useModuleAccess(MODULE_KEYS.PAINEL_OPERACIONAL);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events-operational", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("empresa_id", empresaId)
        .in("status", ["confirmado", "pendente", "em_negociacao"])
        .order("date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: allTeam = [] } = useQuery({
    queryKey: ["all-event-team", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("event_funcionarios")
        .select("event_id, funcionario_id, funcionarios(nome, funcao)")
        .eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: allChecklist = [] } = useQuery({
    queryKey: ["all-checklist-operational", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("event_checklist_items")
        .select("event_id, concluido")
        .eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <LayoutDashboard className="h-16 w-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold text-muted-foreground">Módulo Painel Operacional não ativo</h2>
        <p className="text-sm text-muted-foreground/70 max-w-md">
          Ative o módulo Painel Operacional para acompanhar pendências, equipe e status de todos os eventos.
        </p>
        <Button variant="outline" onClick={() => navigate("/plano")}>Ver Módulos Disponíveis</Button>
      </div>
    );
  }

  const today = startOfToday();
  const upcoming = events.filter(e => isAfter(parseISO(e.date), today) || format(parseISO(e.date), "yyyy-MM-dd") === format(today, "yyyy-MM-dd"));
  const pendentes = events.filter(e => e.status === "pendente" || e.status === "em_negociacao");

  // Aggregate checklist by event
  const checklistByEvent = allChecklist.reduce<Record<string, { total: number; done: number }>>((acc, item) => {
    if (!acc[item.event_id]) acc[item.event_id] = { total: 0, done: 0 };
    acc[item.event_id].total++;
    if (item.concluido) acc[item.event_id].done++;
    return acc;
  }, {});

  const teamByEvent = allTeam.reduce<Record<string, any[]>>((acc, item) => {
    if (!acc[item.event_id]) acc[item.event_id] = [];
    acc[item.event_id].push(item);
    return acc;
  }, {});

  const totalChecklistItems = allChecklist.length;
  const totalChecklistDone = allChecklist.filter(i => i.concluido).length;
  const globalProgress = totalChecklistItems > 0 ? Math.round((totalChecklistDone / totalChecklistItems) * 100) : 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <LayoutDashboard className="h-7 w-7 text-primary" />
          Painel Operacional
        </h1>
        <p className="text-muted-foreground mt-1">
          Acompanhe pendências, equipe e preparação dos seus eventos.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-primary">{upcoming.length}</p>
            <p className="text-xs text-muted-foreground">Eventos Ativos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-[hsl(var(--warning))]">{pendentes.length}</p>
            <p className="text-xs text-muted-foreground">Pendências</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{allTeam.length}</p>
            <p className="text-xs text-muted-foreground">Escalações</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{globalProgress}%</p>
            <p className="text-xs text-muted-foreground">Checklist Geral</p>
            <Progress value={globalProgress} className="h-1.5 mt-1" />
          </CardContent>
        </Card>
      </div>

      {/* Event List */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Eventos em Andamento</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : upcoming.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Nenhum evento ativo no momento.
            </CardContent>
          </Card>
        ) : (
          upcoming.map(event => {
            const cl = checklistByEvent[event.id];
            const clProgress = cl ? Math.round((cl.done / cl.total) * 100) : null;
            const team = teamByEvent[event.id] || [];

            return (
              <Card
                key={event.id}
                className="hover:shadow-sm hover:border-primary/20 transition-all cursor-pointer"
                onClick={() => navigate(`/evento/${event.id}`)}
              >
                <CardContent className="py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{event.name}</h3>
                        <Badge className={`shrink-0 text-[10px] ${statusColors[event.status]}`}>
                          {statusLabels[event.status]}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Music className="h-3 w-3" /> {event.artist || "A definir"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> {format(parseISO(event.date), "dd/MM/yyyy", { locale: ptBR })}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {[event.venue, event.city].filter(Boolean).join(", ") || "A definir"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> {team.length} membro(s)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {clProgress !== null && (
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground mb-0.5">Checklist</p>
                          <Badge variant={clProgress === 100 ? "default" : "outline"} className="text-[10px]">
                            {clProgress}%
                          </Badge>
                        </div>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Tip */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground text-center">
            💡 Dica: Acesse o painel operacional detalhado de cada evento clicando nele e abrindo a aba "Painel Operacional".
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
