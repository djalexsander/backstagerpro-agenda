import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAutoBackup } from "@/hooks/useAutoBackup";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

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
                className={`p-3 border-b last:border-0 text-sm cursor-pointer hover:bg-muted/50 transition-colors ${!n.lida ? "bg-primary/5" : ""}`}
                onClick={() => !n.lida && markRead.mutate(n.id)}
              >
                <p className={`${!n.lida ? "font-medium" : "text-muted-foreground"}`}>{n.mensagem}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(n.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </p>
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

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b bg-card px-4 shrink-0">
            <SidebarTrigger className="mr-4" />
            <div className="flex items-center gap-2">
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
