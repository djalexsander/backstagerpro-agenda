import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, MessageCircle, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { listClients } from "@/lib/client-service";
import { getFinancialLedgerPermissions } from "@/lib/financial-ledger-permissions";
import {
  getRentalFinancialSummary,
  getRentalsFinancialSummary,
  listClientReceivableEntries,
  listClientsReceivable,
  listReceivables,
  registerRentalReceipt,
} from "@/lib/financial-ledger-service";
import type { ClientReceivableSummary, FinancialLedgerStatus, ReceivableEntry } from "@/lib/financial-ledger-types";
import { buildWhatsAppBillingMessage, normalizeWhatsAppPhone } from "@/lib/whatsapp-billing";
import { openWhatsApp } from "@/lib/whatsapp-launcher";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PAGE_SIZE = 10;

const STATUS_LABELS: Record<FinancialLedgerStatus, string> = {
  pendente: "Pendente",
  parcial: "Parcial",
  recebido: "Recebido",
  cancelado: "Cancelado",
  cancelado_pendente_regularizacao: "Cancelado · a regularizar",
  estornado: "Estornado",
};

const STATUS_BADGE: Record<FinancialLedgerStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pendente: "outline",
  parcial: "outline",
  recebido: "default",
  cancelado: "secondary",
  cancelado_pendente_regularizacao: "destructive",
  estornado: "secondary",
};

// "YYYY-MM-DD" parses as UTC midnight in JS; appending a bare time (no Z/
// offset) makes it parse as local midnight instead, avoiding an off-by-one
// -day shift for timezones behind UTC (e.g. Brazil) - matters both for the
// label shown and for the urgency classification below.
function formatDuePtBr(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString("pt-BR");
}

type DueUrgency = "vencido" | "hoje" | "proximo" | "normal";

// Kept deliberately to two colors (destructive + amber) per "não precisa
// exagerar na quantidade de cores" - "hoje" and "próximo" share the same
// amber treatment, only the word next to the date differs.
function classifyDueDate(dateIso: string, referenceDate = new Date()): DueUrgency {
  const due = new Date(`${dateIso}T00:00:00`);
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "vencido";
  if (diffDays === 0) return "hoje";
  if (diffDays <= 3) return "proximo";
  return "normal";
}

const DUE_URGENCY_CLASS: Record<DueUrgency, string | undefined> = {
  vencido: "font-medium text-destructive",
  hoje: "font-medium text-amber-600",
  proximo: "font-medium text-amber-600",
  normal: undefined,
};

const DUE_URGENCY_SUFFIX: Record<DueUrgency, string> = {
  vencido: " · vencido",
  hoje: " · vence hoje",
  proximo: " · próximo",
  normal: "",
};

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-10 text-center">
      <AlertCircle className="h-6 w-6 text-destructive" />
      <p className="text-sm text-destructive">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" />Tentar novamente
      </Button>
    </div>
  );
}

