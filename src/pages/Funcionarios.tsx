import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Users, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export default function Funcionarios() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { empresaId, empresaReadOnly } = useAuth();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [nome, setNome] = useState("");
  const [funcao, setFuncao] = useState("");
  const [cachePadrao, setCachePadrao] = useState("");
  const [tipo, setTipo] = useState<"equipe" | "freelancer">("equipe");

  const { data: funcionarios = [] } = useQuery({
    queryKey: ["funcionarios", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("funcionarios")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("nome");
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const equipe = funcionarios.filter((f: any) => f.tipo !== "freelancer");
  const freelancers = funcionarios.filter((f: any) => f.tipo === "freelancer");

  const openAdd = (t: "equipe" | "freelancer") => {
    setEditItem(null);
    setNome("");
    setFuncao("");
    setCachePadrao("");
    setTipo(t);
    setOpen(true);
  };

  const openEdit = (f: any) => {
    setEditItem(f);
    setNome(f.nome);
    setFuncao(f.funcao || "");
    setCachePadrao(String(f.cache_padrao || 0));
    setTipo(f.tipo || "equipe");
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        empresa_id: empresaId,
        nome: nome.trim(),
        funcao: funcao.trim(),
        cache_padrao: parseFloat(cachePadrao) || 0,
        tipo,
      };
      if (editItem) {
        const { error } = await supabase.from("funcionarios").update(payload as any).eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("funcionarios").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["funcionarios"] });
      setOpen(false);
      toast({ title: editItem ? "Atualizado!" : "Cadastrado!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("funcionarios").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["funcionarios"] });
      toast({ title: "Removido!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const renderTable = (items: any[]) =>
    items.length === 0 ? (
      <p className="text-center text-muted-foreground py-8">Nenhum cadastrado.</p>
    ) : (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Função</TableHead>
              <TableHead className="text-right">Cachê Padrão</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((f: any) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.nome}</TableCell>
                <TableCell>{f.funcao || "—"}</TableCell>
                <TableCell className="text-right">{fmt(Number(f.cache_padrao))}</TableCell>
                <TableCell className="text-right">
                  {!empresaReadOnly && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(f)} title="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMutation.mutate(f.id)} title="Excluir">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Funcionários</h1>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editItem ? "Editar" : tipo === "freelancer" ? "Novo Freelancer" : "Novo Funcionário"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nome.trim() && !saveMutation.isPending) saveMutation.mutate();
            }}
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" required />
              </div>
              <div className="space-y-2">
                <Label>Função</Label>
                <Input value={funcao} onChange={(e) => setFuncao(e.target.value)} placeholder="Ex: Técnico de Som" />
              </div>
              <div className="space-y-2">
                <Label>Cachê Padrão (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={cachePadrao}
                  onChange={(e) => setCachePadrao(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Salvando..." : editItem ? "Atualizar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Equipe */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Equipe ({equipe.length})
          </CardTitle>
          {!empresaReadOnly && (
            <Button size="sm" variant="outline" onClick={() => openAdd("equipe")}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          )}
        </CardHeader>
        <CardContent>{renderTable(equipe)}</CardContent>
      </Card>

      {/* Freelancers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-accent" />
            Freelancers ({freelancers.length})
          </CardTitle>
          {!empresaReadOnly && (
            <Button size="sm" variant="outline" onClick={() => openAdd("freelancer")}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          )}
        </CardHeader>
        <CardContent>{renderTable(freelancers)}</CardContent>
      </Card>
    </div>
  );
}
