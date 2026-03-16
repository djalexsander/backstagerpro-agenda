import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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

export default function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { empresaId, isMasterAdmin, user } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteUser, setDeleteUser] = useState<any>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<string>("usuario");

  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<string>("usuario");

  const { data: users = [] } = useQuery({
    queryKey: ["users-management", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data: profiles, error: pErr } = await supabase.from("profiles").select("*").eq("empresa_id", empresaId);
      if (pErr) throw pErr;
      const userIds = profiles.map((p: any) => p.user_id);
      if (userIds.length === 0) return [];
      const { data: roles, error: rErr } = await supabase.from("user_roles").select("*").in("user_id", userIds);
      if (rErr) throw rErr;
      // Filter out master_admin users
      return profiles
        .map((p: any) => ({
          ...p,
          role: roles.find((r: any) => r.user_id === p.user_id)?.role || "usuario",
          roleId: roles.find((r: any) => r.user_id === p.user_id)?.id,
        }))
        .filter((u: any) => u.role !== "master_admin");
    },
    enabled: !!empresaId,
  });

  const updateRole = useMutation({
    mutationFn: async ({ roleId, newRole, userId, newName }: { roleId: string; newRole: string; userId: string; newName: string }) => {
      const roleRes = await supabase.from("user_roles").update({ role: newRole as any }).eq("id", roleId);
      if (roleRes.error) throw roleRes.error;
      const profileRes = await supabase.from("profiles").update({ full_name: newName } as any).eq("user_id", userId);
      if (profileRes.error) throw profileRes.error;
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
      const { data, error } = await supabase.auth.signUp({
        email: newEmail,
        password: newPassword,
        options: {
          data: {
            full_name: newName,
            empresa_id: empresaId,
            role: newRole,
          },
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-management"] });
      toast({ title: "Usuário criado com sucesso!" });
      setAddOpen(false);
      setNewEmail(""); setNewPassword(""); setNewName(""); setNewRole("usuario");
    },
    onError: (err: any) => toast({ title: "Erro ao criar usuário", description: err.message, variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { user_id: userId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-management"] });
      toast({ title: "Usuário excluído com sucesso!" });
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
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Usuário</Button>
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
              <div className="space-y-2">
                <Label>Senha</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
              </div>
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
              <Button onClick={() => addUser.mutate()} disabled={addUser.isPending || !newEmail || !newPassword || !newName}>
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
              onClick={() => editUser?.roleId && updateRole.mutate({ roleId: editUser.roleId, newRole: editRole, userId: editUser.user_id, newName: editName })}
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
              Tem certeza que deseja excluir <strong>{deleteUser?.full_name}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteUser && deleteUserMutation.mutate(deleteUser.user_id)}
              disabled={deleteUserMutation.isPending}
            >
              {deleteUserMutation.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u: any) => (
              <TableRow key={u.id}>
                <TableCell><p className="font-medium">{u.full_name}</p></TableCell>
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
