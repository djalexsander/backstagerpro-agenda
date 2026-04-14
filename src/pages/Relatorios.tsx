import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, DollarSign, Calendar, FileText, Image,
  ArrowRight, BarChart3, Users, ClipboardList, UserCheck, Music
} from "lucide-react";
import { useModuleAccess } from "@/components/ModuleGate";
import { MODULE_KEYS } from "@/constants/module-keys";
import { exportAgendaPDF } from "@/lib/pdf-export";

import { useAuth } from "@/contexts/AuthContext";

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  available: boolean;
  navigateTo?: string;
  comingSoon?: boolean;
}

export default function Relatorios() {
  const navigate = useNavigate();
  const { canAccess } = useModuleAccess(MODULE_KEYS.RELATORIOS);
  const { empresaNome } = useAuth();

  const reports: ReportCard[] = [
    {
      id: "dashboard",
      title: "Relatório do Dashboard",
      description: "Visão geral com indicadores, gráficos de status e tendências de eventos.",
      icon: LayoutDashboard,
      available: true,
      navigateTo: "/dashboard",
    },
    {
      id: "financeiro",
      title: "Relatório Financeiro",
      description: "Resumo de receitas, despesas e métricas financeiras dos eventos.",
      icon: DollarSign,
      available: true,
      navigateTo: "/financeiro",
    },
    {
      id: "agenda",
      title: "Relatório da Agenda",
      description: "Lista completa dos eventos com datas, locais e status atualizados.",
      icon: Calendar,
      available: true,
      navigateTo: "/agenda",
    },
    {
      id: "equipe",
      title: "Relatório de Equipe",
      description: "Análise da equipe com frequência em eventos e cachês acumulados.",
      icon: Users,
      available: false,
      comingSoon: true,
    },
    {
      id: "operacional",
      title: "Relatório Operacional",
      description: "Painel operacional com logística, materiais e preparação de eventos.",
      icon: ClipboardList,
      available: false,
      comingSoon: true,
    },
    {
      id: "evento",
      title: "Relatório por Evento",
      description: "Relatório detalhado individual de cada evento com todos os dados.",
      icon: Music,
      available: false,
      comingSoon: true,
    },
  ];

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <BarChart3 className="h-16 w-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold text-muted-foreground">Módulo de Relatórios não ativo</h2>
        <p className="text-sm text-muted-foreground/70 max-w-md">
          Ative o módulo de Relatórios no seu plano para acessar exportações em PDF, PNG e visualizações detalhadas.
        </p>
        <Button variant="outline" onClick={() => navigate("/plano")}>
          Ver Módulos Disponíveis
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" />
          Relatórios
        </h1>
        <p className="text-muted-foreground mt-1">
          Central de relatórios — visualize, exporte em PDF ou PNG.
        </p>
      </div>

      {/* Report Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((report) => (
          <Card
            key={report.id}
            className={`group transition-all duration-200 ${
              report.available
                ? "hover:shadow-md hover:border-primary/30 cursor-pointer"
                : "opacity-60"
            }`}
            onClick={() => report.available && report.navigateTo && navigate(report.navigateTo)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <report.icon className="h-5 w-5 text-primary" />
                </div>
                {report.comingSoon && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    Em breve
                  </span>
                )}
              </div>
              <CardTitle className="text-base mt-3">{report.title}</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                {report.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {report.available ? (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-primary">
                    Abrir <ArrowRight className="h-3 w-3" />
                  </Button>
                  <div className="flex gap-1 ml-auto">
                    <Button variant="outline" size="sm" className="h-7 text-[10px] px-2 gap-1" onClick={(e) => e.stopPropagation()}>
                      <FileText className="h-3 w-3" /> PDF
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-[10px] px-2 gap-1" onClick={(e) => e.stopPropagation()}>
                      <Image className="h-3 w-3" /> PNG
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/50 italic">
                  Disponível em breve
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Info section */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground text-center">
            💡 Dica: Você também pode exportar relatórios diretamente de cada tela usando os botões de atalho rápido no Dashboard, Financeiro e Agenda.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
