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
  periodicidade: string;
}

const PERIODICIDADE_LABELS: Record<string, string> = {
  mensal: "Mensal",
  anual: "Anual",
  vitalicio: "Vitalício",
};

const PERIODICIDADE_SUFFIX: Record<string, string> = {
  mensal: "/mês",
  anual: "/ano",
  vitalicio: "",
};

export default function Planos() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Plano | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nome: "", valor: "", descricao: "", max_usuarios: "5", max_eventos: "50", trial_days: "0", ativo: true, periodicidade: "mensal",
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
        periodicidade: form.periodicidade,
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
      trial_days: String(p.trial_days), ativo: p.ativo, periodicidade: p.periodicidade || "mensal",
    });
    setDialogOpen(true);
  };

  const openAdd = () => {
    setEditItem(null);
    setForm({ nome: "", valor: "", descricao: "", max_usuarios: "5", max_eventos: "50", trial_days: "0", ativo: true, periodicidade: "mensal" });
    setDialogOpen(true);
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const getValorLabel = () => {
    switch (form.periodicidade) {
      case "anual": return "Valor Anual (R$) *";
      case "vitalicio": return "Valor Único (R$) *";
      default: return "Valor Mensal (R$) *";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Gerenciar Planos</h1>
        <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Novo Plano</Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plano</TableHead>
              <TableHead>Periodicidade</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Máx. Usuários</TableHead>
              <TableHead>Máx. Eventos</TableHead>
              <TableHead>Trial (dias)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {planos.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum plano cadastrado.</TableCell></TableRow>
            ) : (
              planos.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium capitalize">{p.nome}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{PERIODICIDADE_LABELS[p.periodicidade] || "Mensal"}</Badge>
                  </TableCell>
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
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input value={form.nome} onChange={(e) => setForm(p => ({ ...p, nome: e.target.value }))} placeholder="Ex: Plano Básico" />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.periodicidade} onValueChange={(v) => setForm(p => ({ ...p, periodicidade: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                  <SelectItem value="vitalicio">Vitalício</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.periodicidade !== "vitalicio" && (
              <div className="space-y-2">
                <Label>Duração (dias)</Label>
                <Input type="number" min="0" value={form.trial_days} onChange={(e) => setForm(p => ({ ...p, trial_days: e.target.value }))} placeholder="30" />
              </div>
            )}
            <div className="space-y-2">
              <Label>Preço (R$)</Label>
              <Input type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm(p => ({ ...p, valor: e.target.value }))} placeholder="99.90" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Máx. Usuários</Label>
                <Input type="number" min="1" value={form.max_usuarios} onChange={(e) => setForm(p => ({ ...p, max_usuarios: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Máx. Eventos</Label>
                <Input type="number" min="1" value={form.max_eventos} onChange={(e) => setForm(p => ({ ...p, max_eventos: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm(p => ({ ...p, descricao: e.target.value }))} rows={2} placeholder="Ex: Acesso completo por 30 dias" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.nome || !form.valor}>
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
