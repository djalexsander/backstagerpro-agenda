import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Music, Clock, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface EventRowExpansionProps {
  eventId: string;
  numDays: number;
  empresaId: string;
}

interface DayForm {
  id?: string;
  day_number: number;
  date: string;
  artist: string;
  show_time: string;
  observations: string;
}

export function EventRowExpansion({ eventId, numDays, empresaId }: EventRowExpansionProps) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dayForms, setDayForms] = useState<DayForm[]>([]);

  const { data: eventDays = [], isLoading } = useQuery({
    queryKey: ["event-days-expansion", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_days")
        .select("*")
        .eq("event_id", eventId)
        .order("day_number", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const forms: DayForm[] = [];
    for (let i = 1; i <= numDays; i++) {
      const existing = eventDays.find((d) => d.day_number === i);
      forms.push({
        id: existing?.id,
        day_number: i,
        date: existing?.date || "",
        artist: existing?.artist || "",
        show_time: existing?.show_time || "",
        observations: existing?.observations || "",
      });
    }
    setDayForms(forms);
  }, [eventDays, numDays]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const day of dayForms) {
        const payload = {
          event_id: eventId,
          empresa_id: empresaId,
          day_number: day.day_number,
          date: day.date || null,
          artist: day.artist || "",
          show_time: day.show_time || null,
          observations: day.observations || null,
        };
        if (day.id) {
          await supabase.from("event_days").update(payload).eq("id", day.id);
        } else {
          await supabase.from("event_days").insert(payload);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-days-expansion", eventId] });
      queryClient.invalidateQueries({ queryKey: ["all-event-days"] });
      toast({ title: "Dias do evento salvos!" });
    },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  const updateDay = (index: number, field: keyof DayForm, value: string) => {
    setDayForms((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
  };

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Carregando dias...</div>;

  return (
    <div className="p-4 bg-muted/30 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" /> Dias do Evento ({numDays} dia{numDays > 1 ? "s" : ""})
        </h4>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-3 w-3 mr-1" /> Salvar
          </Button>
        )}
      </div>
      <div className="grid gap-3">
        {dayForms.map((day, idx) => (
          <div key={idx} className="rounded-lg border bg-card p-3 space-y-2">
            <Badge variant="outline" className="text-xs">Dia {day.day_number}</Badge>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Data</label>
                <Input type="date" className="h-8 text-xs" value={day.date} onChange={(e) => updateDay(idx, "date", e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground flex items-center gap-1"><Music className="h-3 w-3" /> Artista</label>
                <Input className="h-8 text-xs" value={day.artist} onChange={(e) => updateDay(idx, "artist", e.target.value)} disabled={!isAdmin} placeholder="Artista principal" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Horário</label>
                <Input type="time" className="h-8 text-xs" value={day.show_time} onChange={(e) => updateDay(idx, "show_time", e.target.value)} disabled={!isAdmin} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Observações</label>
              <Textarea className="text-xs min-h-[40px]" value={day.observations} onChange={(e) => updateDay(idx, "observations", e.target.value)} disabled={!isAdmin} placeholder="Observações do dia..." />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
