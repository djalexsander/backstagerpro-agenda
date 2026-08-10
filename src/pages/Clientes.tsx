import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Pencil, Plus, Power, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getClientPermissions } from "@/lib/client-permissions";
import { listClients, saveClient, setClientActive, type SaveClientInput } from "@/lib/client-service";
import type { CustomerOption } from "@/lib/material-rental-types";
import { listMaterialRentals } from "@/lib/material-rental-service";
import { listClientsReceivable } from "@/lib/financial-ledger-service";
import { buildClientReportHtml } from "@/lib/client-report-print";
import { openPrintWindow } from "@/lib/printer-service";

const emptyForm: SaveClientInput = {
  personType: "pessoa_fisica",
  name: "",
  fantasyName: "",
  document: "",
  email: "",
  phone: "",
  notes: "",
};

export default function Clientes() {
  const { toast } = useToast();
  const { role, empresaId: companyId, empresaReadOnly: readOnly, isMasterAdmin, empresaNome } = useAuth();
  const queryClient = useQueryClient();

  const { hasModule, isLoading: loadingModules } = useCompanyModules(companyId);
  const moduleEnabled =
    hasModule(MODULE_KEYS.LOCACAO_MATERIAIS) &&
    hasModule(MODULE_KEYS.GESTAO_MATERIAIS) &&
    hasModule(MODULE_KEYS.CONTROLE_ESTOQUE) &&
    hasModule(MODULE_KEYS.CHECKIN_CHECKOUT);
  const permissions = getClientPermissions({
    role,
    moduleEnabled,
    companyReadOnly: readOnly,
    companySelected: Boolean(companyId),
  });

  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerOption | null>(null);
  const [form, setForm] = useState<SaveClientInput>(emptyForm);
  const [printingClientId, setPrintingClientId] = useState<string | null>(null);

  const printClientReport = async (client: CustomerOption) => {
    if (!companyId) return;
    setPrintingClientId(client.id);
    try {
      const [rentalsPage, receivableRows] = await Promise.all([
        listMaterialRentals({
          companyId,
          page: 1,
          pageSize: 100,
          filters: { search: "", status: "todos", customerId: client.id, dateFrom: "", dateTo: "", overdueOnly: false, responsible: "" },
        }).catch(() => ({ items: [], total: 0 })),
        listClientsReceivable(companyId).catch(() => []),
      ]);
      const receivable = receivableRows.find((row) => row.cliente_id === client.id) ?? null;
      openPrintWindow(buildClientReportHtml(empresaNome || "Backstage Pro", client, rentalsPage.items, receivable));
    } catch (error) {
      toast({ title: "Não foi possível gerar o relatório", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setPrintingClientId(null);
    }
  };

  const clientsQuery = useQuery({
    queryKey: ["clients", companyId, search, includeInactive],
    queryFn: () => listClients(companyId!, search, includeInactive),
    enabled: Boolean(companyId && permissions.visualizar),
  });

  const invalidateClients = () =>
    queryClient.invalidateQueries({ queryKey: ["clients", companyId] });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error("Informe o nome do cliente.");
      return saveClient(companyId!, { ...form, id: editing?.id });
    },
    onSuccess: async () => {
      await invalidateClients();
      // "Locações" reads clients through its own query key ("rental-customers");
      // keep both in sync so a client created here shows up there immediately too.
      await queryClient.invalidateQueries({ queryKey: ["rental-customers", companyId] });
      setFormOpen(false);
      setEditing(null);
      toast({ title: editing ? "Cliente atualizado" : "Cliente cadastrado" });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível salvar o cliente", description: error.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: (client: CustomerOption) => setClientActive(companyId!, client.id, !client.ativo),
    onSuccess: async () => {
      await invalidateClients();
      await queryClient.invalidateQueries({ queryKey: ["rental-customers", companyId] });
      toast({ title: "Status do cliente atualizado" });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível alterar o cliente", description: error.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  };
  const openEdit = (client: CustomerOption) => {
    setEditing(client);
    setForm({
      personType: client.tipo_pessoa,
      name: client.nome,
      fantasyName: client.nome_fantasia ?? "",
      document: client.cpf_cnpj ?? "",
      email: client.email ?? "",
      phone: client.telefone ?? "",
      notes: client.observacoes ?? "",
    });
    setFormOpen(true);
  };

  if (!companyId) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-muted-foreground">
            {isMasterAdmin
              ? "Sua conta master não está vinculada a uma empresa operacional."
              : "Nenhuma empresa vinculada à sua conta."}
          </p>
        </div>
      </div>
    );
  }
  if (!loadingModules && !permissions.visualizar) {
    return (
      <div className="space-y-4">
        <div><h1 className="text-2xl font-bold">Clientes</h1><p className="text-muted-foreground">O módulo ou uma de suas dependências não está disponível.</p></div>
        <Card className="border-amber-500/50"><CardContent className="p-4 text-sm">Clientes requer Locação de Materiais, Gestão de Materiais, Controle de Estoque e Check-in / Check-out ativos.</CardContent></Card>
      </div>
    );
  }

  const clients = clientsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div><h1 className="text-2xl font-bold">Clientes</h1><p className="text-muted-foreground">Cadastro único de clientes usado em locações e demais módulos.</p></div>
        {permissions.criar && <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Novo cliente</Button>}
      </div>
      {readOnly && <Card className="border-amber-500/50"><CardContent className="p-3 text-sm">Empresa em modo somente leitura. Consultas permanecem disponíveis; cadastro e edição estão bloqueados.</CardContent></Card>}
      <Card>
        <CardHeader><CardTitle>Lista de clientes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail" />
            </div>
            <Button variant="outline" onClick={() => setIncludeInactive((current) => !current)}>
              {includeInactive ? "Somente ativos" : "Incluir inativos"}
            </Button>
          </div>
          {clientsQuery.isLoading ? (
            <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>CPF/CNPJ</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell>
                        <div className="font-medium">{client.nome_fantasia || client.nome}</div>
                        {client.nome_fantasia && <div className="text-xs text-muted-foreground">{client.nome}</div>}
                      </TableCell>
                      <TableCell>{client.cpf_cnpj || "—"}</TableCell>
                      <TableCell>{client.telefone || "—"}</TableCell>
                      <TableCell>{client.email || "—"}</TableCell>
                      <TableCell><Badge variant={client.ativo ? "default" : "secondary"}>{client.ativo ? "Ativo" : "Inativo"}</Badge></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" title="Imprimir relatório" disabled={printingClientId === client.id} onClick={() => printClientReport(client)}>
                            {printingClientId === client.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                          </Button>
                          <Button size="icon" variant="ghost" title={permissions.editar ? "Editar" : "Visualizar"} onClick={() => openEdit(client)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {permissions.alternarStatus && (
                            <Button size="icon" variant="ghost" title={client.ativo ? "Inativar" : "Reativar"} onClick={() => toggleMutation.mutate(client)}>
                              <Power className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!clients.length && (
                    <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">Nenhum cliente encontrado.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {clientsQuery.error && (
            <p className="text-sm text-destructive">{clientsQuery.error instanceof Error ? clientsQuery.error.message : "Falha ao consultar clientes."}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? (permissions.editar ? "Editar cliente" : "Visualizar cliente") : "Novo cliente"}</DialogTitle>
            <DialogDescription>Cadastro canônico — usado em Locações e nos demais módulos que referenciam clientes.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select value={form.personType} onValueChange={(value) => setForm((current) => ({ ...current, personType: value as SaveClientInput["personType"] }))} disabled={!permissions.editar}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pessoa_fisica">Pessoa física</SelectItem>
                  <SelectItem value="pessoa_juridica">Pessoa jurídica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>CPF/CNPJ</Label>
              <Input value={form.document} onChange={(event) => setForm((current) => ({ ...current, document: event.target.value }))} disabled={!permissions.editar} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome / Razão social *</Label>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} disabled={!permissions.editar} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome fantasia</Label>
              <Input value={form.fantasyName} onChange={(event) => setForm((current) => ({ ...current, fantasyName: event.target.value }))} disabled={!permissions.editar} />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} disabled={!permissions.editar} />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} disabled={!permissions.editar} />
            </div>
            <div className="col-span-full space-y-2">
              <Label>Observações</Label>
              <Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={!permissions.editar} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Fechar</Button>
            {permissions.editar && (
              <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Salvar alterações" : "Cadastrar cliente"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
