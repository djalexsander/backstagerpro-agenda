import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { CreditCard, QrCode, Copy, ArrowUpCircle, History, CheckCircle, Package, Users, Calendar, HardDrive, Upload, FileCheck, Download } from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { generatePixPayload } from "@/lib/pix";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function PlanoAssinatura() {
  const { empresaId } = useAuth();
  const queryClient = useQueryClient();
  const [showPix, setShowPix] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pixPayload, setPixPayload] = useState("");
  const [selectedPlanoId, setSelectedPlanoId] = useState<string | null>(null);

  // Fetch empresa with plano details
  const { data: empresa } = useQuery({
    queryKey: ["empresa-plano", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("*")
        .eq("id", empresaId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Fetch current plan details (by plano_id or by plano name fallback)
  const { data: planoAtual } = useQuery({
    queryKey: ["plano-atual", empresa?.plano_id, empresa?.plano],
    queryFn: async () => {
      if (empresa?.plano_id) {
        const { data, error } = await supabase
          .from("planos")
          .select("*")
          .eq("id", empresa.plano_id)
          .single();
        if (!error && data) return data;
      }
      // Fallback: match by plan name
      if (empresa?.plano) {
        const { data, error } = await supabase
          .from("planos")
          .select("*")
          .ilike("nome", empresa.plano)
          .single();
        if (!error && data) return data;
      }
      return null;
    },
    enabled: !!empresa,
  });

  // Fetch all active plans
  const { data: planos } = useQuery({
    queryKey: ["planos-ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos")
        .select("*")
        .eq("ativo", true)
        .order("valor", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fetch PIX settings
  const { data: pixSettings } = useQuery({
    queryKey: ["pix-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value")
        .in("key", ["pix_chave", "pix_nome_recebedor", "pix_cidade", "pix_banco"]);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      data.forEach((r: any) => { map[r.key] = r.value; });
      return map;
    },
  });

  // Fetch payment history
  const { data: pagamentos } = useQuery({
    queryKey: ["pagamentos", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pagamentos")
        .select("*")
        .eq("empresa_id", empresaId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Upgrade plan mutation
  const upgradeMutation = useMutation({
    mutationFn: async (planoId: string) => {
      const selectedPlano = planos?.find((p) => p.id === planoId);
      const { error } = await supabase
        .from("empresas")
        .update({ plano_id: planoId })
        .eq("id", empresaId!);
      if (error) throw error;

      // Notify master admin
      await supabase.from("notificacoes_master").insert({
        empresa_id: empresaId!,
        tipo: "upgrade_plano",
        mensagem: `${empresa?.nome_empresa} solicitou upgrade para o plano ${selectedPlano?.nome || ""}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresa-plano"] });
      queryClient.invalidateQueries({ queryKey: ["plano-atual"] });
      setShowUpgrade(false);
      setShowConfirm(false);
      setSelectedPlanoId(null);
      toast.success("Plano atualizado com sucesso!");
    },
    onError: () => toast.error("Erro ao atualizar plano."),
  });

  // Register payment mutation
  const paymentMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pagamentos").insert({
        empresa_id: empresaId!,
        plano_id: empresa?.plano_id,
        valor: planoAtual?.valor || 0,
        status: "pendente",
        metodo: "pix",
        descricao: `Assinatura Backstage Pro - ${empresa?.nome_empresa}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pagamentos"] });
    },
  });

  const handlePagar = () => {
    if (!pixSettings?.pix_chave) {
      toast.error("Chave PIX não configurada. Contate o administrador.");
      return;
    }
    if (!planoAtual) {
      toast.error("Nenhum plano associado.");
      return;
    }

    const payload = generatePixPayload({
      chave: pixSettings.pix_chave,
      nomeRecebedor: pixSettings.pix_nome_recebedor || "Backstage Pro",
      cidade: pixSettings.pix_cidade || "Maringa",
      valor: Number(planoAtual.valor),
      descricao: `Assinatura - ${empresa?.nome_empresa?.substring(0, 15)}`,
    });

    setPixPayload(payload);
    setShowPix(true);
    paymentMutation.mutate();
  };

  const copyPix = () => {
    navigator.clipboard.writeText(pixPayload);
    toast.success("Código PIX copiado!");
  };

  const statusColor = (s: string) => {
    if (s === "pago") return "default";
    if (s === "pendente") return "secondary";
    return "destructive";
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Plano & Assinatura</h1>

      {/* Current Plan Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="h-5 w-5 text-primary" />
            Plano Atual
          </CardTitle>
        </CardHeader>
        <CardContent>
          {planoAtual ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Plano</p>
                  <p className="font-semibold">{planoAtual.nome}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Valor Mensal</p>
                  <p className="font-semibold">R${Number(planoAtual.valor).toFixed(2)}/mês</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Eventos Permitidos</p>
                  <p className="font-semibold">{planoAtual.max_eventos ?? "Ilimitado"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Usuários Permitidos</p>
                  <p className="font-semibold">{planoAtual.max_usuarios ?? "Ilimitado"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Armazenamento</p>
                  <p className="font-semibold">{(planoAtual as any).storage_limit ?? 5}GB</p>
                </div>
              </div>
              {empresa?.vencimento && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Próximo Vencimento</p>
                    <p className="font-semibold">{format(new Date(empresa.vencimento), "dd/MM/yyyy")}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Nenhum plano associado. Selecione um plano abaixo.</p>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={handlePagar} disabled={!planoAtual}>
          <QrCode className="h-4 w-4 mr-2" />
          Pagar Mensalidade
        </Button>
        <Button variant="outline" onClick={() => setShowUpgrade(true)}>
          <ArrowUpCircle className="h-4 w-4 mr-2" />
          Fazer Upgrade de Plano
        </Button>
        <Button variant="outline" onClick={() => setShowHistory(true)}>
          <History className="h-4 w-4 mr-2" />
          Histórico de Pagamentos
        </Button>
      </div>

      {/* PIX Payment Dialog */}
      <Dialog open={showPix} onOpenChange={setShowPix}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Pagamento via PIX
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="bg-white p-4 rounded-lg">
              <QRCodeSVG value={pixPayload} size={220} />
            </div>
            <Separator />
            <div className="w-full space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Código PIX Copia e Cola:</p>
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-muted p-3 rounded-md break-all max-h-20 overflow-auto">
                  {pixPayload}
                </code>
                <Button variant="outline" size="icon" onClick={copyPix}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Escaneie o QR Code ou copie o código acima para realizar o pagamento.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upgrade Plan Dialog */}
      <Dialog open={showUpgrade} onOpenChange={setShowUpgrade}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Selecionar Plano</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 py-4">
            {planos?.map((plano) => (
              <Card
                key={plano.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedPlanoId === plano.id ? "ring-2 ring-primary" : ""
                } ${empresa?.plano_id === plano.id ? "opacity-60" : ""}`}
                onClick={() => setSelectedPlanoId(plano.id)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{plano.nome}</CardTitle>
                  <CardDescription>R${Number(plano.valor).toFixed(2)}/mês</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {plano.max_eventos ?? "∞"} eventos</p>
                  <p className="flex items-center gap-1"><Users className="h-3 w-3" /> {plano.max_usuarios ?? "∞"} usuários</p>
                  <p className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {(plano as any).storage_limit ?? 5}GB</p>
                  {empresa?.plano_id === plano.id && (
                    <Badge variant="secondary" className="mt-2">Plano Atual</Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <DialogFooter>
            <Button
              disabled={!selectedPlanoId || selectedPlanoId === empresa?.plano_id}
              onClick={() => setShowConfirm(true)}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Confirmar Plano
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upgrade Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Upgrade de Plano?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja alterar seu plano para <strong>{planos?.find(p => p.id === selectedPlanoId)?.nome}</strong>? 
              O administrador será notificado sobre esta alteração.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              disabled={upgradeMutation.isPending}
              onClick={() => selectedPlanoId && upgradeMutation.mutate(selectedPlanoId)}
            >
              {upgradeMutation.isPending ? "Atualizando..." : "Sim, confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Payment History Dialog */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Histórico de Pagamentos</DialogTitle>
          </DialogHeader>
          {pagamentos && pagamentos.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Comprovante</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagamentos.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{format(new Date(p.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</TableCell>
                    <TableCell>R${Number(p.valor).toFixed(2)}</TableCell>
                    <TableCell className="uppercase">{p.metodo}</TableCell>
                    <TableCell>
                      <Badge variant={statusColor(p.status) as any}>{p.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {p.comprovante_path ? (
                        <Badge variant="outline" className="text-accent border-accent gap-1">
                          <FileCheck className="h-3 w-3" /> Enviado
                        </Badge>
                      ) : p.status === "pendente" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept = "image/*,.pdf";
                            input.onchange = async (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (!file) return;
                              const path = `${empresaId}/${p.id}-${file.name}`;
                              const { error: uploadError } = await supabase.storage
                                .from("comprovantes")
                                .upload(path, file);
                              if (uploadError) {
                                toast.error("Erro ao enviar comprovante");
                                return;
                              }
                              await supabase
                                .from("pagamentos")
                                .update({ comprovante_path: path } as any)
                                .eq("id", p.id);
                              
                              // Notify master admin
                              await supabase.from("notificacoes_master").insert({
                                empresa_id: empresaId!,
                                tipo: "comprovante_pagamento",
                                mensagem: `${empresa?.nome_empresa} enviou comprovante de pagamento - R$${Number(p.valor).toFixed(2)}`,
                                dados: { comprovante_path: path },
                              } as any);

                              queryClient.invalidateQueries({ queryKey: ["pagamentos"] });
                              toast.success("Comprovante enviado com sucesso!");
                            };
                            input.click();
                          }}
                        >
                          <Upload className="h-3 w-3 mr-1" /> Enviar
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8">Nenhum pagamento registrado.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
