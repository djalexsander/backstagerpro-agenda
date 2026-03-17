import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Bell, Calendar, AlertTriangle, Clock, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { format, parseISO, differenceInDays, startOfToday, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";

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
        .select("trial_expires_at, vencimento, plano, plano_bloqueado, status_pagamento")
        .eq("id", empresaId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
    refetchInterval: 10 * 60 * 1000,
  });

  const alertas = useMemo<Alerta[]>(() => {
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

    // Plan/trial alerts
    if (empresa) {
      if (empresa.trial_expires_at) {
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

      if (empresa.vencimento) {
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

  const urgentCount = alertas.filter(
    (a) => a.tipo === "evento_hoje" || a.tipo === "plano_vencido" || a.tipo === "trial_expirando" || a.tipo === "plano_vencendo"
  ).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {urgentCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold animate-pulse">
              {urgentCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <p className="font-semibold text-sm">Alertas & Notificações</p>
          <Badge variant="outline" className="text-xs">{alertas.length}</Badge>
        </div>
        <div className="max-h-80 overflow-auto">
          {alertas.length === 0 ? (
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
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{alerta.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{alerta.descricao}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
