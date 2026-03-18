import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Lock, Unlock, Eye, CreditCard, CalendarDays, Package, CheckCircle, FileCheck, CalendarIcon, Upload, X, ImageIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Empresas() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [detailEmpresa, setDetailEmpresa] = useState<any>(null);
  const [form, setForm] = useState({ nome_empresa: "", email: "", telefone: "", plano: "basico", status: "ativo", senha: "", papel: "admin_empresa" as string, vencimento: addMonths(new Date(), 1) as Date });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

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
      const { data, error } = await supabase.from("planos").select("*").eq("ativo", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: detailPagamentos = [] } = useQuery({
    queryKey: ["empresa-pagamentos", detailEmpresa?.id],
    queryFn: async () => {
      if (!detailEmpresa?.id) return [];
      const { data, error } = await supabase.from("pagamentos").select("*").eq("empresa_id", detailEmpresa.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!detailEmpresa?.id,
  });

  const uploadLogo = async (empresaId: string): Promise<string | null> => {
    if (!logoFile) return null;
    const ext = logoFile.name.split(".").pop();
    const path = `${empresaId}/logo.${ext}`;
    // Remove old logo if exists
    await supabase.storage.from("logos").remove([path]);
    const { error } = await supabase.storage.from("logos").upload(path, logoFile, { upsert: true });
    if (error) throw new Error("Erro ao fazer upload da logo: " + error.message);
    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    return data.publicUrl + "?t=" + Date.now();
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const plano = planos.find((p: any) => p.nome === form.plano);
      const trialDays = plano?.trial_days || 0;

      const payload: any = { nome_empresa: form.nome_empresa, email: form.email, telefone: form.telefone, plano: form.plano, status: form.status, vencimento: form.vencimento.toISOString() };

      if (!editItem) {
        const today = new Date();
        payload.data_contrato = format(today, "yyyy-MM-dd");
        payload.vencimento = form.vencimento.toISOString();
        payload.plano_bloqueado = false;

        if (trialDays > 0) {
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + trialDays);
          payload.trial_expires_at = expiresAt.toISOString();
        }

        if (plano) {
          payload.plano_id = plano.id;
        }
      }

      if (editItem) {
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
          if (plano) {
            payload.plano_id = plano.id;
          }
        }

        // Upload logo if provided
        if (logoFile) {
          payload.logo_url = await uploadLogo(editItem.id);
        }

        const { error } = await supabase.from("empresas").update(payload).eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { data: newEmpresa, error } = await supabase.from("empresas").insert(payload).select("id").single();
        if (error) throw error;

        // Upload logo after creating empresa
        if (logoFile) {
          const logoUrl = await uploadLogo(newEmpresa.id);
          if (logoUrl) {
            await supabase.from("empresas").update({ logo_url: logoUrl } as any).eq("id", newEmpresa.id);
          }
        }

        if (form.email && form.senha) {
          const res = await supabase.functions.invoke("create-empresa-user", {
            body: {
              empresa_id: newEmpresa.id,
              email: form.email,
              password: form.senha,
              full_name: form.nome_empresa,
              role: form.papel,
            },
          });
          if (res.error) throw new Error(res.error.message || "Erro ao criar usuário");
          if (res.data?.error) throw new Error(res.data.error);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-empresas"] });
      toast({ title: editItem ? "Empresa atualizada!" : "Empresa e usuário criados!" });
      setAddOpen(false);
      setEditItem(null);
      setLogoFile(null);
      setLogoPreview(null);
      setForm({ nome_empresa: "", email: "", telefone: "", plano: "basico", status: "ativo", senha: "", papel: "admin_empresa", vencimento: addMonths(new Date(), 1) });
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

  const marcarPago = useMutation({
    mutationFn: async (pagamento: any) => {
      // Mark payment as paid
      const { error } = await supabase.from("pagamentos").update({ status: "pago" } as any).eq("id", pagamento.id);
      if (error) throw error;

      // Renew empresa vencimento: extend by 1 month from current vencimento
      const empresa = empresas.find((e: any) => e.id === pagamento.empresa_id);
      if (empresa) {
        const currentVencimento = empresa.vencimento ? new Date(empresa.vencimento) : new Date();
        const baseDate = currentVencimento < new Date() ? new Date() : currentVencimento;
        const newVencimento = addMonths(baseDate, 1);
        
        await supabase.from("empresas").update({
          vencimento: newVencimento.toISOString(),
          plano_bloqueado: false,
          status_pagamento: "pago",
        } as any).eq("id", pagamento.empresa_id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresa-pagamentos"] });
      queryClient.invalidateQueries({ queryKey: ["master-empresas"] });
      toast({ title: "Pagamento confirmado e plano renovado!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deletePagamento = useMutation({
    mutationFn: async (pagamentoId: string) => {
      const { error } = await supabase.from("pagamentos").delete().eq("id", pagamentoId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresa-pagamentos"] });
      toast({ title: "Pagamento excluído!" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Máximo 2MB", variant: "destructive" });
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const removeLogo = useMutation({
    mutationFn: async (empresaId: string) => {
      await supabase.from("empresas").update({ logo_url: null } as any).eq("id", empresaId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-empresas"] });
      toast({ title: "Logo removida!" });
    },
  });

  const openEdit = (e: any) => {
    setEditItem(e);
    setLogoFile(null);
    setLogoPreview(e.logo_url || null);
    setForm({ nome_empresa: e.nome_empresa, email: e.email || "", telefone: e.telefone || "", plano: e.plano || "basico", status: e.status || "ativo", senha: "", papel: "admin_empresa", vencimento: e.vencimento ? new Date(e.vencimento) : addMonths(new Date(), 1) });
    setAddOpen(true);
  };

  const openAdd = () => {
    setEditItem(null);
    setLogoFile(null);
    setLogoPreview(null);
    setForm({ nome_empresa: "", email: "", telefone: "", plano: "basico", status: "ativo", senha: "", papel: "admin_empresa", vencimento: addMonths(new Date(), 1) });
    setAddOpen(true);
  };

  const isVencimentoExpired = (e: any) => {
    if (!e.vencimento) return false;
    return new Date(e.vencimento) < new Date();
  };

  const getPlanoInfo = (empresa: any) => {
    return planos.find((p: any) => p.nome === empresa?.plano || p.id === empresa?.plano_id);
  };

  const statusPagamento: Record<string, string> = {
    pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
    pago: "bg-accent text-accent-foreground",
    cancelado: "bg-destructive text-destructive-foreground",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Empresas</h1>
        <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Nova Empresa</Button>
      </div>

      {/* Form Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Editar Empresa" : "Nova Empresa"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Logo Upload */}
            <div className="space-y-2">
              <Label>Logo da Empresa</Label>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={handleLogoSelect}
              />
              <div className="flex items-center gap-3">
                {logoPreview ? (
                  <div className="relative h-16 w-16 rounded-lg border border-border overflow-hidden bg-muted">
                    <img src={logoPreview} alt="Preview" className="h-full w-full object-contain p-1" />
                    <button
                      type="button"
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                      onClick={() => { setLogoFile(null); setLogoPreview(null); }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="h-16 w-16 rounded-lg border border-dashed border-border flex items-center justify-center bg-muted/50">
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => logoInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-1" /> {logoPreview ? "Trocar" : "Upload"}
                  </Button>
                  <p className="text-[10px] text-muted-foreground">PNG, JPG ou SVG • Máx 2MB</p>
                </div>
                {editItem?.logo_url && !logoFile && logoPreview && (
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => { removeLogo.mutate(editItem.id); setLogoPreview(null); }}>
                    <Trash2 className="h-4 w-4 mr-1" /> Remover
                  </Button>
                )}
              </div>
            </div>

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
            {!editItem && (
              <div className="space-y-2">
                <Label>Senha de Acesso *</Label>
                <Input type="password" value={form.senha} onChange={(e) => setForm(p => ({ ...p, senha: e.target.value }))} placeholder="Mínimo 6 caracteres" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Plano</Label>
                <Select value={form.plano} onValueChange={(v) => setForm(p => ({ ...p, plano: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {planos.map((p: any) => (
                      <SelectItem key={p.nome} value={p.nome} className="capitalize">
                        {p.nome} — R$ {Number(p.valor).toFixed(2)}/mês
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Papel do Usuário</Label>
                <Select value={form.papel} onValueChange={(v) => setForm(p => ({ ...p, papel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin_empresa">Admin da Empresa</SelectItem>
                    <SelectItem value="usuario">Usuário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-2">
                <Label>Data de Vencimento</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !form.vencimento && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.vencimento ? format(form.vencimento, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.vencimento}
                      onSelect={(date) => date && setForm(p => ({ ...p, vencimento: date }))}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.nome_empresa || (!editItem && (!form.email || form.senha.length < 6))}>
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailEmpresa} onOpenChange={(o) => !o && setDetailEmpresa(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">{detailEmpresa?.nome_empresa}</DialogTitle>
          </DialogHeader>
          {detailEmpresa && (() => {
            const planoInfo = getPlanoInfo(detailEmpresa);
            const vencido = isVencimentoExpired(detailEmpresa);
            return (
              <div className="space-y-6">
                {/* Info da empresa */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Email:</span> <span className="font-medium">{detailEmpresa.email || "—"}</span></div>
                  <div><span className="text-muted-foreground">Telefone:</span> <span className="font-medium">{detailEmpresa.telefone || "—"}</span></div>
                  <div><span className="text-muted-foreground">Status:</span>{" "}
                    <Badge className={detailEmpresa.status === "ativo" ? "bg-accent text-accent-foreground" : "bg-destructive text-destructive-foreground"}>
                      {detailEmpresa.plano_bloqueado ? "Bloqueado" : detailEmpresa.status}
                    </Badge>
                  </div>
                  <div><span className="text-muted-foreground">Criado em:</span> <span className="font-medium">{format(new Date(detailEmpresa.created_at), "dd/MM/yyyy", { locale: ptBR })}</span></div>
                </div>

                <Separator />

                {/* Plano & Datas */}
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><Package className="h-4 w-4 text-primary" /> Plano & Contrato</h3>
                  <Card>
                    <CardContent className="pt-4">
                      {planoInfo ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground text-xs">Plano</p>
                            <p className="font-bold capitalize text-lg">{planoInfo.nome}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Valor</p>
                            <p className="font-bold text-lg">R$ {Number(planoInfo.valor).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Máx. Eventos</p>
                            <p className="font-bold">{planoInfo.max_eventos ?? "Ilimitado"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Máx. Usuários</p>
                            <p className="font-bold">{planoInfo.max_usuarios ?? "Ilimitado"}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">Plano: <span className="capitalize font-medium">{detailEmpresa.plano || "—"}</span></p>
                      )}

                      <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-muted-foreground text-xs">Data do Contrato</p>
                            <p className="font-medium">
                              {detailEmpresa.data_contrato
                                ? format(new Date(detailEmpresa.data_contrato + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })
                                : format(new Date(detailEmpresa.created_at), "dd/MM/yyyy", { locale: ptBR })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <CalendarDays className={`h-4 w-4 ${vencido ? "text-destructive" : "text-muted-foreground"}`} />
                          <div>
                            <p className="text-muted-foreground text-xs">Vencimento do Plano</p>
                            {detailEmpresa.vencimento ? (
                              <p className={`font-medium ${vencido ? "text-destructive" : ""}`}>
                                {format(new Date(detailEmpresa.vencimento), "dd/MM/yyyy", { locale: ptBR })}
                                {vencido && <span className="text-xs ml-1">(Vencido!)</span>}
                              </p>
                            ) : (
                              <p className="text-muted-foreground">—</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {detailEmpresa.trial_expires_at && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <div className="flex items-center gap-2 text-sm">
                            <CalendarDays className="h-4 w-4 text-muted-foreground" />
                            <span className={new Date(detailEmpresa.trial_expires_at) < new Date() ? "text-destructive font-semibold" : "text-muted-foreground"}>
                              Trial {new Date(detailEmpresa.trial_expires_at) < new Date() ? "expirado em" : "expira em"} {format(new Date(detailEmpresa.trial_expires_at), "dd/MM/yyyy", { locale: ptBR })}
                            </span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Separator />

                {/* Histórico de Pagamentos */}
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><CreditCard className="h-4 w-4 text-primary" /> Histórico de Pagamentos</h3>
                  {detailPagamentos.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Nenhum pagamento registrado.</p>
                  ) : (
                    <div className="rounded-lg border bg-card">
                      <Table>
                        <TableHeader>
                           <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Descrição</TableHead>
                            <TableHead>Valor</TableHead>
                            <TableHead>Método</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Comprovante</TableHead>
                            <TableHead className="text-right">Ação</TableHead>
                           </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detailPagamentos.map((p: any) => (
                            <TableRow key={p.id}>
                              <TableCell className="text-sm">{format(new Date(p.created_at), "dd/MM/yyyy", { locale: ptBR })}</TableCell>
                              <TableCell className="text-sm">{p.descricao || "—"}</TableCell>
                              <TableCell className="font-medium">R$ {Number(p.valor).toFixed(2)}</TableCell>
                              <TableCell className="text-sm uppercase">{p.metodo || "—"}</TableCell>
                              <TableCell>
                                <Badge className={`${statusPagamento[p.status] || "bg-muted text-muted-foreground"} capitalize`}>
                                  {p.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {p.comprovante_path ? (
                                  <Badge variant="outline" className="text-accent border-accent gap-1">
                                    <FileCheck className="h-3 w-3" /> Sim
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right space-x-1">
                                {p.comprovante_path && (
                                  <Button size="sm" variant="outline" className="text-primary border-primary hover:bg-primary/10" onClick={() => {
                                    const { data } = supabase.storage.from("comprovantes").getPublicUrl(p.comprovante_path);
                                    window.open(data.publicUrl, "_blank");
                                  }}>
                                    <FileCheck className="h-4 w-4 mr-1" /> Ver
                                  </Button>
                                )}
                                {p.status === "pendente" && (
                                  <Button size="sm" variant="outline" className="text-accent border-accent hover:bg-accent/10" onClick={() => marcarPago.mutate(p)} disabled={marcarPago.isPending}>
                                    <CheckCircle className="h-4 w-4 mr-1" /> Pago
                                  </Button>
                                )}
                                <Button size="sm" variant="outline" className="text-destructive border-destructive hover:bg-destructive/10" onClick={() => deletePagamento.mutate(p.id)} disabled={deletePagamento.isPending}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {empresas.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma empresa cadastrada.</TableCell></TableRow>
            ) : (
              empresas.map((e: any) => {
                const vencido = isVencimentoExpired(e);
                const blocked = e.plano_bloqueado;
                return (
                  <TableRow key={e.id} className={`${blocked ? "opacity-60" : ""} cursor-pointer hover:bg-muted/50`} onClick={() => setDetailEmpresa(e)}>
                    <TableCell className="font-medium">{e.nome_empresa}</TableCell>
                    <TableCell>{e.email || "—"}</TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{e.plano}</Badge></TableCell>
                    <TableCell>
                      {e.vencimento ? (
                        <span className={`text-xs ${vencido ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                          {vencido ? "Vencido " : ""}{format(new Date(e.vencimento), "dd/MM/yyyy", { locale: ptBR })}
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
                    <TableCell className="text-right space-x-1" onClick={(ev) => ev.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => setDetailEmpresa(e)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {!blocked && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => toggleBlock.mutate({ id: e.id, blocked: true })}>
                          <Lock className="h-4 w-4" />
                        </Button>
                      )}
                      {blocked && (
                        <Button variant="ghost" size="sm" className="text-accent" onClick={() => toggleBlock.mutate({ id: e.id, blocked: false })}>
                          <Unlock className="h-4 w-4" />
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
