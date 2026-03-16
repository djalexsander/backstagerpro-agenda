import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Lock, Unlock } from "lucide-react";

export default function Empresas() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ nome_empresa: "", email: "", telefone: "", plano: "basico", status: "ativo", senha: "", papel: "admin_empresa" as string });

  const { data: empresas = [] } = useQuery({
    queryKey: ["master-empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: planos = [] } = useQuery({
    queryKey: ["master-planos-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos").select("nome, trial_days").eq("ativo", true);
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const plano = planos.find((p: any) => p.nome === form.plano);
      const trialDays = plano?.trial_days || 0;

      const payload: any = { ...form };

      // When creating a new empresa with a trial plan, set trial_expires_at
      if (!editItem && trialDays > 0) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + trialDays);
        payload.trial_expires_at = expiresAt.toISOString();
        payload.plano_bloqueado = false;
      }

      if (editItem) {
        // If changing plan, recalculate trial or remove block
        if (editItem.plano !== form.plano) {
          if (trialDays > 0) {
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + trialDays);
            payload.trial_expires_at = expiresAt.toISOString();
            payload.plano_bloqueado = false;
          } else {
            payload.trial_expires_at = null;
            payload.plano_bloqueado = false;
          }
        }
        const { error } = await supabase.from("empresas").update(payload).eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("empresas").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-empresas"] });
      toast({ title: editItem ? "Empresa atualizada!" : "Empresa criada!" });
      setAddOpen(false);
      setEditItem(null);
      setForm({ nome_empresa: "", email: "", telefone: "", plano: "basico", status: "ativo" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("empresas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-empresas"] });
      toast({ title: "Empresa excluída!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const toggleBlock = useMutation({
    mutationFn: async ({ id, blocked }: { id: string; blocked: boolean }) => {
      const { error } = await supabase.from("empresas").update({ plano_bloqueado: blocked } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-empresas"] });
      toast({ title: "Status atualizado!" });
    },
  });

  const openEdit = (e: any) => {
    setEditItem(e);
    setForm({ nome_empresa: e.nome_empresa, email: e.email || "", telefone: e.telefone || "", plano: e.plano || "basico", status: e.status || "ativo" });
    setAddOpen(true);
  };

  const openAdd = () => {
    setEditItem(null);
    setForm({ nome_empresa: "", email: "", telefone: "", plano: "basico", status: "ativo" });
    setAddOpen(true);
  };

  const isTrialExpired = (e: any) => {
    if (!e.trial_expires_at) return false;
    return new Date(e.trial_expires_at) < new Date();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Empresas</h1>
        <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Nova Empresa</Button>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Editar Empresa" : "Nova Empresa"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome da Empresa *</Label>
              <Input value={form.nome_empresa} onChange={(e) => setForm(p => ({ ...p, nome_empresa: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={form.telefone} onChange={(e) => setForm(p => ({ ...p, telefone: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Plano</Label>
                <Select value={form.plano} onValueChange={(v) => setForm(p => ({ ...p, plano: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {planos.map((p: any) => (
                      <SelectItem key={p.nome} value={p.nome} className="capitalize">
                        {p.nome} {p.trial_days > 0 ? `(${p.trial_days} dias trial)` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.nome_empresa}>
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Trial</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {empresas.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma empresa cadastrada.</TableCell></TableRow>
            ) : (
              empresas.map((e: any) => {
                const expired = isTrialExpired(e);
                const blocked = e.plano_bloqueado;
                return (
                  <TableRow key={e.id} className={blocked ? "opacity-60" : ""}>
                    <TableCell className="font-medium">{e.nome_empresa}</TableCell>
                    <TableCell>{e.email || "—"}</TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{e.plano}</Badge></TableCell>
                    <TableCell>
                      {e.trial_expires_at ? (
                        <span className={`text-xs ${expired ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                          {expired ? "Expirado" : `Expira em ${new Date(e.trial_expires_at).toLocaleDateString("pt-BR")}`}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {blocked ? (
                        <Badge className="bg-destructive text-destructive-foreground">Bloqueado</Badge>
                      ) : (
                        <Badge className={e.status === "ativo" ? "bg-accent text-accent-foreground" : "bg-destructive text-destructive-foreground"}>
                          {e.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {expired && !blocked && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => toggleBlock.mutate({ id: e.id, blocked: true })}>
                          <Lock className="h-4 w-4 mr-1" /> Bloquear
                        </Button>
                      )}
                      {blocked && (
                        <Button variant="ghost" size="sm" className="text-accent" onClick={() => toggleBlock.mutate({ id: e.id, blocked: false })}>
                          <Unlock className="h-4 w-4 mr-1" /> Desbloquear
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(e)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMutation.mutate(e.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
