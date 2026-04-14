import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Trash2, Edit, ArrowLeft, ImageIcon, ClipboardList, LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { useModuleAccess } from "@/components/ModuleGate";
import { MODULE_KEYS } from "@/constants/module-keys";
import { EventChecklistTab } from "@/components/evento/EventChecklistTab";
import { EventOperationalPanel } from "@/components/evento/EventOperationalPanel";
import { EventDetailContent } from "@/components/evento/EventDetailContent";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { exportEventPDF } from "@/lib/pdf-export";

const statusColors: Record<string, string> = {
  confirmado: "bg-accent text-accent-foreground",
  pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  cancelado: "bg-destructive text-destructive-foreground",
  em_negociacao: "bg-secondary text-secondary-foreground",
  finalizado: "bg-primary text-primary-foreground",
};



export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, empresaNome, empresaLogoUrl } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [downloadPending, setDownloadPending] = useState<{ path: string; name: string } | null>(null);
  const { canAccess: hasChecklist } = useModuleAccess(MODULE_KEYS.CHECKLIST_TECNICO);
  const { canAccess: hasOperacional } = useModuleAccess(MODULE_KEYS.PAINEL_OPERACIONAL);

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

  const { data: teamMembers = [] } = useQuery({
    queryKey: ["event-team", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_funcionarios")
        .select("funcionario_id, funcionarios(nome, funcao, tipo)")
        .eq("event_id", id!);
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

  const requestDownload = (filePath: string, fileName: string) => {
    setDownloadPending({ path: filePath, name: fileName });
  };

  const confirmDownload = async () => {
    if (!downloadPending) return;
    const { path, name } = downloadPending;
    setDownloadPending(null);
    try {
      const { data, error: signError } = await supabase.storage.from("event-files").createSignedUrl(path, 3600);
      if (signError || !data?.signedUrl) throw signError || new Error("Erro ao gerar URL");
      const response = await fetch(data.signedUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Erro ao baixar arquivo", description: err.message, variant: "destructive" });
    }
  };

  const handleUploadRider = async (dayId: string, file: File) => {
    try {
      // Delete existing rider for this day
      const existingFile = files.find((f) => f.event_day_id === dayId && f.file_type !== "material_list");
      if (existingFile) {
        await supabase.storage.from("event-files").remove([existingFile.file_path]);
        await supabase.from("event_files").delete().eq("id", existingFile.id);
      }
      const path = `${id}/day_${dayId}_${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("event-files").upload(path, file);
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("event_files").insert({
        event_id: id!,
        event_day_id: dayId,
        file_type: "artist_rider" as any,
        file_path: path,
        file_name: file.name,
        empresa_id: event?.empresa_id,
      } as any);
      if (insErr) throw insErr;
      queryClient.invalidateQueries({ queryKey: ["event-files", id] });
      toast({ title: "Rider atualizado!" });
    } catch (err: any) {
      toast({ title: "Erro ao enviar rider", description: err.message, variant: "destructive" });
    }
  };

  const handleRemoveRider = async (fileId: string, filePath: string) => {
    try {
      await supabase.storage.from("event-files").remove([filePath]);
      await supabase.from("event_files").delete().eq("id", fileId);
      queryClient.invalidateQueries({ queryKey: ["event-files", id] });
      toast({ title: "Rider removido!" });
    } catch (err: any) {
      toast({ title: "Erro ao remover rider", description: err.message, variant: "destructive" });
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (!event) return <p className="text-center text-muted-foreground py-12">Evento não encontrado.</p>;

  const hasMultipleDays = eventDays.length > 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{event.name}</h1>
          <Badge className={`mt-2 ${statusColors[event.status]} capitalize`}>{event.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {useModuleAccess(MODULE_KEYS.RELATORIOS).canAccess && (
            <>
              <Button variant="outline" size="sm" onClick={() => exportEventPDF(event, eventDays, { empresaNome, empresaLogoUrl }, teamMembers.map((tm: any) => ({ nome: tm.funcionarios?.nome || "", funcao: tm.funcionarios?.funcao || "" })))}>
                <FileText className="h-4 w-4 mr-1" /> PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportEventPDF(event, eventDays, { empresaNome, empresaLogoUrl }, teamMembers.map((tm: any) => ({ nome: tm.funcionarios?.nome || "", funcao: tm.funcionarios?.funcao || "" })), "png")}>
                <ImageIcon className="h-4 w-4 mr-1" /> PNG
              </Button>
            </>
          )}
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

      {/* Tabs for modules */}
      {(hasChecklist || hasOperacional) ? (
        <Tabs defaultValue="detalhes">
          <TabsList>
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
            {hasOperacional && <TabsTrigger value="operacional"><LayoutDashboard className="h-4 w-4 mr-1" /> Painel Operacional</TabsTrigger>}
            {hasChecklist && <TabsTrigger value="checklist"><ClipboardList className="h-4 w-4 mr-1" /> Checklist</TabsTrigger>}
          </TabsList>
          <TabsContent value="detalhes" className="space-y-6 mt-4">
            <EventDetailContent event={event} eventDays={eventDays} files={files} teamMembers={teamMembers} isAdmin={isAdmin} requestDownload={requestDownload} handleUploadRider={handleUploadRider} handleRemoveRider={handleRemoveRider} />
          </TabsContent>
          {hasOperacional && (
            <TabsContent value="operacional" className="mt-4">
              <EventOperationalPanel event={event} eventDays={eventDays} teamMembers={teamMembers} files={files} />
            </TabsContent>
          )}
          {hasChecklist && (
            <TabsContent value="checklist" className="mt-4">
              <EventChecklistTab eventId={event.id} />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <EventDetailContent event={event} eventDays={eventDays} files={files} teamMembers={teamMembers} isAdmin={isAdmin} requestDownload={requestDownload} handleUploadRider={handleUploadRider} handleRemoveRider={handleRemoveRider} />
      )}
      {/* Download Confirmation Dialog */}
      <AlertDialog open={!!downloadPending} onOpenChange={(open) => { if (!open) setDownloadPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Download</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja baixar o arquivo <span className="font-medium text-foreground">"{downloadPending?.name}"</span>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDownload}>Baixar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
