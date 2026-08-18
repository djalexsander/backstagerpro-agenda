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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Shield, Sparkles, Clock, Package, AlertTriangle, Info } from "lucide-react";
import {
  classifySubscriptionPlan,
  isCommercialBasePlan,
  isLifetimePlan,
  type SubscriptionPlanCategory,
} from "@/lib/subscription-license";

interface Plano {
  id: string;
  nome: string;
  valor: number;
  descricao: string | null;
  max_usuarios: number | null;
  max_eventos: number | null;
  trial_days: number;
  ativo: boolean;
  periodicidade: string;
  disponivel_novo_cadastro: boolean;
  categoria: string;
}

type PlanoTipo = SubscriptionPlanCategory;

const PERIODICIDADE_LABELS: Record<string, string> = {
  trial: "Trial",
  mensal: "Mensal",
  anual: "Anual",
  vitalicio: "Vitalício",
};

function normalizePlanSaveError(error: any): Error {
  if (
    error?.code === "23505" &&
    String(error?.message).includes("planos_single_active_commercial_base_idx")
  ) {
    return new Error(
      "JÃ¡ existe um plano base comercial ativo. Edite ou inative o plano existente antes de criar outro.",
    );
  }
  return error instanceof Error ? error : new Error(String(error?.message || error));
}

