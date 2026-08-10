import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Package, Zap, HardDrive, Star, ArrowUp, ArrowDown,
  Eye, EyeOff, Sparkles, TrendingUp, Layers, Tag,
} from "lucide-react";
import {
  MODULE_CATEGORIES, MODULE_BADGES, getCategoryLabel, getCategoryColor, getBadgeInfo,
} from "@/constants/module-categories";
import { fetchMasterModuleCatalog } from "@/lib/master-module-catalog";

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
  destaque: boolean;
  categoria: string;
  badge: string | null;
  texto_venda: string | null;
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
  destaque: false,
  categoria: "operacional",
  badge: "" as string,
  texto_venda: "",
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
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "featured">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: modulos = [] } = useQuery({
    queryKey: ["master-modulos"],
    queryFn: async () => fetchMasterModuleCatalog(supabase),
    refetchOnMount: "always",
  });

  const stats = useMemo(() => {
    const total = modulos.length;
    const ativos = modulos.filter((m) => m.ativo).length;
    const destaques = modulos.filter((m) => m.destaque).length;
    const funcionalidade = modulos.filter((m) => !m.is_capacity_module && m.ativo).length;
    const capacidade = modulos.filter((m) => m.is_capacity_module && m.ativo).length;
    const withBadge = modulos.filter((m) => m.badge).length;
    return { total, ativos, destaques, funcionalidade, capacidade, withBadge };
  }, [modulos]);

  const filtered = modulos.filter((m) => {
    if (statusFilter === "active" && !m.ativo) return false;
    if (statusFilter === "inactive" && m.ativo) return false;
    if (statusFilter === "featured" && !m.destaque) return false;
    if (categoryFilter !== "all" && m.categoria !== categoryFilter) return false;
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
        destaque: form.destaque,
        categoria: form.categoria,
        badge: form.badge || null,
        texto_venda: form.texto_venda.trim() || null,
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

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("module_catalog").update({ ativo } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["master-modulos"] }),
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const toggleDestaque = useMutation({
    mutationFn: async ({ id, destaque }: { id: string; destaque: boolean }) => {
      const { error } = await supabase.from("module_catalog").update({ destaque } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["master-modulos"] }),
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const reorder = useMutation({
    mutationFn: async ({ id, direction }: { id: string; direction: "up" | "down" }) => {
      const idx = modulos.findIndex((m) => m.id === id);
      if (idx < 0) return;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= modulos.length) return;
      const current = modulos[idx];
      const swap = modulos[swapIdx];
      await Promise.all([
        supabase.from("module_catalog").update({ ordem: swap.ordem } as any).eq("id", current.id),
        supabase.from("module_catalog").update({ ordem: current.ordem } as any).eq("id", swap.id),
      ]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["master-modulos"] }),
  });

  const openAdd = () => {
    setEditItem(null);
    const nextOrder = modulos.length > 0 ? Math.max(...modulos.map((m) => m.ordem)) + 1 : 0;
    setForm({ ...EMPTY_FORM, ordem: String(nextOrder) });
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
      destaque: m.destaque,
      categoria: m.categoria || "operacional",
      badge: m.badge || "",
      texto_venda: m.texto_venda || "",
    });
    setDialogOpen(true);
  };

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Package className="h-6 w-6 text-primary" />
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Catálogo de Módulos</h1>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" /> Novo Módulo
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Total", value: stats.total, icon: Layers, color: "text-foreground" },
          { label: "Ativos", value: stats.ativos, icon: Eye, color: "text-green-600" },
          { label: "Destaques", value: stats.destaques, icon: Star, color: "text-amber-500" },
          { label: "Funcionalidade", value: stats.funcionalidade, icon: Zap, color: "text-blue-500" },
          { label: "Capacidade", value: stats.capacidade, icon: HardDrive, color: "text-purple-500" },
          { label: "Com Badge", value: stats.withBadge, icon: Tag, color: "text-pink-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3 p-4">
              <Icon className={`h-5 w-5 ${color} shrink-0`} />
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="all">Todos ({modulos.length})</TabsTrigger>
            <TabsTrigger value="active">Ativos ({stats.ativos})</TabsTrigger>
            <TabsTrigger value="inactive">Inativos ({modulos.length - stats.ativos})</TabsTrigger>
            <TabsTrigger value="featured">
              <Star className="h-3.5 w-3.5 mr-1" /> Destaques ({stats.destaques})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {MODULE_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Ordem</TableHead>
              <TableHead>Módulo</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Badge</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead className="text-center">Destaque</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Nenhum módulo encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((m) => {
                const badgeInfo = getBadgeInfo(m.badge);
                return (
                  <TableRow key={m.id} className={m.destaque ? "bg-amber-500/5" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground w-6 text-center">{m.ordem}</span>
                        <div className="flex flex-col">
                          <Button variant="ghost" size="icon" className="h-5 w-5" disabled={reorder.isPending} onClick={() => reorder.mutate({ id: m.id, direction: "up" })}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-5 w-5" disabled={reorder.isPending} onClick={() => reorder.mutate({ id: m.id, direction: "down" })}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium">{m.nome}</span>
                        {m.texto_venda && (
                          <p className="text-xs text-primary/80 line-clamp-1 mt-0.5 italic">{m.texto_venda}</p>
                        )}
                        {m.descricao && !m.texto_venda && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{m.descricao}</p>
                        )}
                        <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{m.feature_key}</code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${getCategoryColor(m.categoria)}`}>
                        {getCategoryLabel(m.categoria)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {badgeInfo ? (
                        <Badge className={`text-xs ${badgeInfo.className}`}>{badgeInfo.label}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        {m.is_capacity_module ? (
                          <><HardDrive className="h-3 w-3" /> Cap.</>
                        ) : (
                          <><Zap className="h-3 w-3" /> Func.</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold">{formatCurrency(m.valor)}</span>
                      <span className="text-xs text-muted-foreground font-normal">
                        {m.periodicidade === "vitalicio" || m.periodicidade === "unico" ? "" : m.periodicidade === "anual" ? "/ano" : "/mês"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleDestaque.mutate({ id: m.id, destaque: !m.destaque })}>
                        <Star className={`h-4 w-4 ${m.destaque ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                      </Button>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleAtivo.mutate({ id: m.id, ativo: !m.ativo })}>
                        {m.ativo ? <Eye className="h-4 w-4 text-green-600" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(m)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(m.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
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
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
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
              <Input value={form.nome} onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Ex: Relatórios Avançados" maxLength={100} />
            </div>

            {/* Feature Key */}
            <div className="space-y-1.5">
              <Label>Feature Key <span className="text-destructive">*</span></Label>
              <Input value={form.feature_key} onChange={(e) => setForm((p) => ({ ...p, feature_key: e.target.value }))} placeholder="Ex: relatorios_avancados" maxLength={50} disabled={!!editItem} />
              <p className="text-xs text-muted-foreground">Identificador único (não pode ser alterado depois de criado)</p>
            </div>

            {/* Categoria e Badge */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={form.categoria} onValueChange={(v) => setForm((p) => ({ ...p, categoria: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODULE_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Badge comercial</Label>
                <Select value={form.badge || "none"} onValueChange={(v) => setForm((p) => ({ ...p, badge: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {MODULE_BADGES.map((b) => (
                      <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                <Input type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm((p) => ({ ...p, valor: e.target.value }))} placeholder="49.90" />
              </div>
              <div className="space-y-1.5">
                <Label>Ordem de exibição</Label>
                <Input type="number" min="0" value={form.ordem} onChange={(e) => setForm((p) => ({ ...p, ordem: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Menor = aparece primeiro</p>
              </div>
            </div>

            {/* Texto de venda */}
            <div className="space-y-1.5">
              <Label>Texto de venda (pitch curto)</Label>
              <Input value={form.texto_venda} onChange={(e) => setForm((p) => ({ ...p, texto_venda: e.target.value }))} placeholder="Ex: Ideal para quem quer controle total dos custos" maxLength={120} />
              <p className="text-xs text-muted-foreground">{form.texto_venda.length}/120 — Exibido na área do cliente</p>
            </div>

            {/* Descrição */}
            <div className="space-y-1.5">
              <Label>Descrição comercial</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))} rows={3} placeholder="Descrição detalhada do módulo..." maxLength={500} />
              <p className="text-xs text-muted-foreground">{form.descricao.length}/500 caracteres</p>
            </div>

            {/* Destaque */}
            <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2">
                <Star className={`h-4 w-4 ${form.destaque ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-sm font-medium">Módulo em destaque</p>
                  <p className="text-xs text-muted-foreground">Aparece com destaque visual na contratação</p>
                </div>
              </div>
              <Switch checked={form.destaque} onCheckedChange={(v) => setForm((p) => ({ ...p, destaque: v }))} />
            </div>

            {/* Módulo de capacidade */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Módulo de capacidade</p>
                <p className="text-xs text-muted-foreground">Aumenta limites de usuários, eventos ou storage</p>
              </div>
              <Switch checked={form.is_capacity_module} onCheckedChange={(v) => setForm((p) => ({ ...p, is_capacity_module: v }))} />
            </div>

            {form.is_capacity_module && (
              <div className="grid grid-cols-3 gap-3 pl-2 border-l-2 border-primary/20">
                <div className="space-y-1.5">
                  <Label className="text-xs">+ Usuários</Label>
                  <Input type="number" min="0" value={form.capacidade_extra_usuarios} onChange={(e) => setForm((p) => ({ ...p, capacidade_extra_usuarios: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">+ Eventos</Label>
                  <Input type="number" min="0" value={form.capacidade_extra_eventos} onChange={(e) => setForm((p) => ({ ...p, capacidade_extra_eventos: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">+ Storage (GB)</Label>
                  <Input type="number" min="0" value={form.capacidade_extra_storage} onChange={(e) => setForm((p) => ({ ...p, capacidade_extra_storage: e.target.value }))} />
                </div>
              </div>
            )}

            {/* Ativo */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Módulo ativo</p>
                <p className="text-xs text-muted-foreground">Disponível para contratação pelas empresas</p>
              </div>
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm((p) => ({ ...p, ativo: v }))} />
            </div>
          </div>

          <DialogFooter className="shrink-0 pt-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.nome.trim() || !form.feature_key.trim() || !form.valor}>
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
