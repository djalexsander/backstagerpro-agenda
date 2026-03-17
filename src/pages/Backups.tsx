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
  Database, Download, Upload, Trash2, RotateCcw, Plus, CalendarDays, Shield, Clock, AlertTriangle, FileCheck
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { createBackup, restoreBackup } from "@/lib/backup-service";
import {
  normalizeBackup,
  validateBackup,
  getBackupSummary,
  type BackupPayload,
} from "@/lib/backup-utils";

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
  const [importPreview, setImportPreview] = useState<{ payload: BackupPayload; summary: ReturnType<typeof getBackupSummary> } | null>(null);

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

  // Stats
  const totalBackups = backups.length;
  const autoCount = backups.filter(b => b.tipo === "auto").length;
  const manualCount = backups.filter(b => b.tipo === "manual").length;
  const lastBackup = backups[0];
  const lastBackupAgo = lastBackup
    ? formatDistanceToNow(new Date(lastBackup.created_at), { locale: ptBR, addSuffix: true })
    : null;

  const createBackupMutation = useMutation({
    mutationFn: async (opts: { tipo: "auto" | "manual"; dateStart?: string; dateEnd?: string }) => {
      if (!empresaId) throw new Error("Empresa não encontrada");
      await createBackup(empresaId, opts.tipo, opts.dateStart, opts.dateEnd);
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
    mutationFn: async (rawPayload: any) => {
      if (!empresaId) throw new Error("Empresa não encontrada");
      await restoreBackup(empresaId, rawPayload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Backup restaurado com sucesso!");
      setRestoreId(null);
      setImportPreview(null);
    },
    onError: (err) => {
      toast.error("Erro ao restaurar: " + (err as Error).message);
    },
  });

  function handleExport(backup: BackupRow) {
    const normalized = normalizeBackup(backup.payload, backup.empresa_id);
    const json = JSON.stringify(normalized, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backstage-backup-${format(new Date(backup.created_at), "yyyy-MM-dd")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup exportado!");
  }

  async function handleImport() {
    if (!importFile) return;
    try {
      const text = await importFile.text();
      const raw = JSON.parse(text);
      const normalized = normalizeBackup(raw, empresaId);
      const validation = validateBackup(normalized);

      if (!validation.valid) {
        toast.error("Arquivo inválido: " + validation.errors.join(", "));
        return;
      }

      const summary = getBackupSummary(normalized);
      setImportOpen(false);
      setImportPreview({ payload: normalized, summary });
      setRestoreId("import");
    } catch {
      toast.error("Erro ao ler arquivo. Verifique se é um JSON válido.");
    }
  }

  function handleRestoreConfirm() {
    if (restoreId === "import" && importPreview) {
      restoreMutation.mutate(importPreview.payload);
    } else if (restoreId) {
      const backup = backups.find((b) => b.id === restoreId);
      if (backup) restoreMutation.mutate(backup.payload);
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

  function getBackupEventCount(backup: BackupRow): number {
    const normalized = normalizeBackup(backup.payload, backup.empresa_id);
    return normalized.data.eventos?.length ?? 0;
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

      {/* Stats Row */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <Database className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{totalBackups}</p>
              <p className="text-xs text-muted-foreground">Total de backups</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{autoCount}</p>
              <p className="text-xs text-muted-foreground">Automáticos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <Plus className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{manualCount}</p>
              <p className="text-xs text-muted-foreground">Manuais</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium truncate">{lastBackupAgo ?? "Nenhum"}</p>
              <p className="text-xs text-muted-foreground">Último backup</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Last backup warning */}
      {lastBackup && (Date.now() - new Date(lastBackup.created_at).getTime() > 3 * 24 * 60 * 60 * 1000) && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>Seu último backup foi há mais de 3 dias. Considere gerar um novo backup.</span>
        </div>
      )}

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
              const eventCount = getBackupEventCount(backup);

              return (
                <Card key={backup.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="flex items-center justify-between py-4 px-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{backup.nome}</span>
                        <Badge variant={backup.tipo === "auto" ? "secondary" : "default"} className="text-xs">
                          {backup.tipo === "auto" ? "AUTO" : "MANUAL"}
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
      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) setImportFile(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar Backup</DialogTitle>
            <DialogDescription>Selecione um arquivo .json de backup exportado.</DialogDescription>
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
              <FileCheck className="h-4 w-4 mr-2" />
              Validar e Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation (with import preview) */}
      <AlertDialog open={!!restoreId} onOpenChange={(open) => { if (!open) { setRestoreId(null); setImportPreview(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar Backup</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  <strong className="text-destructive">ATENÇÃO:</strong> isso irá substituir todos os dados atuais da empresa pelos dados do backup. Esta ação não pode ser desfeita.
                </p>
                {importPreview && (
                  <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/50">
                    <p className="font-medium">Preview do backup:</p>
                    <p>• {importPreview.summary.eventos} evento(s)</p>
                    <p>• {importPreview.summary.eventDays} dia(s) de evento</p>
                    <p>• {importPreview.summary.eventFiles} arquivo(s)</p>
                    <p>• {importPreview.summary.financials} registro(s) financeiro(s)</p>
                  </div>
                )}
              </div>
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
