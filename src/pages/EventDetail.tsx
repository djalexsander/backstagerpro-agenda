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

  const downloadFile = (filePath: string, fileName: string) => {
    const { data } = supabase.storage.from("event-files").getPublicUrl(filePath);
    const a = document.createElement("a");
    a.href = data.publicUrl;
    a.download = fileName;
    a.target = "_blank";
    a.click();
  };

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (!event) return <p className="text-center text-muted-foreground py-12">Evento não encontrado.</p>;

  const artistRider = files.find((f) => f.file_type === "artist_rider");
  const eventRider = files.find((f) => f.file_type === "event_rider");

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{event.name}</h1>
          <Badge className={`mt-2 ${statusColors[event.status]} capitalize`}>{event.status}</Badge>
        </div>
        <div className="flex gap-2 flex-wrap">
          {artistRider && (
            <Button variant="outline" size="sm" onClick={() => downloadFile(artistRider.file_path, artistRider.file_name)}>
              <Download className="h-4 w-4 mr-1" /> Rider Artista
            </Button>
          )}
          {eventRider && (
            <Button variant="outline" size="sm" onClick={() => downloadFile(eventRider.file_path, eventRider.file_name)}>
              <Download className="h-4 w-4 mr-1" /> Rider Evento
            </Button>
          )}
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Informações Gerais</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><Music className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Artista:</span> {event.artist}</div>
            <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Data:</span> {format(parseISO(event.date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</div>
            {event.show_time && <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Horário:</span> {event.show_time.slice(0, 5)}</div>}
            <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Local:</span> {event.venue}, {event.city}</div>
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
    </div>
  );
}
