import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, DollarSign, Calendar, FileText, Image,
  ArrowRight, BarChart3, Users, ClipboardList, Music, Lock, Printer
} from "lucide-react";
import { useModuleAccess } from "@/components/ModuleGate";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useAuth } from "@/contexts/AuthContext";
import { MODULE_KEYS } from "@/constants/module-keys";
import { ReportExportModal, type ReportType } from "@/components/relatorios/ReportExportModal";
import type { ExportFormat } from "@/lib/pdf-export";

interface ReportCard {
  id: ReportType;
  title: string;
  description: string;
  icon: React.ElementType;
  available: boolean;
  navigateTo?: string;
  /** Shown instead of "Disponível em breve" when available=false because a
   * specific module isn't active (as opposed to the feature not existing). */
  lockedReason?: string;
}

export default function Relatorios() {
  const navigate = useNavigate();
  const { empresaId } = useAuth();
  const { canAccess } = useModuleAccess(MODULE_KEYS.RELATORIOS);
  const { hasModule } = useCompanyModules(empresaId);
  const hasOperacional = hasModule(MODULE_KEYS.PAINEL_OPERACIONAL);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ReportType>("dashboard");
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat | "print">("pdf");

  const handleOpenExportModal = (reportType: ReportType, format: ExportFormat | "print") => {
    setSelectedReport(reportType);
    setSelectedFormat(format);
    setModalOpen(true);
  };

  const reports: ReportCard[] = [
    {
      id: "dashboard",
      title: "Relatório do Dashboard",
      description: "Visão geral com indicadores, financeiro, locações e tendências de eventos.",
      icon: LayoutDashboard,
      available: true,
      navigateTo: "/dashboard",
    },
    {
      id: "financeiro",
      title: "Relatório Financeiro",
      description: "Receitas e despesas dos eventos, além da posição financeira de locações.",
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
      available: true,
      navigateTo: "/funcionarios",
    },
    {
      id: "operacional",
      title: "Relatório Operacional",
      description: "Painel operacional com equipe escalada e progresso de checklist por evento.",
      icon: ClipboardList,
      available: hasOperacional,
      navigateTo: "/painel-operacional",
      lockedReason: "Requer o módulo Painel Operacional",
    },
    {
      id: "evento",
      title: "Relatório por Evento",
      description: "Relatório detalhado individual de cada evento com todos os dados.",
      icon: Music,
      available: true,
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
                {!report.available && report.lockedReason && (
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    <Lock className="h-2.5 w-2.5" /> Bloqueado
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
                  {report.navigateTo && (
                    <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-primary">
                      Abrir <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                  <div className="flex gap-1 ml-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2 gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenExportModal(report.id, "pdf");
                      }}
                    >
                      <FileText className="h-3 w-3" /> PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2 gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenExportModal(report.id, "png");
                      }}
                    >
                      <Image className="h-3 w-3" /> PNG
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2 gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenExportModal(report.id, "print");
                      }}
                    >
                      <Printer className="h-3 w-3" /> Imprimir
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground/70">
                    {report.lockedReason || "Disponível em breve"}
                  </p>
                  {report.lockedReason && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={(e) => { e.stopPropagation(); navigate("/plano"); }}
                    >
                      Ver Módulos Disponíveis
                    </Button>
                  )}
                </div>
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

      {/* Export Modal */}
      <ReportExportModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        reportType={selectedReport}
        exportFormat={selectedFormat}
      />
    </div>
  );
}
