/**
 * Painel Master: Gerenciar solicitações em lote de módulos
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
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Eye, Layers, ExternalLink } from "lucide-react";

export default function SolicitacoesLoteModulos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("pending");
  const [actionItem, setActionItem] = useState<any>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(null);
  const [adminObs, setAdminObs] = useState("");
  const [viewComprovante, setViewComprovante] = useState<string | null>(null);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["master-batch-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_batch_requests")
        .select("*, empresas(nome_empresa, vencimento), module_batch_request_items(*, module_catalog(*))")
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
        // Update batch status
        const { error } = await supabase.from("module_batch_requests")
          .update({ status: "approved", approved_at: now, observacao_admin: adminObs || null } as any)
          .eq("id", actionItem.id);
        if (error) throw error;

        // Activate ALL modules in this batch
        const empresaVencimento = actionItem.empresas?.vencimento || null;
        const items = actionItem.module_batch_request_items || [];

        for (const item of items) {
          // Check if module already exists
          const { data: existing } = await supabase.from("empresa_modules")
            .select("id, status")
            .eq("empresa_id", actionItem.empresa_id)
            .eq("module_id", item.module_id)
            .maybeSingle();

          if (existing) {
            if (existing.status !== "active") {
              await supabase.from("empresa_modules")
                .update({ status: "active", activated_at: now, expires_at: empresaVencimento } as any)
                .eq("id", existing.id);
            }
          } else {
            await supabase.from("empresa_modules").insert({
              empresa_id: actionItem.empresa_id,
              module_id: item.module_id,
              status: "active",
              activated_at: now,
              expires_at: empresaVencimento,
              origem: "solicitacao_lote_aprovada",
              granted_by_admin: true,
              valor_cobrado: item.valor || 0,
            });
          }
        }

        // Log
        const moduleNames = items.map((i: any) => i.module_catalog?.nome || "?").join(", ");
        await supabase.from("system_logs").insert({
          tipo: "modulo",
          acao: "lote_modulos_aprovado",
          descricao: `Lote de ${items.length} módulo(s) aprovado para "${actionItem.empresas?.nome_empresa}": ${moduleNames}`,
          empresa_id: actionItem.empresa_id,
          empresa_nome: actionItem.empresas?.nome_empresa,
        } as any);
      } else {
        const { error } = await supabase.from("module_batch_requests")
          .update({ status: "rejected", rejected_at: now, observacao_admin: adminObs || null } as any)
          .eq("id", actionItem.id);
        if (error) throw error;

        await supabase.from("system_logs").insert({
          tipo: "modulo",
          acao: "lote_modulos_rejeitado",
          descricao: `Lote de módulos rejeitado para "${actionItem.empresas?.nome_empresa}"`,
          empresa_id: actionItem.empresa_id,
          empresa_nome: actionItem.empresas?.nome_empresa,
        } as any);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-batch-requests"] });
      queryClient.invalidateQueries({ queryKey: ["empresa-modules"] });
      toast({ title: actionType === "approve" ? "Lote aprovado — todos os módulos ativados!" : "Lote rejeitado." });
      setActionItem(null);
      setActionType(null);
      setAdminObs("");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const filtered = batches.filter((b: any) => {
    if (tab === "pending") return b.status === "pending" || b.status === "paid";
    if (tab === "approved") return b.status === "approved";
    if (tab === "rejected") return b.status === "rejected";
    return true;
  });

  const pendingCount = batches.filter((b: any) => b.status === "pending" || b.status === "paid").length;

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "Pendente", variant: "secondary" },
      paid: { label: "Pago - Aguardando", variant: "secondary" },
      approved: { label: "Aprovado", variant: "default" },
      rejected: { label: "Rejeitado", variant: "destructive" },
    };
    const info = map[status] || { label: status, variant: "outline" as const };
    return <Badge variant={info.variant}>{info.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Layers className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Solicitações em Lote</h1>
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
            <div className="space-y-4">
              {filtered.map((batch: any) => {
                const items = batch.module_batch_request_items || [];
                return (
                  <div key={batch.id} className="rounded-md border p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="font-semibold">{batch.empresas?.nome_empresa || "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(batch.created_at).toLocaleDateString("pt-BR")} • {items.length} módulo(s)
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-primary">R$ {Number(batch.valor_total).toFixed(2)}</span>
                        {statusBadge(batch.status)}
                      </div>
                    </div>

                    {/* Module list */}
                    <div className="flex flex-wrap gap-1">
                      {items.map((item: any) => (
                        <Badge key={item.id} variant="outline" className="text-xs">
                          {item.module_catalog?.nome || "?"} — R$ {Number(item.valor).toFixed(2)}
                        </Badge>
                      ))}
                    </div>

                    {batch.observacao && (
                      <p className="text-xs text-muted-foreground">Obs cliente: {batch.observacao}</p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 justify-end flex-wrap">
                      {batch.comprovante_url && (
                        <Button size="sm" variant="ghost" onClick={() => setViewComprovante(batch.comprovante_url)}>
                          <Eye className="h-4 w-4 mr-1" /> Comprovante
                        </Button>
                      )}
                      {(batch.status === "pending" || batch.status === "paid") && (
                        <>
                          <Button size="sm" variant="outline" className="text-green-600" onClick={() => {
                            setActionItem(batch); setActionType("approve"); setAdminObs("");
                          }}>
                            <CheckCircle className="h-4 w-4 mr-1" /> Aprovar Lote
                          </Button>
                          <Button size="sm" variant="outline" className="text-destructive" onClick={() => {
                            setActionItem(batch); setActionType("reject"); setAdminObs("");
                          }}>
                            <XCircle className="h-4 w-4 mr-1" /> Rejeitar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Action Dialog */}
      <Dialog open={!!actionItem && !!actionType} onOpenChange={(o) => { if (!o) { setActionItem(null); setActionType(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve" ? "Aprovar Lote de Módulos" : "Rejeitar Lote de Módulos"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm">
              <strong>Empresa:</strong> {actionItem?.empresas?.nome_empresa}
            </p>
            <div className="space-y-1">
              {(actionItem?.module_batch_request_items || []).map((item: any) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>{item.module_catalog?.nome}</span>
                  <span>R$ {Number(item.valor).toFixed(2)}</span>
                </div>
              ))}
              <Separator />
              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span>R$ {Number(actionItem?.valor_total || 0).toFixed(2)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Observação administrativa (opcional)</label>
              <Textarea value={adminObs} onChange={(e) => setAdminObs(e.target.value)} placeholder="Observação interna..." />
            </div>

            {actionType === "approve" && (
              <div className="text-xs text-muted-foreground bg-muted p-2 rounded space-y-1">
                <p>• Todos os módulos serão ativados automaticamente</p>
                <p>• Os módulos herdarão a data de vencimento do plano base da empresa</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionItem(null); setActionType(null); }}>Cancelar</Button>
            <Button
              variant={actionType === "approve" ? "default" : "destructive"}
              onClick={() => actionMutation.mutate()}
              disabled={actionMutation.isPending}
            >
              {actionType === "approve" ? "Aprovar e Ativar Todos" : "Rejeitar Lote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comprovante Dialog */}
      <Dialog open={!!viewComprovante} onOpenChange={(o) => !o && setViewComprovante(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Comprovante</DialogTitle></DialogHeader>
          {viewComprovante && (
            <div className="space-y-3">
              <img src={viewComprovante} alt="Comprovante" className="w-full rounded-md border" />
              <Button variant="outline" size="sm" asChild>
                <a href={viewComprovante} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" /> Abrir em nova aba
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
