import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Music, FileText, Download, Trash2, Edit, Truck } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { exportEventPDF } from "@/lib/pdf-export";

const statusColors: Record<string, string> = {
  confirmado: "bg-accent text-accent-foreground",
  pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  cancelado: "bg-destructive text-destructive-foreground",
};

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: event, isLoading } = useQuery({
    queryKey: ["event", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: eventDays = [] } = useQuery({
    queryKey: ["event-days", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_days")
        .select("*")
        .eq("event_id", id!)
        .order("day_number", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: files = [] } = useQuery({
    queryKey: ["event-files", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("event_files").select("*").eq("event_id", id!);
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("events").delete().eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast({ title: "Evento excluído" });
      navigate("/agenda");
    },
  });


  const downloadFile = async (filePath: string, fileName: string) => {
    const { data } = supabase.storage.from("event-files").getPublicUrl(filePath);
    const response = await fetch(data.publicUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (!event) return <p className="text-center text-muted-foreground py-12">Evento não encontrado.</p>;

  const hasMultipleDays = eventDays.length > 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{event.name}</h1>
          <Badge className={`mt-2 ${statusColors[event.status]} capitalize`}>{event.status}</Badge>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => exportEventPDF(event)}>
            <FileText className="h-4 w-4 mr-1" /> Exportar PDF
          </Button>
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={() => navigate(`/evento/${id}/editar`)}>
                <Edit className="h-4 w-4 mr-1" /> Editar
              </Button>
              <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate()}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Event Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Informações Gerais</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Local:</span> {event.venue}, {event.city}</div>
            <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Dias:</span> {(event as any).num_days || 1} dia(s)</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Logística</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {event.logistics_departure && (
              <div className="flex items-center gap-2"><Truck className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Saída:</span> {format(parseISO(event.logistics_departure), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</div>
            )}
            {event.observations && (
              <div><p className="text-muted-foreground mb-1">Observações:</p><p className="whitespace-pre-wrap">{event.observations}</p></div>
            )}
            {event.material_list && (
              <div><p className="text-muted-foreground mb-1">Lista de Material:</p><p className="whitespace-pre-wrap">{event.material_list}</p></div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Event Days Cards */}
      {hasMultipleDays ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Music className="h-5 w-5 text-primary" />
            Dias do Evento
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {eventDays.map((day) => {
              const dayFile = files.find((f) => f.event_day_id === day.id);
              return (
                <Card key={day.id} className="border-primary/20 hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-bold text-primary">DIA {day.day_number}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {day.date && (
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>{format(parseISO(day.date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
                      </div>
                    )}
                    {day.artist && (
                      <div className="flex items-center gap-2">
                        <Music className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{day.artist}</span>
                      </div>
                    )}
                    {day.show_time && (
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>{(day.show_time as string).slice(0, 5)}</span>
                      </div>
                    )}
                    {day.observations && (
                      <div className="text-xs text-muted-foreground">
                        <p className="font-medium mb-1">Obs. Técnicas:</p>
                        <p className="whitespace-pre-wrap">{day.observations}</p>
                      </div>
                    )}
                    {dayFile && (
                      <div className="flex gap-2 pt-2 border-t border-border">
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => downloadFile(dayFile.file_path, dayFile.file_name)}>
                          <Download className="h-3 w-3 mr-1" /> Baixar Rider
                        </Button>
                      </div>
                    )}
                    {!dayFile && (
                      <p className="text-xs text-muted-foreground italic pt-2 border-t border-border">Sem rider técnico</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        /* Legacy single-day display */
        <Card>
          <CardHeader><CardTitle className="text-base">Detalhes do Show</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><Music className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Artista:</span> {event.artist}</div>
            <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Data:</span> {format(parseISO(event.date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</div>
            {event.show_time && <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Horário:</span> {event.show_time.slice(0, 5)}</div>}
            {files.length > 0 && (
              <div className="flex gap-2 pt-2">
                {files.map((f) => (
                  <Button key={f.id} variant="outline" size="sm" onClick={() => downloadFile(f.file_path, f.file_name)}>
                    <Download className="h-4 w-4 mr-1" /> {f.file_name}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
