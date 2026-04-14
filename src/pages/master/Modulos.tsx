import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Package, Zap, HardDrive } from "lucide-react";

interface ModuleCatalog {
  id: string;
  nome: string;
  descricao: string | null;
  valor: number;
  periodicidade: string;
  ativo: boolean;
  ordem: number;
  tipo_modulo: string;
  feature_key: string;
  metadata: any;
  is_capacity_module: boolean;
  capacidade_extra_usuarios: number;
  capacidade_extra_eventos: number;
  capacidade_extra_storage: number;
}

const EMPTY_FORM = {
  nome: "",
  descricao: "",
  valor: "",
  periodicidade: "mensal",
  ativo: true,
  ordem: "0",
  tipo_modulo: "addon",
  feature_key: "",
  is_capacity_module: false,
  capacidade_extra_usuarios: "0",
  capacidade_extra_eventos: "0",
  capacidade_extra_storage: "0",
};

const PERIODICIDADE_LABELS: Record<string, string> = {
  mensal: "Mensal",
  anual: "Anual",
  vitalicio: "Vitalício",
  unico: "Único",
};

export default function Modulos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<ModuleCatalog | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: modulos = [] } = useQuery({
    queryKey: ["master-modulos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_catalog")
        .select("*")
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data as ModuleCatalog[];
    },
  });

  const filtered = modulos.filter((m) => {
    if (statusFilter === "active") return m.ativo;
    if (statusFilter === "inactive") return !m.ativo;
    return true;
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Nome é obrigatório");
      if (!form.feature_key.trim()) throw new Error("Feature Key é obrigatória");
      if (!form.valor || isNaN(parseFloat(form.valor))) throw new Error("Valor inválido");

      const payload = {
        nome: form.nome.trim(),
        descricao: form.descricao.trim() || null,
        valor: parseFloat(form.valor),
        periodicidade: form.periodicidade,
        ativo: form.ativo,
        ordem: parseInt(form.ordem) || 0,
        tipo_modulo: form.tipo_modulo,
        feature_key: form.feature_key.trim().toLowerCase().replace(/\s+/g, "_"),
        is_capacity_module: form.is_capacity_module,
        capacidade_extra_usuarios: form.is_capacity_module ? parseInt(form.capacidade_extra_usuarios) || 0 : 0,
        capacidade_extra_eventos: form.is_capacity_module ? parseInt(form.capacidade_extra_eventos) || 0 : 0,
        capacidade_extra_storage: form.is_capacity_module ? parseInt(form.capacidade_extra_storage) || 0 : 0,
      };

      if (editItem) {
        const { error } = await supabase.from("module_catalog").update(payload as any).eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("module_catalog").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-modulos"] });
      toast({ title: editItem ? "Módulo atualizado!" : "Módulo criado!" });
      setDialogOpen(false);
      setEditItem(null);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("module_catalog").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-modulos"] });
      toast({ title: "Módulo excluído!" });
      setDeleteId(null);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const openAdd = () => {
    setEditItem(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (m: ModuleCatalog) => {
    setEditItem(m);
    setForm({
      nome: m.nome,
      descricao: m.descricao || "",
      valor: String(m.valor),
      periodicidade: m.periodicidade,
      ativo: m.ativo,
      ordem: String(m.ordem),
      tipo_modulo: m.tipo_modulo,
      feature_key: m.feature_key,
      is_capacity_module: m.is_capacity_module,
      capacidade_extra_usuarios: String(m.capacidade_extra_usuarios),
      capacidade_extra_eventos: String(m.capacidade_extra_eventos),
      capacidade_extra_storage: String(m.capacidade_extra_storage),
    });
    setDialogOpen(true);
  };

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Catálogo de Módulos</h1>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" /> Novo Módulo
        </Button>
      </div>

      {/* Filtros */}
      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
        <TabsList>
          <TabsTrigger value="all">Todos ({modulos.length})</TabsTrigger>
          <TabsTrigger value="active">Ativos ({modulos.filter((m) => m.ativo).length})</TabsTrigger>
          <TabsTrigger value="inactive">Inativos ({modulos.filter((m) => !m.ativo).length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Tabela */}
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Feature Key</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Capacidade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Nenhum módulo encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-muted-foreground text-xs">{m.ordem}</TableCell>
                  <TableCell className="font-medium">{m.nome}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{m.feature_key}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="gap-1">
                      {m.is_capacity_module ? (
                        <><HardDrive className="h-3 w-3" /> Capacidade</>
                      ) : (
                        <><Zap className="h-3 w-3" /> Funcionalidade</>
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-semibold">
                    {formatCurrency(m.valor)}
                    <span className="text-xs text-muted-foreground font-normal">
                      {m.periodicidade === "vitalicio" || m.periodicidade === "unico"
                        ? ""
                        : m.periodicidade === "anual"
                        ? "/ano"
                        : "/mês"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {m.is_capacity_module ? (
                      <div className="text-xs space-y-0.5">
                        {m.capacidade_extra_usuarios > 0 && <p>+{m.capacidade_extra_usuarios} usuários</p>}
                        {m.capacidade_extra_eventos > 0 && <p>+{m.capacidade_extra_eventos} eventos</p>}
                        {m.capacidade_extra_storage > 0 && <p>+{m.capacidade_extra_storage}GB storage</p>}
                        {m.capacidade_extra_usuarios === 0 && m.capacidade_extra_eventos === 0 && m.capacidade_extra_storage === 0 && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={m.ativo ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}>
                      {m.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteId(m.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir módulo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Módulos já contratados por empresas podem ser afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editItem ? "Editar Módulo" : "Novo Módulo"}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
            {/* Nome */}
            <div className="space-y-1.5">
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
                placeholder="Ex: Relatórios Avançados"
                maxLength={100}
              />
            </div>

            {/* Feature Key */}
            <div className="space-y-1.5">
              <Label>Feature Key <span className="text-destructive">*</span></Label>
              <Input
                value={form.feature_key}
                onChange={(e) => setForm((p) => ({ ...p, feature_key: e.target.value }))}
                placeholder="Ex: relatorios_avancados"
                maxLength={50}
                disabled={!!editItem}
              />
              <p className="text-xs text-muted-foreground">Identificador único do módulo (não pode ser alterado depois de criado)</p>
            </div>

            {/* Tipo e Periodicidade */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={form.tipo_modulo} onValueChange={(v) => setForm((p) => ({ ...p, tipo_modulo: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="addon">Addon</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                    <SelectItem value="capacidade">Capacidade</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Periodicidade</Label>
                <Select value={form.periodicidade} onValueChange={(v) => setForm((p) => ({ ...p, periodicidade: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mensal">Mensal</SelectItem>
                    <SelectItem value="anual">Anual</SelectItem>
                    <SelectItem value="vitalicio">Vitalício</SelectItem>
                    <SelectItem value="unico">Único</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Valor e Ordem */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Valor (R$) <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.valor}
                  onChange={(e) => setForm((p) => ({ ...p, valor: e.target.value }))}
                  placeholder="49.90"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ordem</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.ordem}
                  onChange={(e) => setForm((p) => ({ ...p, ordem: e.target.value }))}
                />
              </div>
            </div>

            {/* Descrição */}
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea
                value={form.descricao}
                onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))}
                rows={2}
                placeholder="Descrição do módulo para exibição"
                maxLength={500}
              />
            </div>

            {/* Módulo de capacidade */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Módulo de capacidade</p>
                <p className="text-xs text-muted-foreground">Aumenta limites de usuários, eventos ou storage</p>
              </div>
              <Switch
                checked={form.is_capacity_module}
                onCheckedChange={(v) => setForm((p) => ({ ...p, is_capacity_module: v }))}
              />
            </div>

            {form.is_capacity_module && (
              <div className="grid grid-cols-3 gap-3 pl-2 border-l-2 border-primary/20">
                <div className="space-y-1.5">
                  <Label className="text-xs">+ Usuários</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.capacidade_extra_usuarios}
                    onChange={(e) => setForm((p) => ({ ...p, capacidade_extra_usuarios: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">+ Eventos</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.capacidade_extra_eventos}
                    onChange={(e) => setForm((p) => ({ ...p, capacidade_extra_eventos: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">+ Storage (GB)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.capacidade_extra_storage}
                    onChange={(e) => setForm((p) => ({ ...p, capacidade_extra_storage: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {/* Ativo */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Módulo ativo</p>
                <p className="text-xs text-muted-foreground">Disponível para contratação pelas empresas</p>
              </div>
              <Switch
                checked={form.ativo}
                onCheckedChange={(v) => setForm((p) => ({ ...p, ativo: v }))}
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 pt-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.nome.trim() || !form.feature_key.trim() || !form.valor}
            >
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
