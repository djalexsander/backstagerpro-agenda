import { useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Bell, BellOff, BellRing, Calendar, AlertTriangle, Check, Clock, CreditCard, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { format, parseISO, differenceInDays, startOfToday, addDays, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import {
  listMinhasNotificacoes,
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
  type MinhaNotificacao,
} from "@/lib/push-notifications-service";

interface Alerta {
  id: string;
  tipo: "evento_proximo" | "evento_hoje" | "plano_vencendo" | "plano_vencido" | "trial_expirando";
  titulo: string;
  descricao: string;
  icone: typeof Calendar;
  cor: string;
  acao?: () => void;
}

export function NotificacoesEmpresa() {
  const { empresaId } = useAuth();
  const navigate = useNavigate();
  const today = startOfToday();

  const { data: events = [] } = useQuery({
    queryKey: ["events-alertas", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date, status, city, venue")
        .eq("empresa_id", empresaId)
        .gte("date", format(today, "yyyy-MM-dd"))
        .lte("date", format(addDays(today, 7), "yyyy-MM-dd"))
        .order("date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
    refetchInterval: 5 * 60 * 1000, // 5min
  });

  const { data: empresa } = useQuery({
    queryKey: ["empresa-alertas", empresaId],
    queryFn: async () => {
      if (!empresaId) return null;
      const { data, error } = await supabase
        .from("empresas")
        .select("trial_expires_at, vencimento, plano, plano_bloqueado, status_pagamento, plano_id")
        .eq("id", empresaId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
    refetchInterval: 10 * 60 * 1000,
  });

  const queryClient = useQueryClient();
  const push = usePushNotifications(empresaId);

  const { data: notificacoes = [] } = useQuery({
    queryKey: ["minhas-notificacoes", empresaId],
    queryFn: () => listMinhasNotificacoes({ limite: 20 }),
    enabled: !!empresaId,
    refetchInterval: 2 * 60 * 1000,
  });

  const marcarLidaMutation = useMutation({
    mutationFn: marcarNotificacaoLida,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["minhas-notificacoes", empresaId] }),
  });
  const marcarTodasLidasMutation = useMutation({
    mutationFn: marcarTodasNotificacoesLidas,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["minhas-notificacoes", empresaId] }),
  });

  const handleNotificacaoClick = useCallback(
    (notificacao: MinhaNotificacao) => {
      if (!notificacao.lida) marcarLidaMutation.mutate(notificacao.destinatarioId);
      if (notificacao.rota) navigate(notificacao.rota);
    },
    [marcarLidaMutation, navigate],
  );

  const unreadCount = notificacoes.filter((n) => !n.lida).length;

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const handleDismiss = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  const allAlertas = useMemo<Alerta[]>(() => {
    const list: Alerta[] = [];

    // Event alerts
    events.forEach((event) => {
      const eventDate = parseISO(event.date);
      const dias = differenceInDays(eventDate, today);

      if (dias === 0) {
        list.push({
          id: `evento-hoje-${event.id}`,
          tipo: "evento_hoje",
          titulo: "Evento HOJE!",
          descricao: `${event.name} — ${event.city}`,
          icone: Clock,
          cor: "text-primary",
          acao: () => navigate(`/evento/${event.id}`),
        });
      } else if (dias <= 3) {
        list.push({
          id: `evento-proximo-${event.id}`,
          tipo: "evento_proximo",
          titulo: `Evento em ${dias} dia${dias > 1 ? "s" : ""}`,
          descricao: `${event.name} — ${format(eventDate, "dd/MM", { locale: ptBR })} — ${event.city}`,
          icone: Calendar,
          cor: "text-[hsl(var(--warning))]",
          acao: () => navigate(`/evento/${event.id}`),
        });
      } else {
        list.push({
          id: `evento-semana-${event.id}`,
          tipo: "evento_proximo",
          titulo: `Evento em ${dias} dias`,
          descricao: `${event.name} — ${format(eventDate, "dd/MM", { locale: ptBR })}`,
          icone: Calendar,
          cor: "text-muted-foreground",
          acao: () => navigate(`/evento/${event.id}`),
        });
      }
    });

    // Plan/trial alerts — only show trial alerts if no plan is assigned yet
    if (empresa) {
      const hasActivePlan = !!empresa.plano_id;

      if (empresa.trial_expires_at && !hasActivePlan) {
        const trialEnd = new Date(empresa.trial_expires_at);
        const diasTrial = differenceInDays(trialEnd, today);
        if (diasTrial < 0) {
          list.unshift({
            id: "trial-expirado",
            tipo: "plano_vencido",
            titulo: "Trial expirado!",
            descricao: "Seu período de teste acabou. Assine um plano para continuar.",
            icone: AlertTriangle,
            cor: "text-destructive",
            acao: () => navigate("/plano"),
          });
        } else if (diasTrial <= 5) {
          list.unshift({
            id: "trial-expirando",
            tipo: "trial_expirando",
            titulo: `Trial expira em ${diasTrial} dia${diasTrial !== 1 ? "s" : ""}`,
            descricao: "Assine um plano para não perder acesso.",
            icone: AlertTriangle,
            cor: "text-[hsl(var(--warning))]",
            acao: () => navigate("/plano"),
          });
        }
      }

      // Only show vencimento alerts if payment status is not 'pago'
      const isPago = empresa.status_pagamento === "pago";
      if (empresa.vencimento && !isPago) {
        const venc = new Date(empresa.vencimento);
        const diasVenc = differenceInDays(venc, today);
        if (diasVenc < 0) {
          list.unshift({
            id: "plano-vencido",
            tipo: "plano_vencido",
            titulo: "Plano vencido!",
            descricao: "Seu plano expirou. Realize o pagamento para evitar o bloqueio.",
            icone: CreditCard,
            cor: "text-destructive",
            acao: () => navigate("/plano"),
          });
        } else if (diasVenc <= 7) {
          list.unshift({
            id: "plano-vencendo",
            tipo: "plano_vencendo",
            titulo: `Plano vence em ${diasVenc} dia${diasVenc !== 1 ? "s" : ""}`,
            descricao: `Vencimento em ${format(venc, "dd/MM/yyyy", { locale: ptBR })}. Renove para evitar bloqueio.`,
            icone: CreditCard,
            cor: "text-[hsl(var(--warning))]",
            acao: () => navigate("/plano"),
          });
        }
      }

      // Bloqueio alert
      if (empresa.plano_bloqueado) {
        list.unshift({
          id: "empresa-bloqueada",
          tipo: "plano_vencido",
          titulo: "Empresa Bloqueada!",
          descricao: "Sua empresa foi bloqueada por falta de pagamento. Regularize para continuar.",
          icone: AlertTriangle,
          cor: "text-destructive",
          acao: () => navigate("/plano"),
        });
      }
    }

    return list;
  }, [events, empresa, today, navigate]);

  const alertas = allAlertas.filter((a) => !dismissed.has(a.id));

  const urgentCount = alertas.filter(
    (a) => a.tipo === "evento_hoje" || a.tipo === "plano_vencido" || a.tipo === "trial_expirando" || a.tipo === "plano_vencendo"
  ).length;

  const badgeCount = urgentCount + unreadCount;

  const pushIcon = push.isLoading ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : push.state === "subscribed" ? (
    <BellRing className="h-4 w-4" />
  ) : (
    <BellOff className="h-4 w-4" />
  );
  const pushTitle =
    push.state === "denied"
      ? "Notificações bloqueadas no navegador"
      : push.state === "subscribed"
        ? "Desativar notificações push neste dispositivo"
        : "Ativar notificações push neste dispositivo";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {badgeCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold animate-pulse">
              {badgeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b gap-2">
          <p className="font-semibold text-sm">Alertas & Notificações</p>
          <div className="flex items-center gap-1 shrink-0">
            {unreadCount > 0 && (
              <button
                onClick={() => marcarTodasLidasMutation.mutate()}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors mr-1"
                title="Marcar todas como lidas"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            )}
            {push.state !== "unsupported" && (
              <button
                onClick={() => (push.state === "subscribed" ? push.unsubscribe() : push.subscribe())}
                disabled={push.isLoading || push.state === "denied"}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                title={pushTitle}
              >
                {pushIcon}
              </button>
            )}
          </div>
        </div>
        <div className="max-h-96 overflow-auto">
          {notificacoes.map((notificacao) => (
            <div
              key={notificacao.destinatarioId}
              className={`flex items-start gap-3 p-3 border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer ${notificacao.lida ? "" : "bg-muted/30"}`}
              onClick={() => handleNotificacaoClick(notificacao)}
            >
              <div className={`mt-0.5 shrink-0 ${notificacao.categoria === "financeiro" ? "text-[hsl(var(--warning))]" : "text-primary"}`}>
                {notificacao.categoria === "financeiro" ? <CreditCard className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm leading-tight ${notificacao.lida ? "font-medium" : "font-semibold"}`}>{notificacao.titulo}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{notificacao.mensagem}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                  {formatDistanceToNow(parseISO(notificacao.createdAt), { addSuffix: true, locale: ptBR })}
                </p>
              </div>
              {!notificacao.lida && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
            </div>
          ))}
          {alertas.length === 0 && notificacoes.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Bell className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Tudo tranquilo! Nenhum alerta no momento.</p>
            </div>
          ) : (
            alertas.map((alerta) => {
              const Icon = alerta.icone;
              return (
                <div
                  key={alerta.id}
                  className="flex items-start gap-3 p-3 border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={alerta.acao}
                >
                  <div className={`mt-0.5 shrink-0 ${alerta.cor}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight">{alerta.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{alerta.descricao}</p>
                  </div>
                  <button
                    onClick={(e) => handleDismiss(alerta.id, e)}
                    className="shrink-0 mt-0.5 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Dispensar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
