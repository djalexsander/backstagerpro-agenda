import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";

type EventStatus = Database["public"]["Enums"]["event_status"];

export default function EventForm() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isEditing = id && id !== "novo";
  const navigate = useNavigate();
  const { user, empresaId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: "", artist: "", date: "", status: "pendente" as EventStatus,
    city: "", venue: "", show_time: "", logistics_departure: "",
    observations: "", material_list: "",
  });
  const [artistRider, setArtistRider] = useState<File | null>(null);
  const [eventRider, setEventRider] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: existingEvent } = useQuery({
    queryKey: ["event", id],
    enabled: !!isEditing,
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (existingEvent) {
      setForm({
        name: existingEvent.name, artist: existingEvent.artist, date: existingEvent.date,
        status: existingEvent.status, city: existingEvent.city, venue: existingEvent.venue,
        show_time: existingEvent.show_time || "", logistics_departure: existingEvent.logistics_departure?.slice(0, 16) || "",
        observations: existingEvent.observations || "", material_list: existingEvent.material_list || "",
      });
    }
  }, [existingEvent]);

  const uploadFile = async (file: File, eventId: string, fileType: "artist_rider" | "event_rider") => {
    const path = `${eventId}/${fileType}_${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from("event-files").upload(path, file);
    if (uploadError) throw uploadError;
    await supabase.from("event_files").delete().eq("event_id", eventId).eq("file_type", fileType);
    const { error: insertError } = await supabase.from("event_files").insert({
      event_id: eventId, file_type: fileType, file_path: path, file_name: file.name, empresa_id: empresaId,
    } as any);
    if (insertError) throw insertError;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const payload = {
        name: form.name, artist: form.artist, date: form.date, status: form.status,
        city: form.city, venue: form.venue,
        show_time: form.show_time || null,
        logistics_departure: form.logistics_departure || null,
        observations: form.observations || null,
        material_list: form.material_list || null,
        created_by: user?.id,
        empresa_id: empresaId,
      };

      let eventId: string;

      if (isEditing) {
        const { error } = await supabase.from("events").update(payload as any).eq("id", id!);
        if (error) throw error;
        eventId = id!;
      } else {
        const { data, error } = await supabase.from("events").insert(payload as any).select("id").single();
        if (error) throw error;
        eventId = data.id;
      }

      if (artistRider) await uploadFile(artistRider, eventId, "artist_rider");
      if (eventRider) await uploadFile(eventRider, eventId, "event_rider");

      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      toast({ title: isEditing ? "Evento atualizado!" : "Evento criado!" });
      navigate(`/evento/${eventId}`);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{isEditing ? "Editar Evento" : "Novo Evento"}</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Informações Principais</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Nome do Evento *</Label><Input value={form.name} onChange={set("name")} required /></div>
              <div className="space-y-2"><Label>Artista *</Label><Input value={form.artist} onChange={set("artist")} required /></div>
              <div className="space-y-2"><Label>Data *</Label><Input type="date" value={form.date} onChange={set("date")} required /></div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v as EventStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pendente">Pendente</SelectItem>
                    <SelectItem value="confirmado">Confirmado</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Cidade *</Label><Input value={form.city} onChange={set("city")} required /></div>
              <div className="space-y-2"><Label>Local *</Label><Input value={form.venue} onChange={set("venue")} required /></div>
              <div className="space-y-2"><Label>Horário do Show</Label><Input type="time" value={form.show_time} onChange={set("show_time")} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Logística</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Saída Logística</Label><Input type="datetime-local" value={form.logistics_departure} onChange={set("logistics_departure")} /></div>
              <div className="space-y-2"><Label>Observações</Label><Textarea value={form.observations} onChange={set("observations")} rows={4} /></div>
              <div className="space-y-2"><Label>Lista de Material</Label><Textarea value={form.material_list} onChange={set("material_list")} rows={4} /></div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Arquivos PDF</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rider Técnico do Artista</Label>
                <label className="flex items-center gap-2 border border-dashed rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{artistRider?.name || "Selecionar PDF..."}</span>
                  <input type="file" accept=".pdf" className="hidden" onChange={(e) => setArtistRider(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div className="space-y-2">
                <Label>Rider Técnico do Evento</Label>
                <label className="flex items-center gap-2 border border-dashed rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{eventRider?.name || "Selecionar PDF..."}</span>
                  <input type="file" accept=".pdf" className="hidden" onChange={(e) => setEventRider(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? "Salvando..." : isEditing ? "Atualizar" : "Criar Evento"}</Button>
        </div>
      </form>
    </div>
  );
}
