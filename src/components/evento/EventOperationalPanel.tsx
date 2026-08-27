import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Calendar, Clock, MapPin, Music, Users, Truck, FileText, ClipboardList, Info, Wrench, Phone, Building2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { ChecklistItem } from "@/hooks/useEventChecklist";

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

interface Props {
  event: any;
  eventDays: any[];
  teamMembers: any[];
  files: any[];
}

export function EventOperationalPanel({ event, eventDays, teamMembers, files }: Props) {
  const { hasModule } = useCompanyModules();
  const hasChecklist = hasModule(MODULE_KEYS.CHECKLIST_TECNICO);

  // Load checklist items if module is active
  const { data: checklistItems = [] } = useQuery({
    queryKey: ["event-checklist", event.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_checklist_items")
        .select("*")
        .eq("event_id", event.id);
      if (error) throw error;
      return data as ChecklistItem[];
    },
    enabled: hasChecklist,
  });

  const checklistTotal = checklistItems.length;
  const checklistDone = checklistItems.filter(i => i.concluido).length;
  const checklistProgress = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0;

  const documentFiles = files.filter(f => f.file_type === "event_rider" || f.file_type === "material_list");
  const riderFiles = files.filter(f => f.file_type === "artist_rider");

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <Card className="border-primary/30">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">{event.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">Painel Operacional do Evento</p>
            </div>
            <Badge className={`text-sm px-3 py-1 ${statusColors[event.status]}`}>
              {statusLabels[event.status] || event.status}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Event Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" /> Resumo do Evento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Artista:</span>
              <span className="font-medium">{event.artist || "A definir"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Data:</span>
              <span>{format(parseISO(event.date), "dd/MM/yyyy", { locale: ptBR })}</span>
            </div>
            {event.show_time && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Horário:</span>
                <span>{event.show_time.slice(0, 5)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Local:</span>
              <span>{[event.venue, event.city, event.state].filter(Boolean).join(", ") || "A definir"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Dias:</span>
              <span>{event.num_days || 1} dia(s)</span>
            </div>
            {event.logistics_departure && (
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Saída:</span>
                <span>{format(new Date(event.logistics_departure), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
              </div>
            )}
            {event.setup_time && (
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Montagem:</span>
                <span>{event.setup_time}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Team */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Equipe ({teamMembers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {teamMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nenhum membro escalado</p>
            ) : (
              <div className="space-y-2">
                {teamMembers.map((tm: any) => (
                  <div key={tm.funcionario_id} className="flex items-center gap-2 text-sm">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Users className="h-3 w-3 text-primary" />
                    </div>
                    <span className="font-medium">{tm.funcionarios?.nome}</span>
                    {tm.funcionarios?.funcao && (
                      <span className="text-muted-foreground">— {tm.funcionarios.funcao}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Checklist Summary (if module active) */}
        {hasChecklist && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" /> Checklist Técnico
              </CardTitle>
            </CardHeader>
            <CardContent>
              {checklistTotal === 0 ? (
                <p className="text-sm text-muted-foreground italic">Nenhum item no checklist</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>{checklistDone}/{checklistTotal} concluídos</span>
                    <Badge variant={checklistProgress === 100 ? "default" : "outline"}>{checklistProgress}%</Badge>
                  </div>
                  <Progress value={checklistProgress} className="h-2" />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Documents */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Documentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {documentFiles.length === 0 && riderFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nenhum documento anexado</p>
            ) : (
              <div className="space-y-1 text-sm">
                {[...documentFiles, ...riderFiles].map(f => (
                  <div key={f.id} className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{f.file_name}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contratante */}
        {(event.contratante_nome || event.contratante_cidade || event.contratante_telefone) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" /> Contratante
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {event.contratante_nome && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Contratante:</span>
                  <span>{event.contratante_nome}</span>
                </div>
              )}
              {event.contratante_cidade && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Cidade:</span>
                  <span>{event.contratante_cidade}</span>
                </div>
              )}
              {event.contratante_telefone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Telefone:</span>
                  <span>{event.contratante_telefone}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Observations */}
      {event.observations && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Observações Operacionais</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{event.observations}</p>
          </CardContent>
        </Card>
      )}

      {/* Staff notes */}
      {event.staff_notes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Informações para a Equipe</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{event.staff_notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Multi-day summary */}
      {eventDays.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Programação por Dia</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {eventDays.map(day => (
                <div key={day.id} className="flex items-center gap-4 text-sm p-2 rounded-md bg-muted/30">
                  <Badge variant="outline" className="shrink-0">Dia {day.day_number}</Badge>
                  {day.date && <span>{format(parseISO(day.date), "dd/MM", { locale: ptBR })}</span>}
                  {day.artist && <span className="font-medium">{day.artist}</span>}
                  {day.show_time && <span className="text-muted-foreground">{(day.show_time as string).slice(0, 5)}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
