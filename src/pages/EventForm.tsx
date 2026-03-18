import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, Plus, Minus, Music, Trash2, FileText, Download, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import type { Database } from "@/integrations/supabase/types";

type EventStatus = Database["public"]["Enums"]["event_status"];

interface DayForm {
  date: string;
  artist: string;
  show_time: string;
  observations: string;
  riderFile: File | null;
  existingRiderId?: string;
  existingRiderName?: string;
}

interface MaterialFile {
  id?: string;
  file: File | null;
  name: string;
  path?: string;
  isExisting: boolean;
}

const emptyDay = (dayNum: number): DayForm => ({
  date: "", artist: "", show_time: "", observations: "", riderFile: null,
});

export default function EventForm() {
  const { id } = useParams<{ id: string }>();
  const isEditing = id && id !== "novo";
  const navigate = useNavigate();
  const { user, empresaId, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: "",
    city: "",
    venue: "",
    status: "pendente" as EventStatus,
    num_days: 1,
    observations: "",
    logistics_departure: "",
    material_list: "",
  });

  const [days, setDays] = useState<DayForm[]>([emptyDay(1)]);
  const [saving, setSaving] = useState(false);
  const [materialFiles, setMaterialFiles] = useState<MaterialFile[]>([]);
  const [deletedMaterialIds, setDeletedMaterialIds] = useState<string[]>([]);
  const [eventRiderFiles, setEventRiderFiles] = useState<MaterialFile[]>([]);
  const [deletedEventRiderIds, setDeletedEventRiderIds] = useState<string[]>([]);
  const [selectedFuncionarios, setSelectedFuncionarios] = useState<string[]>([]);

  const { data: existingEvent } = useQuery({
    queryKey: ["event", id],
    enabled: !!isEditing,
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: existingDays = [] } = useQuery({
    queryKey: ["event-days", id],
    enabled: !!isEditing,
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

  const { data: existingFiles = [] } = useQuery({
    queryKey: ["event-files", id],
    enabled: !!isEditing,
    queryFn: async () => {
      const { data, error } = await supabase.from("event_files").select("*").eq("event_id", id!);
      if (error) throw error;
      return data;
    },
  });

  const { data: funcionarios = [] } = useQuery({
    queryKey: ["funcionarios", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("funcionarios").select("id, nome, funcao, tipo").eq("empresa_id", empresaId).order("nome");
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const { data: existingTeam = [] } = useQuery({
    queryKey: ["event-team", id],
    enabled: !!isEditing,
    queryFn: async () => {
      const { data, error } = await supabase.from("event_funcionarios").select("funcionario_id").eq("event_id", id!);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (existingTeam.length > 0) {
      setSelectedFuncionarios(existingTeam.map((t: any) => t.funcionario_id));
    }
  }, [existingTeam]);

  useEffect(() => {
    if (existingEvent) {
      setForm({
        name: existingEvent.name,
        city: existingEvent.city,
        venue: existingEvent.venue,
        status: existingEvent.status,
        num_days: (existingEvent as any).num_days || 1,
        observations: existingEvent.observations || "",
        logistics_departure: existingEvent.logistics_departure?.slice(0, 16) || "",
        material_list: existingEvent.material_list || "",
      });
    }
  }, [existingEvent]);

  useEffect(() => {
    if (existingDays.length > 0) {
      const mapped = existingDays.map((d) => {
        const file = existingFiles.find((f) => f.event_day_id === d.id && f.file_type !== "material_list");
        return {
          date: d.date || "",
          artist: d.artist || "",
          show_time: d.show_time?.slice(0, 5) || "",
          observations: d.observations || "",
          riderFile: null,
          existingRiderId: file?.id,
          existingRiderName: file?.file_name,
        } as DayForm;
      });
      setDays(mapped);
    }
  }, [existingDays, existingFiles]);

  // Load existing material files
  useEffect(() => {
    if (existingFiles.length > 0) {
      const matFiles = existingFiles
        .filter((f) => f.file_type === "material_list")
        .map((f) => ({
          id: f.id, file: null, name: f.file_name, path: f.file_path, isExisting: true,
        }));
      setMaterialFiles(matFiles);

      const riderFiles = existingFiles
        .filter((f) => f.file_type === "event_rider")
        .map((f) => ({
          id: f.id, file: null, name: f.file_name, path: f.file_path, isExisting: true,
        }));
      setEventRiderFiles(riderFiles);
    }
  }, [existingFiles]);

  const handleNumDaysChange = (newNum: number) => {
    if (newNum < 1) return;
    if (newNum > 30) return;
    setForm((p) => ({ ...p, num_days: newNum }));
    setDays((prev) => {
      if (newNum > prev.length) {
        return [...prev, ...Array.from({ length: newNum - prev.length }, (_, i) => emptyDay(prev.length + i + 1))];
      }
      return prev.slice(0, newNum);
    });
  };

  const updateDay = (index: number, key: keyof DayForm, value: any) => {
    setDays((prev) => prev.map((d, i) => i === index ? { ...d, [key]: value } : d));
  };

  const uploadDayRider = async (file: File, eventId: string, eventDayId: string) => {
    const path = `${eventId}/day_${eventDayId}_${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from("event-files").upload(path, file);
    if (uploadError) throw uploadError;
    await supabase.from("event_files").delete().eq("event_day_id", eventDayId);
    const { error: insertError } = await supabase.from("event_files").insert({
      event_id: eventId,
      event_day_id: eventDayId,
      file_type: "artist_rider" as any,
      file_path: path,
      file_name: file.name,
      empresa_id: empresaId,
    } as any);
    if (insertError) throw insertError;
  };

  // Material file handlers
  const handleAddMaterialFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newFiles: MaterialFile[] = Array.from(files).map((f) => ({
      file: f,
      name: f.name,
      isExisting: false,
    }));
    setMaterialFiles((prev) => [...prev, ...newFiles]);
    e.target.value = "";
  };

  const handleRemoveMaterialFile = (index: number) => {
    const item = materialFiles[index];
    if (item.isExisting && item.id) {
      setDeletedMaterialIds((prev) => [...prev, item.id!]);
    }
    setMaterialFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleReplaceMaterialFile = (index: number, file: File) => {
    setMaterialFiles((prev) =>
      prev.map((m, i) =>
        i === index
          ? { ...m, file, name: file.name, isExisting: false }
          : m
      )
    );
  };

  // Event rider file handlers
  const handleAddEventRiderFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newFiles: MaterialFile[] = Array.from(files).map((f) => ({
      file: f, name: f.name, isExisting: false,
    }));
    setEventRiderFiles((prev) => [...prev, ...newFiles]);
    e.target.value = "";
  };

  const handleRemoveEventRiderFile = (index: number) => {
    const item = eventRiderFiles[index];
    if (item.isExisting && item.id) {
      setDeletedEventRiderIds((prev) => [...prev, item.id!]);
    }
    setEventRiderFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleReplaceEventRiderFile = (index: number, file: File) => {
    setEventRiderFiles((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, file, name: file.name, isExisting: false } : m
      )
    );
  };

  const downloadMaterialFile = async (filePath: string, fileName: string) => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const firstDay = days[0];
      const payload = {
        name: form.name,
        artist: firstDay?.artist || "Vários",
        date: firstDay?.date || new Date().toISOString().slice(0, 10),
        status: form.status,
        city: form.city,
        venue: form.venue,
        show_time: firstDay?.show_time || null,
        logistics_departure: form.logistics_departure || null,
        observations: form.observations || null,
        material_list: null, // no longer using text field
        created_by: user?.id,
        empresa_id: empresaId,
        num_days: form.num_days,
      };

      let eventId: string;

      if (isEditing) {
        const { error } = await supabase.from("events").update(payload as any).eq("id", id!);
        if (error) throw error;
        eventId = id!;
        await supabase.from("event_days").delete().eq("event_id", eventId);
      } else {
        const { data, error } = await supabase.from("events").insert(payload as any).select("id").single();
        if (error) throw error;
        eventId = data.id;
      }

      // Create event_days
      for (let i = 0; i < days.length; i++) {
        const day = days[i];
        const { data: dayData, error: dayError } = await supabase.from("event_days").insert({
          event_id: eventId,
          day_number: i + 1,
          date: day.date || null,
          artist: day.artist || "",
          show_time: day.show_time || null,
          observations: day.observations || null,
          empresa_id: empresaId,
        } as any).select("id").single();
        if (dayError) throw dayError;

        if (day.riderFile && dayData) {
          await uploadDayRider(day.riderFile, eventId, dayData.id);
        }
      }

      // Handle material file deletions
      for (const delId of deletedMaterialIds) {
        const fileToDelete = existingFiles.find((f) => f.id === delId);
        if (fileToDelete) {
          await supabase.storage.from("event-files").remove([fileToDelete.file_path]);
          await supabase.from("event_files").delete().eq("id", delId);
        }
      }

      // Upload new material files
      for (const mat of materialFiles) {
        if (mat.file) {
          // If replacing an existing one, delete the old storage file
          if (mat.isExisting && mat.id && mat.path) {
            await supabase.storage.from("event-files").remove([mat.path]);
            await supabase.from("event_files").delete().eq("id", mat.id);
          }
          const path = `${eventId}/material_${Date.now()}_${mat.file.name}`;
          const { error: upErr } = await supabase.storage.from("event-files").upload(path, mat.file);
          if (upErr) throw upErr;
          const { error: insErr } = await supabase.from("event_files").insert({
            event_id: eventId,
            file_type: "material_list" as any,
            file_path: path,
            file_name: mat.file.name,
            empresa_id: empresaId,
          } as any);
          if (insErr) throw insErr;
        }
      }

      // Handle event rider file deletions
      for (const delId of deletedEventRiderIds) {
        const fileToDelete = existingFiles.find((f) => f.id === delId);
        if (fileToDelete) {
          await supabase.storage.from("event-files").remove([fileToDelete.file_path]);
          await supabase.from("event_files").delete().eq("id", delId);
        }
      }

      // Upload new event rider files
      for (const rdr of eventRiderFiles) {
        if (rdr.file) {
          if (rdr.isExisting && rdr.id && rdr.path) {
            await supabase.storage.from("event-files").remove([rdr.path]);
            await supabase.from("event_files").delete().eq("id", rdr.id);
          }
          const path = `${eventId}/rider_${Date.now()}_${rdr.file.name}`;
          const { error: upErr } = await supabase.storage.from("event-files").upload(path, rdr.file);
          if (upErr) throw upErr;
          const { error: insErr } = await supabase.from("event_files").insert({
            event_id: eventId,
            file_type: "event_rider" as any,
            file_path: path,
            file_name: rdr.file.name,
            empresa_id: empresaId,
          } as any);
          if (insErr) throw insErr;
        }
      }

      // Save team assignments
      await supabase.from("event_funcionarios").delete().eq("event_id", eventId);
      if (selectedFuncionarios.length > 0) {
        const teamRows = selectedFuncionarios.map((fid) => ({
          event_id: eventId,
          funcionario_id: fid,
          empresa_id: empresaId,
        }));
        const { error: teamErr } = await supabase.from("event_funcionarios").insert(teamRows as any);
        if (teamErr) throw teamErr;
      }

      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-days", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-files", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-team", eventId] });
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
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
        {isEditing ? "Editar Evento" : "Novo Evento"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Event Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Informações do Evento</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nome do Evento *</Label>
                <Input value={form.name} onChange={set("name")} required />
              </div>
              <div className="space-y-2">
                <Label>Cidade *</Label>
                <Input value={form.city} onChange={set("city")} required />
              </div>
              <div className="space-y-2">
                <Label>Local *</Label>
                <Input value={form.venue} onChange={set("venue")} required />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v as EventStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pendente">Pendente</SelectItem>
                    <SelectItem value="confirmado">Confirmado</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                    <SelectItem value="em_negociacao">Em Negociação</SelectItem>
                    <SelectItem value="finalizado">Finalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quantidade de Dias / Shows</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" onClick={() => handleNumDaysChange(form.num_days - 1)}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={form.num_days}
                    onChange={(e) => handleNumDaysChange(parseInt(e.target.value) || 1)}
                    className="w-20 text-center"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => handleNumDaysChange(form.num_days + 1)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Logística & Observações</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Saída Logística</Label>
                <Input type="datetime-local" value={form.logistics_departure} onChange={set("logistics_departure")} />
              </div>
              <div className="space-y-2">
                <Label>Observações Gerais</Label>
                <Textarea value={form.observations} onChange={set("observations")} rows={4} />
              </div>
              <div className="space-y-2">
                <Label>Lista de Material (PDFs)</Label>
                {materialFiles.length > 0 && (
                  <div className="space-y-2">
                    {materialFiles.map((mat, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate flex-1" title={mat.name}>{mat.name}</span>
                        {mat.isExisting && mat.path && (
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => downloadMaterialFile(mat.path!, mat.name)} title="Baixar">
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {isAdmin && (
                          <>
                            <label className="cursor-pointer" title="Substituir">
                              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 pointer-events-none">
                                <Upload className="h-3.5 w-3.5" />
                              </Button>
                              <input
                                type="file"
                                accept=".pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleReplaceMaterialFile(i, f);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={() => handleRemoveMaterialFile(i)} title="Remover">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {isAdmin && (
                  <label className="flex items-center gap-2 border border-dashed rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Adicionar PDF de material...</span>
                    <input
                      type="file"
                      accept=".pdf"
                      multiple
                      className="hidden"
                      onChange={handleAddMaterialFile}
                    />
                  </label>
                )}
                {!isAdmin && materialFiles.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">Nenhum arquivo de material.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Rider / Projeto do Evento (PDFs)</Label>
                {eventRiderFiles.length > 0 && (
                  <div className="space-y-2">
                    {eventRiderFiles.map((rdr, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate flex-1" title={rdr.name}>{rdr.name}</span>
                        {rdr.isExisting && rdr.path && (
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => downloadMaterialFile(rdr.path!, rdr.name)} title="Baixar">
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {isAdmin && (
                          <>
                            <label className="cursor-pointer" title="Substituir">
                              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 pointer-events-none">
                                <Upload className="h-3.5 w-3.5" />
                              </Button>
                              <input
                                type="file"
                                accept=".pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleReplaceEventRiderFile(i, f);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={() => handleRemoveEventRiderFile(i)} title="Remover">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {isAdmin && (
                  <label className="flex items-center gap-2 border border-dashed rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Adicionar PDF de rider/projeto...</span>
                    <input
                      type="file"
                      accept=".pdf"
                      multiple
                      className="hidden"
                      onChange={handleAddEventRiderFile}
                    />
                  </label>
                )}
                {!isAdmin && eventRiderFiles.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">Nenhum arquivo de rider/projeto.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Equipe Escalada */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Equipe Escalada
            </CardTitle>
          </CardHeader>
          <CardContent>
            {funcionarios.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nenhum funcionário cadastrado.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {funcionarios.map((f: any) => (
                  <label key={f.id} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors">
                    <Checkbox
                      checked={selectedFuncionarios.includes(f.id)}
                      onCheckedChange={(checked) => {
                        setSelectedFuncionarios((prev) =>
                          checked ? [...prev, f.id] : prev.filter((id) => id !== f.id)
                        );
                      }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{f.nome}</p>
                      {f.funcao && <p className="text-xs text-muted-foreground truncate">{f.funcao}</p>}
                    </div>
                    <Badge variant="outline" className="ml-auto text-xs shrink-0">
                      {f.tipo === "freelancer" ? "Freelancer" : "Equipe"}
                    </Badge>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Day Cards */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Music className="h-5 w-5 text-primary" />
            Dias do Evento ({days.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {days.map((day, i) => (
              <Card key={i} className="border-primary/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold text-primary">DIA {i + 1}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Data do Show</Label>
                    <Input
                      type="date"
                      value={day.date}
                      onChange={(e) => updateDay(i, "date", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Artista *</Label>
                    <Input
                      value={day.artist}
                      onChange={(e) => updateDay(i, "artist", e.target.value)}
                      placeholder="Nome do artista"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Horário</Label>
                    <Input
                      type="time"
                      value={day.show_time}
                      onChange={(e) => updateDay(i, "show_time", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Observações Técnicas</Label>
                    <Textarea
                      value={day.observations}
                      onChange={(e) => updateDay(i, "observations", e.target.value)}
                      rows={2}
                      placeholder="Obs. técnicas..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rider Técnico (PDF)</Label>
                    <label className="flex items-center gap-2 border border-dashed rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">
                        {day.riderFile?.name || day.existingRiderName || "Selecionar PDF..."}
                      </span>
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => updateDay(i, "riderFile", e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando..." : isEditing ? "Atualizar" : "Criar Evento"}
          </Button>
        </div>
      </form>
    </div>
  );
}
