import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAutoBackup } from "@/hooks/useAutoBackup";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NotificacoesEmpresa } from "@/components/NotificacoesEmpresa";
import { Bell, Eye, X, Check, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

function NotificacoesMaster() {
  const queryClient = useQueryClient();

  const { data: notificacoes = [] } = useQuery({
    queryKey: ["notificacoes-master"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notificacoes_master")
        .select("*, empresas(nome_empresa)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notificacoes_master").update({ lida: true }).eq("id", id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notificacoes-master"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await supabase.from("notificacoes_master").update({ lida: true }).eq("lida", false);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notificacoes-master"] }),
  });

  const deleteNotification = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notificacoes_master").delete().eq("id", id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notificacoes-master"] }),
  });

  const handleUpgradeAction = useMutation({
    mutationFn: async ({ notif, accepted }: { notif: any; accepted: boolean }) => {
      const empresaId = notif.empresa_id;

      if (accepted) {
        const planoId = notif.dados?.plano_id_solicitado;
        const planoNome = notif.dados?.plano_solicitado;

        if (planoId) {
          const { error } = await supabase
            .from("empresas")
            .update({ plano_id: planoId, plano: planoNome })
            .eq("id", empresaId);
          if (error) throw error;
        }
      }

      // Mark notification as read
      await supabase
        .from("notificacoes_master")
        .update({ lida: true })
        .eq("id", notif.id);
    },
    onSuccess: (_, { accepted }) => {
      queryClient.invalidateQueries({ queryKey: ["notificacoes-master"] });
      queryClient.invalidateQueries({ queryKey: ["master-empresas"] });
      queryClient.invalidateQueries({ queryKey: ["empresa-plano"] });
      queryClient.invalidateQueries({ queryKey: ["plano-atual"] });
      toast.success(accepted ? "Upgrade aceito! Plano da empresa atualizado." : "Solicitação rejeitada.");
    },
    onError: () => toast.error("Erro ao processar solicitação."),
  });
  });

  const unreadCount = notificacoes.filter((n: any) => !n.lida).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-bold">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <p className="font-semibold text-sm">Notificações</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => markAllRead.mutate()}>
              Marcar todas como lidas
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-auto">
          {notificacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhuma notificação</p>
          ) : (
            notificacoes.map((n: any) => (
              <div
                key={n.id}
                className={`relative p-3 border-b last:border-0 text-sm hover:bg-muted/50 transition-colors ${!n.lida ? "bg-primary/5" : ""}`}
                onClick={() => !n.lida && markRead.mutate(n.id)}
              >
                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNotification.mutate(n.id);
                  }}
                  className="absolute top-2 right-2 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Excluir"
                >
                  <X className="h-3.5 w-3.5" />
                </button>

                <p className={`pr-6 ${!n.lida ? "font-medium" : "text-muted-foreground"}`}>{n.mensagem}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(n.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </p>

                {/* Upgrade accept/reject buttons */}
                {n.tipo === "upgrade_plano" && !n.lida && (
                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="default"
                      size="sm"
                      className="text-xs h-7 flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpgradeAction.mutate({ notif: n, accepted: true });
                      }}
                    >
                      <Check className="h-3 w-3 mr-1" /> Aceitar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="text-xs h-7 flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpgradeAction.mutate({ notif: n, accepted: false });
                      }}
                    >
                      <XCircle className="h-3 w-3 mr-1" /> Rejeitar
                    </Button>
                  </div>
                )}

                {/* View receipt button */}
                {n.tipo === "comprovante_pagamento" && n.dados?.comprovante_path && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      const { data } = supabase.storage.from("comprovantes").getPublicUrl(n.dados.comprovante_path);
                      window.open(data.publicUrl, "_blank");
                    }}
                  >
                    <Eye className="h-3 w-3 mr-1" /> Ver Comprovante
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AppLayout() {
  const { isMasterAdmin } = useAuth();
  useAutoBackup();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b bg-card px-4 shrink-0">
            <SidebarTrigger className="mr-4" />
            <div className="flex items-center gap-2">
              {!isMasterAdmin && <NotificacoesEmpresa />}
              {isMasterAdmin && <NotificacoesMaster />}
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
