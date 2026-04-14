/**
 * Painel Master: Gerenciar solicitações de módulos das empresas
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Eye, FileText } from "lucide-react";

export default function SolicitacoesModulos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("pending");
  const [actionItem, setActionItem] = useState<any>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(null);
  const [adminObs, setAdminObs] = useState("");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["master-module-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_requests")
        .select("*, module_catalog(*), empresas(nome_empresa)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!actionItem || !actionType) return;
      const now = new Date().toISOString();

      if (actionType === "approve") {
        // Update request status
        const { error } = await supabase.from("module_requests")
          .update({ status: "approved", approved_at: now, observacao: adminObs || actionItem.observacao } as any)
          .eq("id", actionItem.id);
        if (error) throw error;

        // Create empresa_module entry as active
        const catalog = actionItem.module_catalog;
        const { error: emError } = await supabase.from("empresa_modules").insert({
          empresa_id: actionItem.empresa_id,
          module_id: actionItem.module_id,
          status: "active",
          activated_at: now,
          origem: "solicitacao_aprovada",
          granted_by_admin: true,
          valor_cobrado: catalog?.valor || 0,
        });
        if (emError) throw emError;

        // Log
        await supabase.from("system_logs").insert({
          tipo: "modulo",
          acao: "solicitacao_aprovada",
          descricao: `Solicitação de módulo "${catalog?.nome}" aprovada para empresa "${actionItem.empresas?.nome_empresa}"`,
          empresa_id: actionItem.empresa_id,
          empresa_nome: actionItem.empresas?.nome_empresa,
        } as any);
      } else {
        const { error } = await supabase.from("module_requests")
          .update({ status: "rejected", rejected_at: now, observacao: adminObs || actionItem.observacao } as any)
          .eq("id", actionItem.id);
        if (error) throw error;

        await supabase.from("system_logs").insert({
          tipo: "modulo",
          acao: "solicitacao_rejeitada",
          descricao: `Solicitação de módulo "${actionItem.module_catalog?.nome}" rejeitada para empresa "${actionItem.empresas?.nome_empresa}"`,
          empresa_id: actionItem.empresa_id,
          empresa_nome: actionItem.empresas?.nome_empresa,
        } as any);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-module-requests"] });
      toast({ title: actionType === "approve" ? "Solicitação aprovada e módulo ativado!" : "Solicitação rejeitada." });
      setActionItem(null);
      setActionType(null);
      setAdminObs("");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const filtered = requests.filter((r: any) => {
    if (tab === "pending") return r.status === "pending";
    if (tab === "approved") return r.status === "approved";
    if (tab === "rejected") return r.status === "rejected";
    return true;
  });

  const pendingCount = requests.filter((r: any) => r.status === "pending").length;

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "Pendente", variant: "secondary" },
      approved: { label: "Aprovado", variant: "default" },
      rejected: { label: "Rejeitado", variant: "destructive" },
      cancelled: { label: "Cancelado", variant: "outline" },
    };
    const info = map[status] || { label: status, variant: "outline" as const };
    return <Badge variant={info.variant}>{info.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Solicitações de Módulos</h1>
        {pendingCount > 0 && <Badge variant="secondary">{pendingCount} pendente(s)</Badge>}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Pendentes</TabsTrigger>
          <TabsTrigger value="approved">Aprovadas</TabsTrigger>
          <TabsTrigger value="rejected">Rejeitadas</TabsTrigger>
          <TabsTrigger value="all">Todas</TabsTrigger>
        </TabsList>

        <TabsContent value={tab}>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Nenhuma solicitação encontrada.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Módulo</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((req: any) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{req.empresas?.nome_empresa || "—"}</TableCell>
                      <TableCell>{req.module_catalog?.nome || "—"}</TableCell>
                      <TableCell className="text-sm">{new Date(req.requested_at).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell>{statusBadge(req.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{req.observacao || "—"}</TableCell>
                      <TableCell className="text-right">
                        {req.status === "pending" && (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="outline" className="text-green-600" onClick={() => { setActionItem(req); setActionType("approve"); setAdminObs(""); }}>
                              <CheckCircle className="h-4 w-4 mr-1" /> Aprovar
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive" onClick={() => { setActionItem(req); setActionType("reject"); setAdminObs(""); }}>
                              <XCircle className="h-4 w-4 mr-1" /> Rejeitar
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Action Dialog */}
      <Dialog open={!!actionItem && !!actionType} onOpenChange={(o) => { if (!o) { setActionItem(null); setActionType(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionType === "approve" ? "Aprovar Solicitação" : "Rejeitar Solicitação"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm">
              <strong>Empresa:</strong> {actionItem?.empresas?.nome_empresa}<br />
              <strong>Módulo:</strong> {actionItem?.module_catalog?.nome}<br />
              <strong>Valor:</strong> R$ {Number(actionItem?.module_catalog?.valor || 0).toFixed(2)}/{actionItem?.module_catalog?.periodicidade}
            </p>
            {actionItem?.observacao && (
              <p className="text-sm text-muted-foreground">Observação do cliente: {actionItem.observacao}</p>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Observação administrativa (opcional)</label>
              <Textarea value={adminObs} onChange={(e) => setAdminObs(e.target.value)} placeholder="Observação interna..." />
            </div>
            {actionType === "approve" && (
              <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
                Ao aprovar, o módulo será ativado automaticamente para a empresa.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionItem(null); setActionType(null); }}>Cancelar</Button>
            <Button
              variant={actionType === "approve" ? "default" : "destructive"}
              onClick={() => actionMutation.mutate()}
              disabled={actionMutation.isPending}
            >
              {actionType === "approve" ? "Aprovar e Ativar" : "Rejeitar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