export function LocacoesReceivablesPanel({
  empresaId,
  companyReadOnly,
}: {
  empresaId: string | null;
  companyReadOnly: boolean;
}) {
  const { toast } = useToast();
  const { role, empresaNome } = useAuth();
  const queryClient = useQueryClient();
  const { hasModule, isLoading: loadingModules } = useCompanyModules(empresaId);
  const permissions = getFinancialLedgerPermissions({
    role,
    moduleEnabled: hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO),
    companyReadOnly,
    companySelected: Boolean(empresaId),
  });

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<FinancialLedgerStatus | "todos">("todos");
  const [search, setSearch] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [receiptTarget, setReceiptTarget] = useState<ReceivableEntry | null>(null);
  const [receiptInstallmentId, setReceiptInstallmentId] = useState<string | null>(null);
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptMethod, setReceiptMethod] = useState("pix");
  const [clientDetailTarget, setClientDetailTarget] = useState<ClientReceivableSummary | null>(null);
  const [whatsappTarget, setWhatsappTarget] = useState<ClientReceivableSummary | null>(null);
  const [whatsappMessage, setWhatsappMessage] = useState("");

  const invalidate = (rentalId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["receivables", empresaId] }),
      queryClient.invalidateQueries({ queryKey: ["clients-receivable", empresaId] }),
      queryClient.invalidateQueries({ queryKey: ["rentals-financial-summary", empresaId] }),
      ...(rentalId ? [queryClient.invalidateQueries({ queryKey: ["rental-financial-summary", empresaId, rentalId] })] : []),
    ]);

  const summaryQuery = useQuery({
    queryKey: ["rentals-financial-summary", empresaId],
    queryFn: () => getRentalsFinancialSummary(empresaId!),
    enabled: Boolean(empresaId && permissions.visualizar),
  });

  const receivablesQuery = useQuery({
    queryKey: ["receivables", empresaId, page, status, search, onlyReview],
    queryFn: () =>
      listReceivables(empresaId!, page, PAGE_SIZE, {
        status: status === "todos" ? undefined : status,
        search,
        onlyNeedsDueDateReview: onlyReview,
      }),
    enabled: Boolean(empresaId && permissions.visualizar),
  });

  const clientsQuery = useQuery({
    queryKey: ["clients-receivable", empresaId],
    queryFn: () => listClientsReceivable(empresaId!),
    enabled: Boolean(empresaId && permissions.visualizar),
  });

  // Phone numbers live on public.clientes, not on the financial ledger -
  // reused from the same listar_clientes RPC the client registry already
  // uses (Contas a Receber never needed contact info before). Includes
  // inactive clients on purpose: a client can still owe money after being
  // deactivated, and the WhatsApp action must still find their phone.
  const clientDirectoryQuery = useQuery({
    queryKey: ["client-directory", empresaId],
    queryFn: () => listClients(empresaId!, "", true),
    enabled: Boolean(empresaId && permissions.visualizar),
  });
  const phoneByClientId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const client of clientDirectoryQuery.data ?? []) {
      map.set(client.id, client.telefone);
    }
    return map;
  }, [clientDirectoryQuery.data]);

  // Only needed to let the user pick which open parcela to pay - à vista
  // titles never need this, so the query stays idle for them.
  const receiptFinancialQuery = useQuery({
    queryKey: ["rental-financial-summary", empresaId, receiptTarget?.origem_id],
    queryFn: () => getRentalFinancialSummary(empresaId!, receiptTarget!.origem_id),
    enabled: Boolean(empresaId && receiptTarget && receiptTarget.forma_cobranca === "parcelado"),
  });
  const openInstallments = useMemo(
    () => (receiptFinancialQuery.data?.parcelas ?? []).filter((installment) => ["pendente", "parcial"].includes(installment.status)),
    [receiptFinancialQuery.data],
  );
  const receiptTargetInstallment = useMemo(
    () => openInstallments.find((installment) => installment.id === receiptInstallmentId) ?? null,
    [openInstallments, receiptInstallmentId],
  );
  useEffect(() => {
    if (receiptTarget?.forma_cobranca === "parcelado" && !receiptInstallmentId && openInstallments.length > 0) {
      const first = openInstallments[0];
      setReceiptInstallmentId(first.id);
      setReceiptAmount(String(first.valor - first.valor_recebido));
    }
  }, [receiptTarget, receiptInstallmentId, openInstallments]);

  const clientEntriesQuery = useQuery({
    queryKey: ["client-receivable-entries", empresaId, clientDetailTarget?.cliente_id],
    queryFn: () =>
      listClientReceivableEntries(
        empresaId!,
        clientDetailTarget!.cliente_id,
        clientDetailTarget!.cliente_nome_fantasia || clientDetailTarget!.cliente_nome,
      ),
    enabled: Boolean(empresaId && clientDetailTarget),
  });

  // Same query key pattern as clientEntriesQuery above (parameterized by
  // the target client id) - when the same client's títulos were already
  // opened via "Títulos em aberto", this shares that cache entry instead
  // of refetching.
  const whatsappEntriesQuery = useQuery({
    queryKey: ["client-receivable-entries", empresaId, whatsappTarget?.cliente_id],
    queryFn: () =>
      listClientReceivableEntries(
        empresaId!,
        whatsappTarget!.cliente_id,
        whatsappTarget!.cliente_nome_fantasia || whatsappTarget!.cliente_nome,
      ),
    enabled: Boolean(empresaId && whatsappTarget),
  });
  useEffect(() => {
    if (!whatsappTarget || !whatsappEntriesQuery.data) return;
    setWhatsappMessage(
      buildWhatsAppBillingMessage({
        client: whatsappTarget,
        entries: whatsappEntriesQuery.data,
        companyName: empresaNome || "",
      }),
    );
  }, [whatsappTarget, whatsappEntriesQuery.data, empresaNome]);

  const openReceiptDialog = (item: ReceivableEntry) => {
    setReceiptTarget(item);
    setReceiptInstallmentId(null);
    setReceiptAmount(item.forma_cobranca === "avista" ? String(item.valor_original - item.valor_recebido) : "");
  };

  const closeReceiptDialog = () => {
    setReceiptTarget(null);
    setReceiptInstallmentId(null);
    setReceiptAmount("");
  };

  const openWhatsappDialog = (client: ClientReceivableSummary) => {
    setWhatsappTarget(client);
    setWhatsappMessage("");
  };

  const closeWhatsappDialog = () => {
    setWhatsappTarget(null);
    setWhatsappMessage("");
  };

  const handleSendWhatsapp = async () => {
    if (!whatsappTarget) return;
    const normalized = normalizeWhatsAppPhone(phoneByClientId.get(whatsappTarget.cliente_id) ?? null);
    if (!normalized) {
      toast({ title: "Telefone inválido", description: "Não foi possível reconhecer o telefone deste cliente.", variant: "destructive" });
      return;
    }
    try {
      await openWhatsApp(normalized, whatsappMessage);
      closeWhatsappDialog();
    } catch (error) {
      toast({
        title: "Não foi possível abrir o WhatsApp",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const receiptMutation = useMutation({
    mutationFn: () => {
      if (!receiptTarget) throw new Error("Selecione um título.");
      if (receiptTarget.forma_cobranca === "parcelado" && !receiptInstallmentId) {
        throw new Error("Selecione a parcela.");
      }
      const amount = Number(receiptAmount.replace(",", "."));
      if (!amount || amount <= 0) throw new Error("Informe um valor válido.");
      return registerRentalReceipt(empresaId!, {
        rentalId: receiptTarget.origem_id,
        amount,
        paymentMethod: receiptMethod,
        clientUuid: crypto.randomUUID(),
        installmentId: receiptTarget.forma_cobranca === "parcelado" ? receiptInstallmentId! : undefined,
      });
    },
    onSuccess: async () => {
      await invalidate(receiptTarget?.origem_id);
      closeReceiptDialog();
      toast({ title: "Recebimento registrado" });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível registrar o recebimento", description: error.message, variant: "destructive" }),
  });

  if (!empresaId || (!loadingModules && !permissions.visualizar)) {
    return null;
  }

  const items = receivablesQuery.data?.items ?? [];
  const total = receivablesQuery.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clients = clientsQuery.data ?? [];
  const summary = summaryQuery.data;
  const clientEntries = clientEntriesQuery.data ?? [];

  const receiptDescription = (() => {
    if (!receiptTarget) return "";
    if (receiptTarget.forma_cobranca === "avista") {
      return `Saldo pendente: ${money.format(receiptTarget.valor_original - receiptTarget.valor_recebido)}`;
    }
    if (receiptTargetInstallment) {
      return `Saldo pendente da parcela ${receiptTargetInstallment.numero}: ${money.format(receiptTargetInstallment.valor - receiptTargetInstallment.valor_recebido)}`;
    }
    return "Selecione a parcela para ver o saldo pendente.";
  })();

  return (
    <Card>
      <CardHeader><CardTitle>Locações</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {summaryQuery.isError ? (
          <ErrorState
            message={summaryQuery.error instanceof Error ? summaryQuery.error.message : "Não foi possível carregar o resumo financeiro."}
            onRetry={() => summaryQuery.refetch()}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Contratado</p><p className="text-xl font-bold">{summaryQuery.isLoading ? "—" : money.format(summary?.valorContratado ?? 0)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Recebido líquido</p><p className="text-xl font-bold text-emerald-600">{summaryQuery.isLoading ? "—" : money.format(summary?.valorRecebido ?? 0)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">A receber</p><p className="text-xl font-bold text-amber-600">{summaryQuery.isLoading ? "—" : money.format(summary?.valorAReceber ?? 0)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Vencido</p><p className="text-xl font-bold text-destructive">{summaryQuery.isLoading ? "—" : money.format(summary?.valorVencido ?? 0)}</p></CardContent></Card>
            <Card className={summary && summary.valorPendenteRegularizacao > 0 ? "border-destructive/40 bg-destructive/5" : undefined}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Pendente de regularização</p>
                <p className="text-xl font-bold text-destructive">{summaryQuery.isLoading ? "—" : money.format(summary?.valorPendenteRegularizacao ?? 0)}</p>
                <p className="text-[11px] text-muted-foreground">Recebido em locações canceladas, ainda não estornado</p>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs defaultValue="titulos">
          <TabsList>
            <TabsTrigger value="titulos">Contas a receber</TabsTrigger>
            <TabsTrigger value="clientes">Clientes a receber</TabsTrigger>
          </TabsList>

          <TabsContent value="titulos" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por cliente ou descrição" />
              </div>
              <Select value={status} onValueChange={(value) => { setStatus(value as FinancialLedgerStatus | "todos"); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={onlyReview} onCheckedChange={(checked) => { setOnlyReview(checked === true); setPage(1); }} />
              Somente títulos históricos sem vencimento definido (revisar condição de pagamento)
            </label>
            {receivablesQuery.isLoading ? (
              <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : receivablesQuery.isError ? (
              <ErrorState
                message={receivablesQuery.error instanceof Error ? receivablesQuery.error.message : "Não foi possível carregar os títulos."}
                onRetry={() => receivablesQuery.refetch()}
              />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Recebido</TableHead>
                      <TableHead className="text-right">A receber</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-40" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const canReceive = permissions.registrarRecebimento && ["pendente", "parcial"].includes(item.status);
                      return (
                        <TableRow
                          key={item.id}
                          className={canReceive ? "cursor-pointer hover:bg-muted/50" : undefined}
                          onClick={() => canReceive && openReceiptDialog(item)}
                        >
                          <TableCell>{item.cliente_nome_fantasia || item.cliente_nome || "—"}</TableCell>
                          <TableCell>{item.descricao}</TableCell>
                          <TableCell className="text-right">{money.format(item.valor_original)}</TableCell>
                          <TableCell className="text-right">
                            {money.format(item.valor_recebido)}
                            {item.valor_estornado > 0 && <div className="text-[11px] text-destructive">{money.format(item.valor_estornado)} estornado</div>}
                          </TableCell>
                          <TableCell className="text-right">{money.format(item.valor_original - item.valor_recebido)}</TableCell>
                          <TableCell>
                            {item.requer_revisao_vencimento ? (
                              <Badge variant="outline" className="border-amber-500 text-amber-600">Revisar vencimento</Badge>
                            ) : (
                              <Badge variant={item.vencido && item.status !== "cancelado" ? "destructive" : STATUS_BADGE[item.status]}>
                                {item.vencido && ["pendente", "parcial"].includes(item.status) ? "Vencido" : STATUS_LABELS[item.status]}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                            {canReceive && (
                              <Button size="sm" variant="outline" onClick={() => openReceiptDialog(item)}>
                                Receber
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!items.length && (
                      <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">Nenhum título encontrado.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
              <span className="text-sm">{page} de {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Próxima</Button>
            </div>
          </TabsContent>

          <TabsContent value="clientes">
            {clientsQuery.isLoading ? (
              <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : clientsQuery.isError ? (
              <ErrorState
                message={clientsQuery.error instanceof Error ? clientsQuery.error.message : "Não foi possível carregar os clientes a receber."}
                onRetry={() => clientsQuery.refetch()}
              />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Títulos</TableHead>
                      <TableHead className="text-right">Total devido</TableHead>
                      <TableHead className="text-right">Total vencido</TableHead>
                      <TableHead className="text-right">A regularizar</TableHead>
                      <TableHead>Próximo vencimento</TableHead>
                      <TableHead className="w-48" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients.map((client) => {
                      const phone = phoneByClientId.get(client.cliente_id) ?? null;
                      const hasPhone = Boolean(phone && phone.trim());
                      const urgency = client.proximo_vencimento ? classifyDueDate(client.proximo_vencimento) : null;
                      return (
                        <TableRow
                          key={client.cliente_id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setClientDetailTarget(client)}
                        >
                          <TableCell>{client.cliente_nome_fantasia || client.cliente_nome}</TableCell>
                          <TableCell className="text-right">{client.quantidade_titulos}</TableCell>
                          <TableCell className="text-right font-medium">{client.total_devido > 0 ? money.format(client.total_devido) : "—"}</TableCell>
                          <TableCell className="text-right text-destructive">{client.total_vencido > 0 ? money.format(client.total_vencido) : "—"}</TableCell>
                          <TableCell className="text-right text-destructive">{client.total_pendente_regularizacao > 0 ? money.format(client.total_pendente_regularizacao) : "—"}</TableCell>
                          <TableCell>
                            {client.proximo_vencimento && urgency ? (
                              <span className={DUE_URGENCY_CLASS[urgency]}>
                                {formatDuePtBr(client.proximo_vencimento)}{DUE_URGENCY_SUFFIX[urgency]}
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                            {permissions.registrarRecebimento && (
                              <Button
                                size="sm" variant="outline"
                                disabled={!hasPhone}
                                title={hasPhone ? undefined : "Cliente sem telefone cadastrado"}
                                onClick={() => openWhatsappDialog(client)}
                              >
                                <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                                {hasPhone ? "Cobrar no WhatsApp" : "Sem telefone"}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!clients.length && (
                      <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">Nenhum cliente com pendência.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <Dialog open={Boolean(receiptTarget)} onOpenChange={(open) => !open && closeReceiptDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
            <DialogDescription>{receiptDescription}</DialogDescription>
          </DialogHeader>
          {receiptTarget?.forma_cobranca === "parcelado" && (
            <div className="space-y-2">
              <Label>Parcela</Label>
              {receiptFinancialQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Carregando parcelas...
                </div>
              ) : openInstallments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma parcela em aberto.</p>
              ) : (
                <Select
                  value={receiptInstallmentId ?? undefined}
                  onValueChange={(value) => {
                    setReceiptInstallmentId(value);
                    const installment = openInstallments.find((candidate) => candidate.id === value);
                    if (installment) setReceiptAmount(String(installment.valor - installment.valor_recebido));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione a parcela" /></SelectTrigger>
                  <SelectContent>
                    {openInstallments.map((installment) => (
                      <SelectItem key={installment.id} value={installment.id}>
                        Parcela {installment.numero} · vence {new Date(installment.vencimento).toLocaleDateString("pt-BR")} · {money.format(installment.valor - installment.valor_recebido)} pendente
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Valor recebido *</Label>
              <Input type="number" min={0} step="0.01" value={receiptAmount} onChange={(event) => setReceiptAmount(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select value={receiptMethod} onValueChange={setReceiptMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="cartao">Cartão</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeReceiptDialog}>Cancelar</Button>
            <Button
              disabled={receiptMutation.isPending || (receiptTarget?.forma_cobranca === "parcelado" && !receiptInstallmentId)}
              onClick={() => receiptMutation.mutate()}
            >
              {receiptMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar recebimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(clientDetailTarget)} onOpenChange={(open) => !open && setClientDetailTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Títulos em aberto</DialogTitle>
            <DialogDescription>
              {clientDetailTarget && (clientDetailTarget.cliente_nome_fantasia || clientDetailTarget.cliente_nome)}
            </DialogDescription>
          </DialogHeader>
          {clientEntriesQuery.isLoading ? (
            <div className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : clientEntriesQuery.isError ? (
            <ErrorState
              message={clientEntriesQuery.error instanceof Error ? clientEntriesQuery.error.message : "Não foi possível carregar os títulos do cliente."}
              onRetry={() => clientEntriesQuery.refetch()}
            />
          ) : (
            <div className="space-y-2">
              {clientEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">{entry.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {money.format(entry.valor_original - entry.valor_recebido)} a receber
                      {entry.forma_cobranca === "parcelado" ? " · parcelado" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={entry.vencido ? "destructive" : STATUS_BADGE[entry.status]}>
                      {entry.vencido ? "Vencido" : STATUS_LABELS[entry.status]}
                    </Badge>
                    {permissions.registrarRecebimento && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setClientDetailTarget(null);
                          openReceiptDialog(entry);
                        }}
                      >
                        Receber
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {!clientEntries.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhum título em aberto.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(whatsappTarget)} onOpenChange={(open) => !open && closeWhatsappDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cobrar no WhatsApp</DialogTitle>
            <DialogDescription>
              {whatsappTarget && `Revise a mensagem antes de abrir o WhatsApp de ${whatsappTarget.cliente_nome_fantasia || whatsappTarget.cliente_nome}.`}
            </DialogDescription>
          </DialogHeader>
          {whatsappEntriesQuery.isLoading ? (
            <div className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : whatsappEntriesQuery.isError ? (
            <ErrorState
              message={whatsappEntriesQuery.error instanceof Error ? whatsappEntriesQuery.error.message : "Não foi possível montar a mensagem."}
              onRetry={() => whatsappEntriesQuery.refetch()}
            />
          ) : (
            <Textarea
              value={whatsappMessage}
              onChange={(event) => setWhatsappMessage(event.target.value)}
              rows={10}
              className="text-sm"
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeWhatsappDialog}>Cancelar</Button>
            <Button disabled={whatsappEntriesQuery.isLoading || !whatsappMessage.trim()} onClick={handleSendWhatsapp}>
              <MessageCircle className="mr-2 h-4 w-4" />
              Abrir WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