export default function Planos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Plano | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nome: "", valor: "", descricao: "", max_usuarios: "5", max_eventos: "50", trial_days: "0", ativo: true, periodicidade: "mensal", disponivel_novo_cadastro: true,
  });

  const { data: planos = [] } = useQuery({
    queryKey: ["master-planos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos").select("*").order("valor", { ascending: true });
      if (error) throw error;
      return data as Plano[];
    },
  });

  // Empresas usando cada plano (para aviso de legado)
  const { data: empresasCount = {} } = useQuery({
    queryKey: ["master-planos-empresas-count"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("plano_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach((e) => {
        if (e.plano_id) counts[e.plano_id] = (counts[e.plano_id] || 0) + 1;
      });
      return counts;
    },
  });

  const trialPlanos = planos.filter((p) => classifySubscriptionPlan(p) === "trial");
  const basePlanos = planos.filter(isCommercialBasePlan);
  const lifetimePlanos = planos.filter(isLifetimePlan);
  const legadoPlanos = planos.filter(
    (p) =>
      classifySubscriptionPlan(p) !== "trial" &&
      !isCommercialBasePlan(p) &&
      !isLifetimePlan(p),
  );
  const baseCreationBlocked = basePlanos.length > 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const isLifetime = form.periodicidade === "vitalicio";
      const isTrial = form.periodicidade === "trial";
      const payload = {
        nome: isLifetime ? "Vitalícia" : form.nome,
        valor: isLifetime || isTrial ? 0 : parseFloat(form.valor) || 0,
        descricao: form.descricao || null,
        max_usuarios: isLifetime ? null : parseInt(form.max_usuarios) || 5,
        max_eventos: isLifetime ? null : parseInt(form.max_eventos) || 50,
        trial_days: isLifetime ? 0 : parseInt(form.trial_days) || 0,
        ativo: isLifetime ? true : form.ativo,
        periodicidade: form.periodicidade,
        disponivel_novo_cadastro: isLifetime
          ? false
          : form.disponivel_novo_cadastro,
        categoria: isTrial ? "trial" : "plano_base",
      };
      const wouldBeActiveCommercialBase = isCommercialBasePlan(payload);
      const hasOtherActiveCommercialBase = planos.some(
        (plan) => plan.id !== editItem?.id && isCommercialBasePlan(plan),
      );
      if (wouldBeActiveCommercialBase && hasOtherActiveCommercialBase) {
        throw new Error(
          "JÃ¡ existe um plano base comercial ativo. Edite ou inative o plano existente antes de criar outro.",
        );
      }
      if (editItem) {
        const { error } = await supabase.from("planos").update(payload as any).eq("id", editItem.id);
        if (error) throw normalizePlanSaveError(error);
      } else {
        const { error } = await supabase.from("planos").insert(payload as any);
        if (error) throw normalizePlanSaveError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-planos"] });
      toast({ title: editItem ? "Plano atualizado!" : "Plano criado!" });
      setDialogOpen(false);
      setEditItem(null);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("planos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-planos"] });
      toast({ title: "Plano excluído!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const openEdit = (p: Plano) => {
    setEditItem(p);
    setForm({
      nome: p.nome, valor: String(p.valor), descricao: p.descricao || "",
      max_usuarios: p.max_usuarios == null ? "" : String(p.max_usuarios),
      max_eventos: p.max_eventos == null ? "" : String(p.max_eventos),
      trial_days: String(p.trial_days), ativo: p.ativo, periodicidade: p.periodicidade || "mensal",
      disponivel_novo_cadastro: p.disponivel_novo_cadastro,
    });
    setDialogOpen(true);
  };

  const openAdd = () => {
    setEditItem(null);
    setForm({ nome: "", valor: "", descricao: "", max_usuarios: "5", max_eventos: "50", trial_days: "0", ativo: true, periodicidade: "mensal", disponivel_novo_cadastro: true });
    setDialogOpen(true);
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const renderPlanoRow = (p: Plano, tipo: PlanoTipo) => {
    const count = empresasCount[p.id] || 0;
    const isLifetime = isLifetimePlan(p);
    return (
      <TableRow key={p.id} className={tipo === "legado" ? "opacity-60" : ""}>
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            {tipo === "trial" && <Clock className="h-4 w-4 text-amber-500" />}
            {tipo === "base" && <Shield className="h-4 w-4 text-primary" />}
            {tipo === "legado" && <AlertTriangle className="h-4 w-4 text-muted-foreground" />}
            <span className="capitalize">{p.nome}</span>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{PERIODICIDADE_LABELS[p.periodicidade] || "Mensal"}</Badge>
        </TableCell>
        <TableCell className="font-semibold">
          {p.valor === 0 ? "Grátis" : formatCurrency(p.valor)}
        </TableCell>
        <TableCell>{isLifetime || p.max_usuarios == null ? "Ilimitado" : p.max_usuarios}</TableCell>
        <TableCell>{isLifetime || p.max_eventos == null ? "Ilimitado" : p.max_eventos}</TableCell>
        <TableCell>
          {count > 0 ? (
            <Badge variant="secondary" className="text-xs">{count} empresa{count > 1 ? "s" : ""}</Badge>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </TableCell>
        <TableCell>
          <Badge className={p.ativo ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}>
            {p.ativo ? "Ativo" : "Inativo"}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
          {count === 0 && !isLifetime && tipo !== "trial" && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteId(p.id)}><Trash2 className="h-4 w-4" /></Button>
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Gerenciar Planos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Modelo: Plano Base + Módulos adicionais
          </p>
        </div>
        <div className="text-right">
          <Button size="sm" onClick={openAdd} disabled={baseCreationBlocked}>
            <Plus className="h-4 w-4 mr-1" /> Novo Plano
          </Button>
          {baseCreationBlocked && (
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              JÃ¡ existe um plano base ativo. Edite ou inative o plano existente para substituÃ­-lo.
            </p>
          )}
        </div>
      </div>

      {/* Explicação do modelo */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 pt-4 pb-4">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium text-foreground">Novo modelo comercial</p>
            <p className="text-muted-foreground">
              O sistema agora funciona com <strong>plano base + módulos</strong>. O plano base define os limites iniciais (usuários e eventos).
              Funcionalidades extras e capacidade adicional são controladas pelos <strong>módulos</strong>, gerenciados em área própria.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Trial</CardDescription>
            <CardTitle className="text-2xl">{trialPlanos.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> Planos Base Ativos</CardDescription>
            <CardTitle className="text-2xl">{basePlanos.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Legados / Inativos</CardDescription>
            <CardTitle className="text-2xl">{legadoPlanos.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Trial */}
      {trialPlanos.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" /> Trial / Teste Gratuito
          </h2>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plano</TableHead>
                  <TableHead>Periodicidade</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Máx. Usuários</TableHead>
                  <TableHead>Máx. Eventos</TableHead>
                  <TableHead>Empresas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{trialPlanos.map((p) => renderPlanoRow(p, "trial"))}</TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* VitalÃ­cio segue como licenÃ§a administrativa separada. */}
      {lifetimePlanos.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> VitalÃ­cio
          </h2>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plano</TableHead>
                  <TableHead>Periodicidade</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>MÃ¡x. UsuÃ¡rios</TableHead>
                  <TableHead>MÃ¡x. Eventos</TableHead>
                  <TableHead>Empresas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">AÃ§Ãµes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{lifetimePlanos.map((p) => renderPlanoRow(p, "base"))}</TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Planos Base */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" /> Plano Base
        </h2>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plano</TableHead>
                <TableHead>Periodicidade</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Máx. Usuários</TableHead>
                <TableHead>Máx. Eventos</TableHead>
                <TableHead>Empresas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {basePlanos.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Nenhum plano base ativo. Crie um para começar.</TableCell></TableRow>
              ) : (
                basePlanos.map((p) => renderPlanoRow(p, "base"))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Legados */}
      {legadoPlanos.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-5 w-5" /> Planos Legados / Descontinuados
          </h2>
          <p className="text-xs text-muted-foreground">
            Estes planos foram descontinuados no novo modelo. Empresas que ainda os utilizam mantêm acesso até migração.
          </p>
          <div className="rounded-lg border bg-card border-dashed">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plano</TableHead>
                  <TableHead>Periodicidade</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Máx. Usuários</TableHead>
                  <TableHead>Máx. Eventos</TableHead>
                  <TableHead>Empresas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{legadoPlanos.map((p) => renderPlanoRow(p, "legado"))}</TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir plano?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita. O plano será removido permanentemente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Editar Plano" : "Novo Plano"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {editItem && isLifetimePlan(editItem) && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">
                A estrutura da licença Vitalícia é protegida. Somente a descrição pode ser ajustada; concessões são feitas pela gestão de empresas.
              </div>
            )}
            <div className="space-y-2">
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input value={form.nome} disabled={!!editItem && isLifetimePlan(editItem)} onChange={(e) => setForm(p => ({ ...p, nome: e.target.value }))} placeholder="Ex: Plano Base" />
            </div>
            <div className="space-y-2">
              <Label>Periodicidade</Label>
              <Select value={form.periodicidade} onValueChange={(v) => setForm(p => ({ ...p, periodicidade: v }))}>
                <SelectTrigger disabled={!!editItem && isLifetimePlan(editItem)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial" disabled={!editItem || editItem.periodicidade !== "trial"}>Trial</SelectItem>
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                  <SelectItem value="vitalicio" disabled={!editItem || !isLifetimePlan(editItem)}>Vitalício</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Preço (R$)</Label>
              <Input type="number" step="0.01" min="0" disabled={!!editItem && isLifetimePlan(editItem)} value={form.valor} onChange={(e) => setForm(p => ({ ...p, valor: e.target.value }))} placeholder="99.90" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Máx. Usuários (base)</Label>
                <Input type="number" min="1" disabled={!!editItem && isLifetimePlan(editItem)} value={form.max_usuarios} onChange={(e) => setForm(p => ({ ...p, max_usuarios: e.target.value }))} placeholder={editItem && isLifetimePlan(editItem) ? "Ilimitado" : undefined} />
              </div>
              <div className="space-y-2">
                <Label>Máx. Eventos (base)</Label>
                <Input type="number" min="1" disabled={!!editItem && isLifetimePlan(editItem)} value={form.max_eventos} onChange={(e) => setForm(p => ({ ...p, max_eventos: e.target.value }))} placeholder={editItem && isLifetimePlan(editItem) ? "Ilimitado" : undefined} />
              </div>
            </div>
            {form.periodicidade !== "vitalicio" && (
              <div className="space-y-2">
                <Label>Trial (dias)</Label>
                <Input type="number" min="0" value={form.trial_days} onChange={(e) => setForm(p => ({ ...p, trial_days: e.target.value }))} placeholder="0" />
              </div>
            )}
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm(p => ({ ...p, descricao: e.target.value }))} rows={2} placeholder="Descrição do plano" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.ativo} disabled={!!editItem && isLifetimePlan(editItem)} onCheckedChange={(v) => setForm(p => ({ ...p, ativo: v }))} />
              <Label>Ativo</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.disponivel_novo_cadastro} disabled={!!editItem && isLifetimePlan(editItem)} onCheckedChange={(v) => setForm(p => ({ ...p, disponivel_novo_cadastro: v }))} />
              <Label>Disponível para novos cadastros</Label>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.nome}>
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
