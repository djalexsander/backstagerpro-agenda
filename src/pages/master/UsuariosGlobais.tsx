import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Pencil, Shield, Users, Globe, Trash2 } from "lucide-react";
import { normalizeAppRole, selectHighestPriorityRole } from "@/lib/user-role";

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
  const { user } = useAuth();
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);
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
      return profiles.map((p: any) => {
        const userRoles = roles.filter((role) => role.user_id === p.user_id);
        const selectedRole = selectHighestPriorityRole(userRoles) || "usuario";
        const selectedRoleRecord = userRoles.find(
          (role) => normalizeAppRole(role.role) === selectedRole,
        );

        return {
          ...p,
          role: selectedRole,
          roleId: selectedRoleRecord?.id,
        };
      });
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
      // A user can carry more than one user_roles row (e.g. the "usuario"
      // role a signup trigger creates, plus "admin_empresa" added later by
      // Master > Empresas when inviting a company admin). master_set_user_role
      // reconciles profiles and user_roles to a single canonical role in one
      // transaction, guarding against a demotion leaving the user with the
      // old role still active (or no role at all) and against removing the
      // platform's last master_admin.
      const { error } = await supabase.rpc("master_set_user_role", {
        _target_user_id: editUser.user_id,
        _role: editRole,
        _full_name: editName,
        _empresa_id: editEmpresaId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-users"] });
      toast({ title: "Usuário atualizado!" });
      setEditUser(null);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async ({
      userId,
      empresaId,
    }: {
      userId: string;
      empresaId: string | null;
    }) => {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        headers: {
          Authorization: `Bearer ${await supabase.auth.getSession().then(({ data }) => data.session?.access_token ?? "")}`,
        },
        body: { user_id: userId, empresa_id: empresaId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["master-users"] });
      toast({
        title: data?.auth_user_deleted
          ? "Identidade Auth excluída"
          : "Vínculo empresarial removido",
      });
      setDeleteUser(null);
    },
    onError: (err: any) => toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" }),
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
              <Select value={editEmpresaId || "none"} onValueChange={(v) => setEditEmpresaId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Sem empresa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem empresa</SelectItem>
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

      <AlertDialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário</AlertDialogTitle>
            <AlertDialogDescription>
              O vínculo empresarial de <strong>{deleteUser?.full_name}</strong>
              será removido. A identidade Auth somente será excluída quando não
              existir nenhum outro vínculo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteUser &&
                deleteUserMutation.mutate({
                  userId: deleteUser.user_id,
                  empresaId: deleteUser.empresa_id || null,
                })
              }
              disabled={deleteUserMutation.isPending}
            >
              {deleteUserMutation.isPending ? "Removendo..." : "Remover vínculo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                        <Pencil className="h-4 w-4 mr-1" /> Editar
                      </Button>
                      {u.user_id !== user?.id && (
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteUser(u)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
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
