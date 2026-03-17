import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  Database, Download, Upload, Trash2, RotateCcw, Plus, CalendarDays, Shield, Clock
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const MAX_AUTO_BACKUPS = 10;

interface BackupPayload {
  empresa_id: string;
  data_backup: string;
  eventos: any[];
  event_days: any[];
  event_files: any[];
  financials: any[];
}

interface BackupRow {
  id: string;
  empresa_id: string;
  nome: string;
  tipo: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  payload: any;
  created_at: string;
}

export default function Backups() {
  const { empresaId } = useAuth();
  const queryClient = useQueryClient();
  const [periodOpen, setPeriodOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);

  const { data: backups = [], isLoading } = useQuery({
    queryKey: ["backups", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("backups")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as BackupRow[];
    },
    enabled: !!empresaId,
  });

  async function gatherPayload(empresaId: string, dateStart?: string, dateEnd?: string): Promise<BackupPayload> {
    let eventsQuery = supabase.from("events").select("*").eq("empresa_id", empresaId);
    if (dateStart) eventsQuery = eventsQuery.gte("date", dateStart);
    if (dateEnd) eventsQuery = eventsQuery.lte("date", dateEnd);
    const { data: eventos } = await eventsQuery;

    const eventIds = (eventos || []).map((e: any) => e.id);

    let eventDays: any[] = [];
    let eventFiles: any[] = [];
    let financials: any[] = [];

    if (eventIds.length > 0) {
      const [daysRes, filesRes, finRes] = await Promise.all([
        supabase.from("event_days").select("*").in("event_id", eventIds),
        supabase.from("event_files").select("*").in("event_id", eventIds),
        supabase.from("financials").select("*").in("event_id", eventIds),
      ]);
      eventDays = daysRes.data || [];
      eventFiles = filesRes.data || [];
      financials = finRes.data || [];
    }

    return {
      empresa_id: empresaId,
      data_backup: new Date().toISOString(),
      eventos: eventos || [],
      event_days: eventDays,
      event_files: eventFiles,
      financials: financials,
    };
  }

  async function cleanupAutoBackups(empresaId: string) {
    const { data } = await supabase
      .from("backups")
      .select("id, created_at")
      .eq("empresa_id", empresaId)
      .eq("tipo", "auto")
      .order("created_at", { ascending: false });

    if (data && data.length > MAX_AUTO_BACKUPS) {
      const toDelete = data.slice(MAX_AUTO_BACKUPS).map((b: any) => b.id);
      await supabase.from("backups").delete().in("id", toDelete);
    }
  }

  const createBackupMutation = useMutation({
    mutationFn: async (opts: { tipo: string; dateStart?: string; dateEnd?: string }) => {
      if (!empresaId) throw new Error("Empresa não encontrada");
      const payload = await gatherPayload(empresaId, opts.dateStart, opts.dateEnd);
      const nome = `Backup ${format(new Date(), "dd-MM-yyyy HH:mm")}`;

      const { error } = await supabase.from("backups").insert({
        empresa_id: empresaId,
        nome,
        tipo: opts.tipo,
        periodo_inicio: opts.dateStart || null,
        periodo_fim: opts.dateEnd || null,
        payload,
      } as any);
      if (error) throw error;

      if (opts.tipo === "auto") {
        await cleanupAutoBackups(empresaId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
      toast.success("Backup criado com sucesso!");
    },
    onError: () => toast.error("Erro ao criar backup."),
  });

  const deleteBackupMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("backups").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
      toast.success("Backup excluído.");
    },
    onError: () => toast.error("Erro ao excluir backup."),
  });

  const restoreMutation = useMutation({
    mutationFn: async (payload: BackupPayload) => {
      if (!empresaId) throw new Error("Empresa não encontrada");

      // Delete current data in order (files → days → financials → events)
      const { data: currentEvents } = await supabase.from("events").select("id").eq("empresa_id", empresaId);
      const currentIds = (currentEvents || []).map((e: any) => e.id);

      if (currentIds.length > 0) {
        await supabase.from("event_files").delete().in("event_id", currentIds);
        await supabase.from("event_days").delete().in("event_id", currentIds);
        await supabase.from("financials").delete().in("event_id", currentIds);
      }
      await supabase.from("events").delete().eq("empresa_id", empresaId);

      // Insert backup data
      if (payload.eventos?.length) {
        const { error } = await supabase.from("events").insert(payload.eventos);
        if (error) throw error;
      }
      if (payload.event_days?.length) {
        const { error } = await supabase.from("event_days").insert(payload.event_days);
        if (error) throw error;
      }
      if (payload.event_files?.length) {
        const { error } = await supabase.from("event_files").insert(payload.event_files);
        if (error) throw error;
      }
      if (payload.financials?.length) {
        const { error } = await supabase.from("financials").insert(payload.financials);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Backup restaurado com sucesso!");
      setRestoreId(null);
    },
    onError: (err) => {
      toast.error("Erro ao restaurar backup: " + (err as Error).message);
    },
  });

  function handleExport(backup: BackupRow) {
    const json = JSON.stringify(backup.payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-empresa-${format(new Date(backup.created_at), "yyyy-MM-dd")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup exportado!");
  }

  async function handleImport() {
    if (!importFile) return;
    try {
      const text = await importFile.text();
      const payload = JSON.parse(text) as BackupPayload;

      if (!payload.eventos || !Array.isArray(payload.eventos)) {
        toast.error("Arquivo de backup inválido: estrutura incorreta.");
        return;
      }

      // Overwrite empresa_id to current one for safety
      payload.empresa_id = empresaId!;
      payload.eventos = payload.eventos.map((e: any) => ({ ...e, empresa_id: empresaId }));
      payload.event_days = (payload.event_days || []).map((d: any) => ({ ...d, empresa_id: empresaId }));
      payload.event_files = (payload.event_files || []).map((f: any) => ({ ...f, empresa_id: empresaId }));
      payload.financials = (payload.financials || []).map((f: any) => ({ ...f, empresa_id: empresaId }));

      setImportOpen(false);
      setRestoreId("import");
      // Store payload temporarily
      (window as any).__importPayload = payload;
    } catch {
      toast.error("Erro ao ler arquivo. Verifique se é um JSON válido.");
    }
  }

  function handleRestoreConfirm() {
    if (restoreId === "import") {
      const payload = (window as any).__importPayload as BackupPayload;
      delete (window as any).__importPayload;
      restoreMutation.mutate(payload);
    } else if (restoreId) {
      const backup = backups.find((b) => b.id === restoreId);
      if (backup) restoreMutation.mutate(backup.payload as BackupPayload);
    }
  }

  function handlePeriodBackup() {
    if (!periodStart || !periodEnd) {
      toast.error("Selecione as datas de início e fim.");
      return;
    }
    createBackupMutation.mutate({ tipo: "manual", dateStart: periodStart, dateEnd: periodEnd });
    setPeriodOpen(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Database className="h-7 w-7 text-primary" />
            Backups
          </h1>
          <p className="text-muted-foreground mt-1">Gerencie backups dos dados da sua empresa.</p>
        </div>
      </div>

      {/* Action Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Backup Manual
            </CardTitle>
            <CardDescription>Gere um backup completo agora.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={() => createBackupMutation.mutate({ tipo: "manual" })}
              disabled={createBackupMutation.isPending}
            >
              <Download className="h-4 w-4 mr-2" />
              {createBackupMutation.isPending ? "Gerando..." : "Gerar Backup Agora"}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Backup por Período
            </CardTitle>
            <CardDescription>Backup filtrado por datas.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => setPeriodOpen(true)}>
              <CalendarDays className="h-4 w-4 mr-2" />
              Selecionar Período
            </Button>
          </CardContent>
        </Card>

        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Importar Backup
            </CardTitle>
            <CardDescription>Restaure a partir de um arquivo.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Importar Backup
            </Button>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Backup List */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          Histórico de Backups
        </h2>

        {isLoading ? (
          <p className="text-muted-foreground">Carregando...</p>
        ) : backups.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum backup encontrado.</p>
              <p className="text-sm">Gere seu primeiro backup para proteger seus dados.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {backups.map((backup) => {
              const payload = backup.payload as BackupPayload;
              const eventCount = payload?.eventos?.length ?? 0;

              return (
                <Card key={backup.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="flex items-center justify-between py-4 px-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{backup.nome}</span>
                        <Badge variant={backup.tipo === "auto" ? "secondary" : "default"} className="text-xs">
                          {backup.tipo === "auto" ? "Automático" : "Manual"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{format(new Date(backup.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                        <span>{eventCount} evento{eventCount !== 1 ? "s" : ""}</span>
                        {backup.periodo_inicio && backup.periodo_fim && (
                          <span>
                            Período: {format(new Date(backup.periodo_inicio), "dd/MM/yy")} - {format(new Date(backup.periodo_fim), "dd/MM/yy")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Button size="sm" variant="outline" onClick={() => handleExport(backup)} title="Exportar">
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRestoreId(backup.id)} title="Restaurar">
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteBackupMutation.mutate(backup.id)}
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Period Dialog */}
      <Dialog open={periodOpen} onOpenChange={setPeriodOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backup por Período</DialogTitle>
            <DialogDescription>Selecione o intervalo de datas para o backup.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Data Inicial</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Data Final</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button onClick={handlePeriodBackup} disabled={createBackupMutation.isPending}>
              {createBackupMutation.isPending ? "Gerando..." : "Gerar Backup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar Backup</DialogTitle>
            <DialogDescription>Selecione um arquivo .json de backup.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              type="file"
              accept=".json"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button onClick={handleImport} disabled={!importFile}>
              Importar e Restaurar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation */}
      <AlertDialog open={!!restoreId} onOpenChange={(open) => !open && setRestoreId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar Backup</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-destructive">ATENÇÃO:</strong> isso irá substituir todos os dados atuais da empresa (eventos, financeiro, arquivos) pelos dados do backup. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestoreConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {restoreMutation.isPending ? "Restaurando..." : "Sim, Restaurar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
