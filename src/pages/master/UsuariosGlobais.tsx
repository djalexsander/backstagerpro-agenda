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
import { useState } from "react";
import { Pencil, Shield, Users, Globe } from "lucide-react";

const roleLabels: Record<string, string> = {
  master_admin: "Master Admin",
  admin_empresa: "Admin Empresa",
  usuario: "Usuário",
};

const roleIcons: Record<string, any> = {
  master_admin: Globe,
  admin_empresa: Shield,
  usuario: Users,
};

export default function UsuariosGlobais() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editUser, setEditUser] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editEmpresaId, setEditEmpresaId] = useState("");

  const { data: users = [] } = useQuery({
    queryKey: ["master-users"],
    queryFn: async () => {
      const { data: profiles, error: pErr } = await supabase.from("profiles").select("*");
      if (pErr) throw pErr;
      const { data: roles, error: rErr } = await supabase.from("user_roles").select("*");
      if (rErr) throw rErr;
      return profiles.map((p: any) => ({
        ...p,
        role: roles.find((r: any) => r.user_id === p.user_id)?.role || "usuario",
        roleId: roles.find((r: any) => r.user_id === p.user_id)?.id,
      }));
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["master-empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nome_empresa");
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const updates: Promise<any>[] = [
        supabase.from("profiles").update({ full_name: editName, empresa_id: editEmpresaId || null } as any).eq("user_id", editUser.user_id),
      ];
      if (editUser.roleId) {
        updates.push(supabase.from("user_roles").update({ role: editRole } as any).eq("id", editUser.roleId));
      }
      const results = await Promise.all(updates);
      for (const r of results) {
        if (r.error) throw r.error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-users"] });
      toast({ title: "Usuário atualizado!" });
      setEditUser(null);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const openEdit = (u: any) => {
    setEditUser(u);
    setEditName(u.full_name);
    setEditRole(u.role);
    setEditEmpresaId(u.empresa_id || "");
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Usuários Globais</h1>

      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Tipo de Usuário</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="master_admin">Master Admin</SelectItem>
                  <SelectItem value="admin_empresa">Admin Empresa</SelectItem>
                  <SelectItem value="usuario">Usuário</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Select value={editEmpresaId} onValueChange={setEditEmpresaId}>
                <SelectTrigger><SelectValue placeholder="Sem empresa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sem empresa</SelectItem>
                  {empresas.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.nome_empresa}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u: any) => {
              const Icon = roleIcons[u.role] || Users;
              const empresa = empresas.find((e: any) => e.id === u.empresa_id);
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name}</TableCell>
                  <TableCell>{empresa?.nome_empresa || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "master_admin" ? "default" : "secondary"} className="gap-1">
                      <Icon className="h-3 w-3" /> {roleLabels[u.role] || u.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                      <Pencil className="h-4 w-4 mr-1" /> Editar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
