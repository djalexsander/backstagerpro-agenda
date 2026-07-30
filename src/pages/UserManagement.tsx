import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Shield, User, Plus, Pencil, Trash2 } from "lucide-react";
import { normalizeAppRole, selectHighestPriorityRole } from "@/lib/user-role";

export default function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { empresaId, user } = useAuth();
  const { canCreateUser, maxUsuarios, currentUsuarios } = usePlanLimits();
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<string>("usuario");

  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<string>("usuario");

  // empresa_usuarios is the membership set; profiles keeps the active tenant.
  const { data: users = [] } = useQuery({
    queryKey: ["users-management", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];

      const { data: memberships, error: membershipError } = await supabase
        .from("empresa_usuarios")
        .select("user_id, perfil")
        .eq("empresa_id", empresaId);
      if (membershipError) throw membershipError;
      if (!memberships || memberships.length === 0) return [];

      const userIds = memberships.map((membership) => membership.user_id);
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .in("user_id", userIds);
      if (profileError) throw profileError;
      if (!profiles || profiles.length === 0) return [];

      const { data: roles, error: rErr } = await supabase
        .from("user_roles")
        .select("*")
        .in("user_id", userIds);
      if (rErr) throw rErr;

      return profiles
        .map((profile) => {
          const userRoles = roles?.filter((item) => item.user_id === profile.user_id) ?? [];
          const selectedRole = selectHighestPriorityRole(userRoles) || "usuario";
          const selectedRoleRecord = userRoles.find(
            (item) => normalizeAppRole(item.role) === selectedRole,
          );
          return {
            ...profile,
            full_name: profile.full_name || profile.user_id,
            email: profile.email || "",
            role: selectedRole,
            roleId: selectedRoleRecord?.id,
          };
        })
        .filter((listedUser) => listedUser.role !== "master_admin");
    },
    enabled: !!empresaId,
  });

  const updateRole = useMutation({
    mutationFn: async ({ roleId, newRole, userId, newName }: { roleId?: string; newRole: string; userId: string; newName: string }) => {
      // Update role
      if (roleId) {
        const roleRes = await supabase.from("user_roles").update({ role: newRole as any }).eq("id", roleId);
        if (roleRes.error) throw roleRes.error;
      } else {
        // Try upsert if no roleId
        const roleRes = await supabase.from("user_roles").upsert({ user_id: userId, role: newRole as any } as any, { onConflict: "user_id,role" } as any);
        if (roleRes.error) throw roleRes.error;
      }
      // Update profile
      const profileRes = await supabase.from("profiles").update({ full_name: newName } as any).eq("user_id", userId);
      if (profileRes.error) throw profileRes.error;
      // empresa_usuarios.perfil is synchronized by a database trigger.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-management"] });
      toast({ title: "Usuário atualizado!" });
      setEditUser(null);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const addUser = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("create-user", {
        body: {
          email: newEmail,
          full_name: newName,
          perfil: newRole,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["users-management"] });
      toast({
        title: data?.activationEmailSent
          ? "Convite de ativação enviado!"
          : "Usuário atualizado!",
        description: data?.message,
      });
      setAddOpen(false);
      setNewEmail("");
      setNewName("");
      setNewRole("usuario");
    },
    onError: (err: any) => toast({ title: "Erro ao criar usuário", description: err.message, variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!empresaId) throw new Error("Empresa não identificada");
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { user_id: userId, empresa_id: empresaId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["users-management"] });
      toast({
        title: data?.auth_user_deleted
          ? "Usuário removido e acesso encerrado"
          : "Vínculo com a empresa removido",
      });
      setDeleteUser(null);
    },
    onError: (err: any) => toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" }),
  });

  const openEdit = (u: any) => {
    setEditUser(u);
    setEditName(u.full_name);
    setEditRole(u.role);
  };

  const roleLabel = (r: string) => {
    if (r === "admin_empresa") return "Admin Empresa";
    if (r === "master_admin") return "Master Admin";
    return "Usuário";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Gerenciamento de Usuários</h1>
        {!canCreateUser && (
          <p className="text-sm text-destructive">Limite atingido: {currentUsuarios}/{maxUsuarios} usuários. Faça upgrade do plano.</p>
        )}
        <Dialog open={addOpen} onOpenChange={(open) => { if (!canCreateUser && open) return; setAddOpen(open); }}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={!canCreateUser}><Plus className="h-4 w-4 mr-1" /> Novo Usuário</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Adicionar Usuário</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Nome completo</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome do usuário" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@exemplo.com" />
              </div>
              <p className="text-xs text-muted-foreground">
                O usuário deverá acessar "Primeiro acesso" na tela de login para definir sua senha.
              </p>
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin_empresa">Admin Empresa</SelectItem>
                    <SelectItem value="usuario">Usuário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={() => addUser.mutate()} disabled={addUser.isPending || !newEmail || !newName}>
                {addUser.isPending ? "Criando..." : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
          {editUser && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Nome completo</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={editUser.email || ""} disabled className="opacity-60" />
              </div>
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin_empresa">Admin Empresa</SelectItem>
                    <SelectItem value="usuario">Usuário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button
              onClick={() => editUser && updateRole.mutate({ roleId: editUser.roleId, newRole: editRole, userId: editUser.user_id, newName: editName })}
              disabled={updateRole.isPending}
            >
              {updateRole.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário</AlertDialogTitle>
            <AlertDialogDescription>
              O vínculo de <strong>{deleteUser?.full_name}</strong> com esta
              empresa será removido. A conta de acesso só será excluída se não
              houver vínculo com outra empresa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteUser && deleteUserMutation.mutate(deleteUser.user_id)}
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
              <TableHead>Email</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u: any) => (
              <TableRow key={u.id}>
                <TableCell><p className="font-medium">{u.full_name}</p></TableCell>
                <TableCell><p className="text-muted-foreground text-sm">{u.email || "—"}</p></TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin_empresa" ? "default" : "secondary"} className="gap-1">
                    {u.role === "admin_empresa" ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    {roleLabel(u.role)}
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
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
