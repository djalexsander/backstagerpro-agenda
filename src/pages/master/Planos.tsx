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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, DollarSign, Clock } from "lucide-react";

interface Plano {
  id: string;
  nome: string;
  valor: number;
  descricao: string | null;
  max_usuarios: number;
  max_eventos: number;
  trial_days: number;
  ativo: boolean;
}

export default function Planos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Plano | null>(null);
  const [form, setForm] = useState({
    nome: "", valor: "", descricao: "", max_usuarios: "5", max_eventos: "50", trial_days: "0", ativo: true,
  });

  const { data: planos = [] } = useQuery({
    queryKey: ["master-planos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos").select("*").order("valor", { ascending: true });
      if (error) throw error;
      return data as Plano[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        nome: form.nome,
        valor: parseFloat(form.valor) || 0,
        descricao: form.descricao || null,
        max_usuarios: parseInt(form.max_usuarios) || 5,
        max_eventos: parseInt(form.max_eventos) || 50,
        trial_days: parseInt(form.trial_days) || 0,
        ativo: form.ativo,
      };
      if (editItem) {
        const { error } = await supabase.from("planos").update(payload as any).eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("planos").insert(payload as any);
        if (error) throw error;
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
      max_usuarios: String(p.max_usuarios), max_eventos: String(p.max_eventos),
      trial_days: String(p.trial_days), ativo: p.ativo,
    });
    setDialogOpen(true);
  };

  const openAdd = () => {
    setEditItem(null);
    setForm({ nome: "", valor: "", descricao: "", max_usuarios: "5", max_eventos: "50", trial_days: "0", ativo: true });
    setDialogOpen(true);
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Gerenciar Planos</h1>
        <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Novo Plano</Button>
      </div>

      {/* Cards overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {planos.filter(p => p.ativo).map((p) => (
          <div key={p.id} className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold capitalize text-lg">{p.nome}</h3>
              <Badge variant={p.ativo ? "default" : "secondary"}>{p.ativo ? "Ativo" : "Inativo"}</Badge>
            </div>
            <p className="text-3xl font-bold text-primary">{formatCurrency(p.valor)}<span className="text-sm font-normal text-muted-foreground">/mês</span></p>
            {p.descricao && <p className="text-sm text-muted-foreground">{p.descricao}</p>}
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Até {p.max_usuarios} usuários</span>
              <span>Até {p.max_eventos} eventos</span>
              {p.trial_days > 0 && (
                <span className="flex items-center gap-1 text-[hsl(var(--warning))]">
                  <Clock className="h-3 w-3" /> Teste grátis: {p.trial_days} dias
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => openEdit(p)}>
              <Pencil className="h-4 w-4 mr-1" /> Editar
            </Button>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plano</TableHead>
              <TableHead>Valor Mensal</TableHead>
              <TableHead>Máx. Usuários</TableHead>
              <TableHead>Máx. Eventos</TableHead>
              <TableHead>Trial (dias)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {planos.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum plano cadastrado.</TableCell></TableRow>
            ) : (
              planos.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium capitalize">{p.nome}</TableCell>
                  <TableCell className="font-semibold">{formatCurrency(p.valor)}</TableCell>
                  <TableCell>{p.max_usuarios}</TableCell>
                  <TableCell>{p.max_eventos}</TableCell>
                  <TableCell>{p.trial_days > 0 ? `${p.trial_days} dias` : "—"}</TableCell>
                  <TableCell>
                    <Badge className={p.ativo ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}>
                      {p.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMutation.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Editar Plano" : "Novo Plano"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome do Plano *</Label>
              <Input value={form.nome} onChange={(e) => setForm(p => ({ ...p, nome: e.target.value }))} placeholder="Ex: basico" />
            </div>
            <div className="space-y-2">
              <Label>Valor Mensal (R$) *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input type="number" step="0.01" min="0" className="pl-9" value={form.valor} onChange={(e) => setForm(p => ({ ...p, valor: e.target.value }))} placeholder="99.90" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm(p => ({ ...p, descricao: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Máx. Usuários</Label>
                <Input type="number" min="1" value={form.max_usuarios} onChange={(e) => setForm(p => ({ ...p, max_usuarios: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Máx. Eventos</Label>
                <Input type="number" min="1" value={form.max_eventos} onChange={(e) => setForm(p => ({ ...p, max_eventos: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Trial (dias)</Label>
                <Input type="number" min="0" value={form.trial_days} onChange={(e) => setForm(p => ({ ...p, trial_days: e.target.value }))} placeholder="0 = sem trial" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm(p => ({ ...p, ativo: v }))} />
              <Label>Plano ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.nome || !form.valor}>
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
