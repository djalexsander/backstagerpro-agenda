import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Shield, User, Plus, Pencil } from "lucide-react";

export default function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);

  // Add user form
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<string>("user");

  // Edit form
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<string>("user");

  const { data: users = [] } = useQuery({
    queryKey: ["users-management"],
    queryFn: async () => {
      const { data: profiles, error: pErr } = await supabase.from("profiles").select("*");
      if (pErr) throw pErr;
      const { data: roles, error: rErr } = await supabase.from("user_roles").select("*");
      if (rErr) throw rErr;
      return profiles.map((p) => ({
        ...p,
        role: roles.find((r) => r.user_id === p.user_id)?.role || "user",
        roleId: roles.find((r) => r.user_id === p.user_id)?.id,
      }));
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ roleId, newRole, userId, newName }: { roleId: string; newRole: string; userId: string; newName: string }) => {
      const [roleRes, profileRes] = await Promise.all([
        supabase.from("user_roles").update({ role: newRole as any }).eq("id", roleId),
        supabase.from("profiles").update({ full_name: newName }).eq("user_id", userId),
      ]);
      if (roleRes.error) throw roleRes.error;
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
        options: { data: { full_name: newName } },
      });
      if (error) throw error;
      // Wait briefly for the trigger to create profile/role, then update role if admin
      if (data.user && newRole === "admin") {
        // Small delay to let the trigger fire
        await new Promise((r) => setTimeout(r, 1500));
        const { data: roleRow } = await supabase.from("user_roles").select("id").eq("user_id", data.user.id).single();
        if (roleRow) {
          await supabase.from("user_roles").update({ role: "admin" as any }).eq("id", roleRow.id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-management"] });
      toast({ title: "Usuário criado com sucesso!" });
      setAddOpen(false);
      setNewEmail("");
      setNewPassword("");
      setNewName("");
      setNewRole("user");
    },
    onError: (err: any) => toast({ title: "Erro ao criar usuário", description: err.message, variant: "destructive" }),
  });

  const openEdit = (u: any) => {
    setEditUser(u);
    setEditName(u.full_name);
    setEditRole(u.role);
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
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="user">Usuário</SelectItem>
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

      {/* Edit dialog */}
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
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="user">Usuário</SelectItem>
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
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <p className="font-medium">{u.full_name}</p>
                </TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"} className="gap-1">
                    {u.role === "admin" ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    {u.role === "admin" ? "Admin" : "Usuário"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                    <Pencil className="h-4 w-4 mr-1" /> Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
