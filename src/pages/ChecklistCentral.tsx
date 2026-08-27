import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleAccess } from "@/components/ModuleGate";
import { MODULE_KEYS } from "@/constants/module-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ClipboardList, Calendar, Music, MapPin, CheckCircle2, Circle,
  ChevronRight, ArrowRight
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function ChecklistCentral() {
  const navigate = useNavigate();
  const { empresaId } = useAuth();
  const { canAccess } = useModuleAccess(MODULE_KEYS.CHECKLIST_TECNICO);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events-checklist-central", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("events")
        .select("id, name, artist, date, venue, city, status")
        .eq("empresa_id", empresaId)
        .order("date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: allChecklist = [] } = useQuery({
    queryKey: ["all-checklist-central", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("event_checklist_items")
        .select("event_id, concluido, categoria")
        .eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <ClipboardList className="h-16 w-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold text-muted-foreground">Módulo Checklist não ativo</h2>
        <p className="text-sm text-muted-foreground/70 max-w-md">
          Ative o módulo Checklist Técnico para gerenciar tarefas, importar listas e acompanhar a preparação dos eventos.
        </p>
        <Button variant="outline" onClick={() => navigate("/plano")}>Ver Módulos Disponíveis</Button>
      </div>
    );
  }

  const checklistByEvent = allChecklist.reduce<Record<string, { total: number; done: number }>>((acc, item) => {
    if (!acc[item.event_id]) acc[item.event_id] = { total: 0, done: 0 };
    acc[item.event_id].total++;
    if (item.concluido) acc[item.event_id].done++;
    return acc;
  }, {});

  const totalItems = allChecklist.length;
  const totalDone = allChecklist.filter(i => i.concluido).length;
  const globalProgress = totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0;
  const eventsWithChecklist = events.filter(e => checklistByEvent[e.id]);
  const eventsWithoutChecklist = events.filter(e => !checklistByEvent[e.id]);

  const statusColors: Record<string, string> = {
    confirmado: "bg-accent text-accent-foreground",
    pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
    cancelado: "bg-destructive text-destructive-foreground",
    em_negociacao: "bg-secondary text-secondary-foreground",
    finalizado: "bg-primary text-primary-foreground",
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <ClipboardList className="h-7 w-7 text-primary" />
          Checklist Técnico
        </h1>
        <p className="text-muted-foreground mt-1">
          Gerencie checklists de todos os eventos em um só lugar.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-primary">{totalItems}</p>
            <p className="text-xs text-muted-foreground">Itens Totais</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-accent">{totalDone}</p>
            <p className="text-xs text-muted-foreground">Concluídos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-[hsl(var(--warning))]">{totalItems - totalDone}</p>
            <p className="text-xs text-muted-foreground">Pendentes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{globalProgress}%</p>
            <p className="text-xs text-muted-foreground">Progresso</p>
            <Progress value={globalProgress} className="h-1.5 mt-1" />
          </CardContent>
        </Card>
      </div>

      {/* Events with Checklist */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Eventos com Checklist</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : eventsWithChecklist.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Nenhum evento possui checklist ainda. Acesse um evento e crie itens na aba Checklist.
            </CardContent>
          </Card>
        ) : (
          eventsWithChecklist.map(event => {
            const cl = checklistByEvent[event.id];
            const progress = Math.round((cl.done / cl.total) * 100);

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
                          {event.status}
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
                          <MapPin className="h-3 w-3" /> {event.venue || "A definir"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-center min-w-[80px]">
                        <div className="flex items-center justify-center gap-1 text-xs mb-0.5">
                          {progress === 100 ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                          ) : (
                            <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span>{cl.done}/{cl.total}</span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Events without Checklist */}
      {eventsWithoutChecklist.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-muted-foreground">Eventos sem Checklist</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {eventsWithoutChecklist.slice(0, 6).map(event => (
              <Card
                key={event.id}
                className="opacity-70 hover:opacity-100 hover:border-primary/20 transition-all cursor-pointer"
                onClick={() => navigate(`/evento/${event.id}`)}
              >
                <CardContent className="py-3">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{event.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {format(parseISO(event.date), "dd/MM", { locale: ptBR })}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {eventsWithoutChecklist.length > 6 && (
            <p className="text-xs text-muted-foreground text-center">
              +{eventsWithoutChecklist.length - 6} eventos sem checklist
            </p>
          )}
        </div>
      )}

      {/* Tip */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground text-center">
            💡 Dica: Para criar ou editar o checklist de um evento, clique nele e acesse a aba "Checklist". Você pode importar itens de PDF, Excel ou Word.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
