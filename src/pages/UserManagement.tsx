import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useCompanyModules } from "@/hooks/useCompanyModules";
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
import { UserModulePermissionsFields } from "@/components/users/UserModulePermissionsFields";
import {
  buildEmptyPermissionRows,
  fetchUserModulePermissions,
  filterConfigurableModules,
  resolveCreatedUserId,
  saveUserModulePermissions,
  type ModulePermissionEntry,
} from "@/lib/user-module-permissions-service";

export default function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { empresaId, user } = useAuth();
  const { canCreateUser, maxUsuarios, currentUsuarios } = usePlanLimits();
  const { activeModules, catalog } = useCompanyModules();
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<string>("usuario");
  const [newPermissions, setNewPermissions] = useState<ModulePermissionEntry[]>([]);

  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<string>("usuario");
  const [editPermissions, setEditPermissions] = useState<ModulePermissionEntry[]>([]);

  // Só busca quando o papel selecionado no formulário é "usuario" - Admin
  // Empresa tem acesso total e não é regido por esta tabela (Fase 1).
  const editPermissionsQuery = useQuery({
    queryKey: ["user-module-permissions", empresaId, editUser?.user_id],
    queryFn: () => fetchUserModulePermissions(empresaId!, editUser.user_id),
    enabled: !!empresaId && !!editUser?.user_id && editRole === "usuario",
  });

  useEffect(() => {
    if (editPermissionsQuery.data) {
      // Carrega exatamente o que está salvo no banco (RPC list_user_module_permissions);
      // só descarta módulos de capacidade, que não são uma tela/ação configurável.
      setEditPermissions(filterConfigurableModules(editPermissionsQuery.data, catalog));
    }
  }, [editPermissionsQuery.data, catalog]);

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
    mutationFn: async ({
      roleId,
      newRole,
      userId,
      newName,
      permissions,
    }: { roleId?: string; newRole: string; userId: string; newName: string; permissions: ModulePermissionEntry[] }) => {
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

      // Role must already be "usuario" in the DB before set_user_module_permissions
      // accepts the target (Fase 1 rejects admin_empresa/master_admin targets) -
      // that's why this runs after the role/profile writes above, never before.
      // admin_empresa keeps unrestricted access with no ACL row needed, so
      // switching *away* from usuario intentionally leaves old grants
      // untouched rather than clearing them (harmless: nothing reads them for
      // a non-"usuario" role yet, and Fase 3 gating starts module by module).
      if (newRole === "usuario" && empresaId) {
        await saveUserModulePermissions(empresaId, userId, permissions);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-management"] });
      queryClient.invalidateQueries({ queryKey: ["user-module-permissions"] });
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

      // create-user doesn't return the created/reused user_id, so the new
      // member is located by email within this company (profiles.email is
      // written by that same Edge Function call, synchronously).
      let permissionsWarning: string | null = null;
      if (newRole === "usuario" && empresaId) {
        const createdUserId = await resolveCreatedUserId(empresaId, newEmail.trim().toLowerCase());
        if (createdUserId) {
          try {
            await saveUserModulePermissions(empresaId, createdUserId, newPermissions);
          } catch (permError) {
            permissionsWarning = permError instanceof Error ? permError.message : "Falha ao salvar permissões.";
          }
        } else {
          permissionsWarning = "Não foi possível localizar o novo usuário para salvar as permissões agora.";
        }
      }
      return { ...data, permissionsWarning };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["users-management"] });
      toast({
        title: data?.activationEmailSent
          ? "Convite de ativação enviado!"
          : "Usuário atualizado!",
        description: data?.message,
      });
      if (data?.permissionsWarning) {
        toast({
          title: "Permissões não salvas",
          description: `${data.permissionsWarning} Edite o usuário para configurar.`,
          variant: "destructive",
        });
      }
      setAddOpen(false);
      setNewEmail("");
      setNewName("");
      setNewRole("usuario");
      setNewPermissions([]);
    },
    onError: (err: any) => toast({ title: "Erro ao criar usuário", description: err.message, variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!empresaId) throw new Error("Empresa não identificada");
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
    setEditPermissions([]); // evita mostrar por um instante as permissões do usuário editado anteriormente
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
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            if (!canCreateUser && open) return;
            if (open) setNewPermissions(buildEmptyPermissionRows(activeModules));
            setAddOpen(open);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" disabled={!canCreateUser}><Plus className="h-4 w-4 mr-1" /> Novo Usuário</Button>
          </DialogTrigger>
          <DialogContent className="flex max-h-[85vh] flex-col">
            <DialogHeader className="shrink-0"><DialogTitle>Adicionar Usuário</DialogTitle></DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1">
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
              {newRole === "usuario" && (
                <UserModulePermissionsFields rows={newPermissions} onChange={setNewPermissions} />
              )}
            </div>
            <DialogFooter className="shrink-0">
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={() => addUser.mutate()} disabled={addUser.isPending || !newEmail || !newName}>
                {addUser.isPending ? "Criando..." : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col">
          <DialogHeader className="shrink-0"><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
          {editUser && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1">
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
              {editRole === "usuario" && (
                <UserModulePermissionsFields
                  rows={editPermissions}
                  onChange={setEditPermissions}
                  isLoading={editPermissionsQuery.isLoading}
                />
              )}
            </div>
          )}
          <DialogFooter className="shrink-0">
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button
              onClick={() =>
                editUser &&
                updateRole.mutate({
                  roleId: editUser.roleId,
                  newRole: editRole,
                  userId: editUser.user_id,
                  newName: editName,
                  permissions: editPermissions,
                })
              }
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
