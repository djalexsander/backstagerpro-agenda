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
import { Plus, Pencil, Trash2, Lock, Unlock, Eye, CreditCard, CalendarDays, Package, CheckCircle, FileCheck, CalendarIcon, Upload, X, ImageIcon, Sparkles, AlertTriangle, Layers } from "lucide-react";
import { EmpresaModulesManager } from "@/components/master/EmpresaModulesManager";
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
  const [form, setForm] = useState({ nome_empresa: "", email: "", telefone: "", plano: "basico", status: "ativo", papel: "admin_empresa" as string, vencimento: addMonths(new Date(), 1) as Date | null });
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

  // Module counts per empresa
  const { data: moduleCounts = {} } = useQuery({
    queryKey: ["master-empresas-module-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_modules")
        .select("empresa_id, status");
      if (error) throw error;
      const counts: Record<string, { active: number; pending: number; total: number }> = {};
      (data || []).forEach((m: any) => {
        if (!counts[m.empresa_id]) counts[m.empresa_id] = { active: 0, pending: 0, total: 0 };
        counts[m.empresa_id].total++;
        if (m.status === "active") counts[m.empresa_id].active++;
        if (m.status === "pending") counts[m.empresa_id].pending++;
      });
      return counts;
    },
  });

  // All planos (including inactive) for legacy detection
  const { data: allPlanos = [] } = useQuery({
    queryKey: ["master-all-planos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos").select("id, nome, disponivel_novo_cadastro, periodicidade, valor");
      if (error) throw error;
      return data;
    },
  });

  const classifyEmpresaModel = (empresa: any): "novo" | "legado" | "onboarding" => {
    if (empresa.precisa_escolher_plano) return "onboarding";
    if (!empresa.plano_id) {
      // Trial or no plan = new model
      return empresa.trial_expires_at ? "novo" : "novo";
    }
    const plano = allPlanos.find((p: any) => p.id === empresa.plano_id);
    if (!plano) return "novo";
    return plano.disponivel_novo_cadastro === false ? "legado" : "novo";
  };

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

      const selectedPlano = planos.find((p: any) => p.nome === form.plano);
      const isVitalicio = selectedPlano?.periodicidade === "vitalicio";
      const payload: any = { nome_empresa: form.nome_empresa, email: form.email, telefone: form.telefone, plano: form.plano, status: form.status, vencimento: isVitalicio ? null : (form.vencimento ? form.vencimento.toISOString() : null) };

      if (!editItem) {
        const today = new Date();
        payload.data_contrato = format(today, "yyyy-MM-dd");
        payload.vencimento = isVitalicio ? null : (form.vencimento ? form.vencimento.toISOString() : null);
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

        if (form.email) {
          const res = await supabase.functions.invoke("create-empresa-user", {
            body: {
              empresa_id: newEmpresa.id,
              email: form.email,
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
      setForm({ nome_empresa: "", email: "", telefone: "", plano: "basico", status: "ativo", papel: "admin_empresa", vencimento: addMonths(new Date(), 1) });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Get all event IDs for this empresa
      const { data: events } = await supabase.from("events").select("id").eq("empresa_id", id);
      const eventIds = (events || []).map((e: any) => e.id);

      // Delete related data in correct order (FK constraints)
      if (eventIds.length > 0) {
        await supabase.from("event_funcionarios").delete().in("event_id", eventIds);
        await supabase.from("event_files").delete().in("event_id", eventIds);
        await supabase.from("event_days").delete().in("event_id", eventIds);
        await supabase.from("financials").delete().in("event_id", eventIds);
      }
      await supabase.from("events").delete().eq("empresa_id", id);
      await supabase.from("funcionarios").delete().eq("empresa_id", id);
      await supabase.from("backups").delete().eq("empresa_id", id);
      await supabase.from("generated_documents").delete().eq("empresa_id", id);
      await supabase.from("document_templates").delete().eq("empresa_id", id);
      await supabase.from("pagamentos").delete().eq("empresa_id", id);
      await supabase.from("notificacoes_master").delete().eq("empresa_id", id);
      await supabase.from("system_logs").delete().eq("empresa_id", id);

      // Delete profiles and user_roles for users of this empresa
      const { data: profiles } = await supabase.from("profiles").select("user_id").eq("empresa_id", id);
      const userIds = (profiles || []).map((p: any) => p.user_id);
      if (userIds.length > 0) {
        await supabase.from("user_roles").delete().in("user_id", userIds);
        await supabase.from("profiles").delete().eq("empresa_id", id);
        // Delete auth users via edge function
        for (const uid of userIds) {
          await supabase.functions.invoke("delete-user", { body: { user_id: uid } });
        }
      }

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

      // Renew empresa vencimento: extend by 1 month from current vencimento (skip for vitalicio)
      const empresa = empresas.find((e: any) => e.id === pagamento.empresa_id);
      if (empresa) {
        const planoInfo = planos.find((p: any) => p.nome === empresa.plano || p.id === empresa.plano_id);
        const isVitalicio = planoInfo?.periodicidade === "vitalicio";
        
        const updatePayload: any = {
          plano_bloqueado: false,
          status_pagamento: "pago",
        };

        if (!isVitalicio) {
          const currentVencimento = empresa.vencimento ? new Date(empresa.vencimento) : new Date();
          const baseDate = currentVencimento < new Date() ? new Date() : currentVencimento;
          updatePayload.vencimento = addMonths(baseDate, 1).toISOString();
        } else {
          updatePayload.vencimento = null;
        }
        
        await supabase.from("empresas").update(updatePayload).eq("id", pagamento.empresa_id);
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
    const planoInfo = planos.find((p: any) => p.nome === e.plano || p.id === e.plano_id);
    const isVitalicio = planoInfo?.periodicidade === "vitalicio";
    setForm({ nome_empresa: e.nome_empresa, email: e.email || "", telefone: e.telefone || "", plano: e.plano || "basico", status: e.status || "ativo", papel: "admin_empresa", vencimento: isVitalicio ? null : (e.vencimento ? new Date(e.vencimento) : addMonths(new Date(), 1)) });
    setAddOpen(true);
  };

  const openAdd = () => {
    setEditItem(null);
    setLogoFile(null);
    setLogoPreview(null);
    setForm({ nome_empresa: "", email: "", telefone: "", plano: "basico", status: "ativo", papel: "admin_empresa", vencimento: addMonths(new Date(), 1) });
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Plano</Label>
                <Select value={form.plano} onValueChange={(v) => {
                  const selectedPlano = planos.find((p: any) => p.nome === v);
                  const isVitalicio = selectedPlano?.periodicidade === "vitalicio";
                  setForm(p => ({ ...p, plano: v, vencimento: isVitalicio ? null : p.vencimento || addMonths(new Date(), 1) }));
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {planos.map((p: any) => {
                      const sufixo = p.periodicidade === "vitalicio" ? "" : p.periodicidade === "anual" ? "/ano" : "/mês";
                      return (
                        <SelectItem key={p.nome} value={p.nome} className="capitalize">
                          {p.nome} — R$ {Number(p.valor).toFixed(2)}{sufixo}
                        </SelectItem>
                      );
                    })}
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
              {(() => {
                const selectedPlano = planos.find((p: any) => p.nome === form.plano);
                const isVitalicio = selectedPlano?.periodicidade === "vitalicio";
                if (isVitalicio) return (
                  <div className="space-y-2">
                    <Label>Data de Vencimento</Label>
                    <p className="text-sm text-muted-foreground pt-2">Plano vitalício não possui vencimento</p>
                  </div>
                );
                return (
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
                          selected={form.vencimento ?? undefined}
                          onSelect={(date) => date && setForm(p => ({ ...p, vencimento: date }))}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.nome_empresa || (!editItem && !form.email)}>
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailEmpresa} onOpenChange={(o) => !o && setDetailEmpresa(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <DialogTitle className="text-xl">{detailEmpresa?.nome_empresa}</DialogTitle>
              {detailEmpresa && (() => {
                const modelo = classifyEmpresaModel(detailEmpresa);
                return modelo === "novo" ? (
                  <Badge className="bg-primary/15 text-primary border border-primary/30 text-xs"><Sparkles className="h-3 w-3 mr-0.5" /> Modelo Novo</Badge>
                ) : modelo === "onboarding" ? (
                  <Badge className="bg-amber-500/15 text-amber-700 border border-amber-500/30 text-xs">Onboarding</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-xs"><AlertTriangle className="h-3 w-3 mr-0.5" /> Modelo Legado</Badge>
                );
              })()}
            </div>
          </DialogHeader>
          {detailEmpresa && (() => {
            const planoInfo = getPlanoInfo(detailEmpresa);
            const vencido = isVencimentoExpired(detailEmpresa);
            const mods = moduleCounts[detailEmpresa.id];
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
                    {detailEmpresa.status_pagamento === "pendente" && (
                      <Badge className="bg-amber-500/15 text-amber-700 border border-amber-500/30 ml-1 text-[10px]">Pgto Pendente</Badge>
                    )}
                  </div>
                  <div><span className="text-muted-foreground">Criado em:</span> <span className="font-medium">{format(new Date(detailEmpresa.created_at), "dd/MM/yyyy", { locale: ptBR })}</span></div>
                  {mods && mods.total > 0 && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Módulos:</span>{" "}
                      <span className="font-medium">{mods.active} ativo{mods.active !== 1 ? "s" : ""}</span>
                      {mods.pending > 0 && <span className="text-amber-600 ml-1">• {mods.pending} pendente{mods.pending !== 1 ? "s" : ""}</span>}
                    </div>
                  )}
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
                            {planoInfo?.periodicidade === "vitalicio" ? (
                              <p className="font-medium text-accent">Vitalício</p>
                            ) : detailEmpresa.vencimento ? (
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

                {/* Módulos da empresa */}
                <EmpresaModulesManager empresaId={detailEmpresa.id} empresaNome={detailEmpresa.nome_empresa} />

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
                                  <Button size="sm" variant="outline" className="text-primary border-primary hover:bg-primary/10" onClick={async () => {
                                    const { data } = await supabase.storage.from("comprovantes").createSignedUrl(p.comprovante_path, 3600);
                                    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
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
              <TableHead>Modelo</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Módulos</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {empresas.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhuma empresa cadastrada.</TableCell></TableRow>
            ) : (
              empresas.map((e: any) => {
                const vencido = isVencimentoExpired(e);
                const blocked = e.plano_bloqueado;
                const modelo = classifyEmpresaModel(e);
                const mods = moduleCounts[e.id];
                return (
                  <TableRow key={e.id} className={`${blocked ? "opacity-60" : ""} cursor-pointer hover:bg-muted/50`} onClick={() => setDetailEmpresa(e)}>
                    <TableCell className="font-medium">{e.nome_empresa}</TableCell>
                    <TableCell className="text-sm">{e.email || "—"}</TableCell>
                    <TableCell>
                      {modelo === "novo" && (
                        <Badge className="bg-primary/15 text-primary border border-primary/30 text-[10px]">
                          <Sparkles className="h-3 w-3 mr-0.5" /> Novo
                        </Badge>
                      )}
                      {modelo === "onboarding" && (
                        <Badge className="bg-amber-500/15 text-amber-700 border border-amber-500/30 text-[10px]">
                          Onboarding
                        </Badge>
                      )}
                      {modelo === "legado" && (
                        <Badge variant="outline" className="text-muted-foreground text-[10px]">
                          <AlertTriangle className="h-3 w-3 mr-0.5" /> Legado
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Badge variant="secondary" className="capitalize text-xs w-fit">{e.plano || "—"}</Badge>
                        {e.trial_expires_at && (
                          <span className={`text-[10px] ${new Date(e.trial_expires_at) < new Date() ? "text-destructive" : "text-primary"}`}>
                            Trial {new Date(e.trial_expires_at) < new Date() ? "expirado" : "ativo"}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {mods ? (
                        <div className="flex items-center gap-1">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium">{mods.total}</span>
                          {mods.pending > 0 && (
                            <Badge className="bg-amber-500/15 text-amber-700 text-[10px] px-1 py-0">{mods.pending} pend.</Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const planoInfo = planos.find((p: any) => p.nome === e.plano || p.id === e.plano_id);
                        if (planoInfo?.periodicidade === "vitalicio") return <span className="text-xs font-medium text-accent">Vitalício</span>;
                        return e.vencimento ? (
                          <span className={`text-xs ${vencido ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                            {vencido ? "Vencido " : ""}{format(new Date(e.vencimento), "dd/MM/yyyy", { locale: ptBR })}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {blocked ? (
                        <Badge className="bg-destructive text-destructive-foreground">Bloqueado</Badge>
                      ) : e.status_pagamento === "pendente" ? (
                        <Badge className="bg-amber-500/15 text-amber-700 border border-amber-500/30">Pgto Pendente</Badge>
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
