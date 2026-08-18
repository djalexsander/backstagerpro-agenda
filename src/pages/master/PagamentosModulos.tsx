/**
 * Painel Master: Gerenciar pagamentos de módulos
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
import { CheckCircle, XCircle, Eye, CreditCard, ExternalLink } from "lucide-react";

export default function PagamentosModulos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("pending");
  const [actionItem, setActionItem] = useState<any>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(null);
  const [adminObs, setAdminObs] = useState("");
  const [viewComprovante, setViewComprovante] = useState<string | null>(null);

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["master-module-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_payments")
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
        const { error } = await supabase.rpc(
          "master_approve_module_payment",
          {
            _payment_id: actionItem.id,
            _observacao_admin: adminObs || null,
          },
        );
        if (error) throw error;

        await supabase.from("system_logs").insert({
          tipo: "modulo",
          acao: "pagamento_modulo_aprovado",
          descricao: `Pagamento de módulo "${actionItem.module_catalog?.nome}" aprovado para "${actionItem.empresas?.nome_empresa}"`,
          empresa_id: actionItem.empresa_id,
          empresa_nome: actionItem.empresas?.nome_empresa,
        } as any);
      } else {
        const { error } = await supabase.from("module_payments")
          .update({ status: "rejected", rejected_at: now, observacao_admin: adminObs || null } as any)
          .eq("id", actionItem.id);
        if (error) throw error;

        await supabase.from("system_logs").insert({
          tipo: "modulo",
          acao: "pagamento_modulo_rejeitado",
          descricao: `Pagamento de módulo "${actionItem.module_catalog?.nome}" rejeitado para "${actionItem.empresas?.nome_empresa}"`,
          empresa_id: actionItem.empresa_id,
          empresa_nome: actionItem.empresas?.nome_empresa,
        } as any);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-module-payments"] });
      queryClient.invalidateQueries({ queryKey: ["empresa-modules"] });
      toast({ title: actionType === "approve" ? "Pagamento aprovado e módulo ativado!" : "Pagamento rejeitado." });
      setActionItem(null);
      setActionType(null);
      setAdminObs("");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const filtered = payments.filter((p: any) => {
    if (tab === "pending") return p.status === "pending";
    if (tab === "approved") return p.status === "approved";
    if (tab === "rejected") return p.status === "rejected";
    return true;
  });

  const pendingCount = payments.filter((p: any) => p.status === "pending").length;

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "Pendente", variant: "secondary" },
      paid: { label: "Pago", variant: "outline" },
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
        <CreditCard className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Pagamentos de Módulos</h1>
        {pendingCount > 0 && <Badge variant="secondary">{pendingCount} pendente(s)</Badge>}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Pendentes</TabsTrigger>
          <TabsTrigger value="approved">Aprovados</TabsTrigger>
          <TabsTrigger value="rejected">Rejeitados</TabsTrigger>
          <TabsTrigger value="all">Todos</TabsTrigger>
        </TabsList>

        <TabsContent value={tab}>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Nenhum pagamento encontrado.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Módulo</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((pay: any) => (
                    <TableRow key={pay.id}>
                      <TableCell className="font-medium">{pay.empresas?.nome_empresa || "—"}</TableCell>
                      <TableCell>{pay.module_catalog?.nome || "—"}</TableCell>
                      <TableCell>R$ {Number(pay.amount).toFixed(2)}</TableCell>
                      <TableCell className="text-sm">{pay.payment_method || "—"}</TableCell>
                      <TableCell className="text-sm">{new Date(pay.created_at).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell>{statusBadge(pay.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          {pay.comprovante_url && (
                            <Button size="sm" variant="ghost" onClick={() => setViewComprovante(pay.comprovante_url)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          {(pay.status === "pending" || pay.status === "paid") && (
                            <>
                              <Button size="sm" variant="outline" className="text-green-600" onClick={() => { setActionItem(pay); setActionType("approve"); setAdminObs(""); }}>
                                <CheckCircle className="h-4 w-4 mr-1" /> Aprovar
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive" onClick={() => { setActionItem(pay); setActionType("reject"); setAdminObs(""); }}>
                                <XCircle className="h-4 w-4 mr-1" /> Rejeitar
                              </Button>
                            </>
                          )}
                        </div>
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
            <DialogTitle>{actionType === "approve" ? "Aprovar Pagamento" : "Rejeitar Pagamento"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm">
              <strong>Empresa:</strong> {actionItem?.empresas?.nome_empresa}<br />
              <strong>Módulo:</strong> {actionItem?.module_catalog?.nome}<br />
              <strong>Valor:</strong> R$ {Number(actionItem?.amount || 0).toFixed(2)}
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Observação administrativa (opcional)</label>
              <Textarea value={adminObs} onChange={(e) => setAdminObs(e.target.value)} placeholder="Observação interna..." />
            </div>
            {actionType === "approve" && (
              <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
                Ao aprovar o pagamento, o módulo será ativado automaticamente para a empresa.
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
              {actionType === "approve" ? "Aprovar e Ativar Módulo" : "Rejeitar"}
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
