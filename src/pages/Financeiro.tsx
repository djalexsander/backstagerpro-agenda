import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Clock, DollarSign, FileDown, ImageIcon, TrendingDown, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { computeConsolidatedFinancialResult, exportFinancialTotalPDF } from "@/lib/pdf-export";
import { parseISO, isWithinInterval, startOfMonth, endOfMonth, format } from "date-fns";
import { EventosFinanceiroPanel } from "@/components/financeiro/EventosFinanceiroPanel";
import { LocacoesReceivablesPanel } from "@/components/financeiro/LocacoesReceivablesPanel";
import { ManutencaoDespesasPanel } from "@/components/financeiro/ManutencaoDespesasPanel";
import { useModuleAccess } from "@/components/ModuleGate";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getFinancialLedgerPermissions } from "@/lib/financial-ledger-permissions";
import { getMaintenanceExpensesSummary, getRentalsFinancialSummary } from "@/lib/financial-ledger-service";
import type { FinancialMaintenanceSection, FinancialRentalsSection } from "@/lib/pdf-export";
import { fetchAllReceivableEntries, fetchMaintenanceForFinancialReport, fetchRentalsForFinancialReport } from "@/lib/report-export-service";
import { useState } from "react";

type ExtraCost = { name: string; value: number };
type CacheParcela = { numero: number; valor: number; vencimento: string; pago: boolean };
type CacheDetail = {
  valorTotal: number;
  entrada: number;
  entradaPaga: boolean;
  parcelado: boolean;
  parcelas: CacheParcela[];
  recebimentoEvento: boolean;
  dataRecebimento: string;
  recebimentoPago: boolean;
};

function parseExtraCosts(raw: any): ExtraCost[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function sumExtraCosts(extras: ExtraCost[]): number {
  return extras.reduce((s, e) => s + (e.value || 0), 0);
}

// Mirrors FinanceCards/EventosFinanceiroPanel's own copy of the same
// calculation - cache_detail lives on the financials row and this is the
// one place that turns it into "quanto já entrou" (same pattern already
// duplicated across this module rather than a shared utils import).
function getCachePago(f: any): number {
  const detail = (f as any).cache_detail as CacheDetail | null;
  if (!detail) return f.cache || 0;
  let paid = 0;
  if (detail.entrada > 0 && detail.entradaPaga) paid += detail.entrada;
  if (detail.parcelado) {
    paid += (detail.parcelas || []).filter((p) => p.pago).reduce((s, p) => s + p.valor, 0);
  } else if (detail.recebimentoPago) {
    paid += detail.valorTotal - (detail.entrada || 0);
  }
  return paid;
}

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function Financeiro() {
  const { toast } = useToast();
  const { empresaId, empresaNome, empresaLogoUrl, empresaReadOnly, role } = useAuth();
  const { canAccess: canExport } = useModuleAccess(MODULE_KEYS.RELATORIOS);
  const { hasModule, isLoading: loadingModules } = useCompanyModules(empresaId);
  // Same gate as LocacoesReceivablesPanel/ManutencaoDespesasPanel - Locações
  // and Manutenções share one permission (role + módulo financeiro_avancado),
  // used here to decide both the Geral tab's contribution from those two
  // sources and whether their tabs show up at all.
  const rentalsPermissions = getFinancialLedgerPermissions({
    role,
    moduleEnabled: hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO),
    companyReadOnly: empresaReadOnly,
    companySelected: Boolean(empresaId),
  });

  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "month" | "period">("all");
  const [exportMonth, setExportMonth] = useState(format(new Date(), "yyyy-MM"));
  const [exportStart, setExportStart] = useState("");
  const [exportEnd, setExportEnd] = useState("");

  // Same queryKey EventosFinanceiroPanel uses for its own "financials" query -
  // react-query shares one cached fetch between the two instead of this page
  // hitting Supabase twice. Needed here for the Exportar dialog (unchanged)
  // and for the Geral tab's eventos totals below.
  const { data: financials = [] } = useQuery({
    queryKey: ["financials", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase.from("financials").select("*, events(name, artist, date, venue, city, status)").order("created_at", { ascending: false }).eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Same queryKey LocacoesReceivablesPanel's own summary card and
  // ManutencaoDespesasPanel already use - shared cache, not a second fetch.
  const rentalsSummaryQuery = useQuery({
    queryKey: ["rentals-financial-summary", empresaId],
    queryFn: () => getRentalsFinancialSummary(empresaId!),
    enabled: Boolean(empresaId && rentalsPermissions.visualizar),
  });
  const maintenanceSummaryQuery = useQuery({
    queryKey: ["maintenance-expenses-summary", empresaId],
    queryFn: () => getMaintenanceExpensesSummary(empresaId!),
    enabled: Boolean(empresaId && rentalsPermissions.visualizar),
  });

  const getFilteredForExport = () => {
    if (exportMode === "all") return financials;
    if (exportMode === "month" && exportMonth) {
      const [y, m] = exportMonth.split("-").map(Number);
      const monthStart = startOfMonth(new Date(y, m - 1));
      const monthEnd = endOfMonth(new Date(y, m - 1));
      return financials.filter((f) => {
        const eventDate = (f as any).events?.date;
        if (!eventDate) return false;
        return isWithinInterval(parseISO(eventDate), { start: monthStart, end: monthEnd });
      });
    }
    if (exportMode === "period" && exportStart && exportEnd) {
      return financials.filter((f) => {
        const eventDate = (f as any).events?.date;
        if (!eventDate) return false;
        return isWithinInterval(parseISO(eventDate), { start: parseISO(exportStart), end: parseISO(exportEnd) });
      });
    }
    return financials;
  };

  const handleExport = async (exportFmt: "pdf" | "png" = "pdf") => {
    const filtered = getFilteredForExport();

    let title = "Consolidado";
    if (exportMode === "month" && exportMonth) {
      const [y, m] = exportMonth.split("-");
      title = `Mês ${m}/${y}`;
    } else if (exportMode === "period" && exportStart && exportEnd) {
      title = `${exportStart.split("-").reverse().join("/")} a ${exportEnd.split("-").reverse().join("/")}`;
    }

    // "Todos os registros" has no date bound, so the global RPC position is
    // already correct there - only "mês"/"período" need the period-filtered
    // version (that RPC has no date-range parameter of its own).
    // Manutenções share the exact same financeiro_avancado + role gate as
    // Locações (both live in financeiro_lancamentos), so rentalsPermissions
    // covers both - no separate permission check needed.
    let rentals: FinancialRentalsSection | undefined;
    let maintenance: FinancialMaintenanceSection | undefined;
    if (rentalsPermissions.visualizar && empresaId) {
      if (exportMode === "month" && exportMonth) {
        const [y, m] = exportMonth.split("-").map(Number);
        rentals = (await fetchRentalsForFinancialReport(empresaId, { mode: "mensal", month: m - 1, year: y })) ?? undefined;
        maintenance = (await fetchMaintenanceForFinancialReport(empresaId, { mode: "mensal", month: m - 1, year: y })) ?? undefined;
      } else if (exportMode === "period" && exportStart && exportEnd) {
        rentals = (await fetchRentalsForFinancialReport(empresaId, {
          mode: "periodo",
          startDate: parseISO(exportStart),
          endDate: parseISO(exportEnd),
        })) ?? undefined;
        maintenance = (await fetchMaintenanceForFinancialReport(empresaId, {
          mode: "periodo",
          startDate: parseISO(exportStart),
          endDate: parseISO(exportEnd),
        })) ?? undefined;
      } else {
        const [summary, entries] = await Promise.all([
          getRentalsFinancialSummary(empresaId),
          fetchAllReceivableEntries(empresaId),
        ]);
        rentals = { summary, entries };
        // No dedicated "global summary" RPC for manutenções (unlike Locações'
        // obter_resumo_financeiro_locacoes) - unnecessary here since the
        // total is just a sum of valor_original, with no vencido/a-receber
        // breakdown to compute server-side. Calling with no start/end bound
        // returns every entry, matching "Todos os registros".
        maintenance = (await fetchMaintenanceForFinancialReport(empresaId, { mode: "periodo" })) ?? undefined;
      }
    }

    // Any one source is enough to generate the report - only block when
    // eventos, locações and manutenções are all empty for the selected period.
    const hasRentalsData = Boolean(rentals && rentals.entries.length > 0);
    const hasMaintenanceData = Boolean(maintenance && maintenance.entries.length > 0);
    if (filtered.length === 0 && !hasRentalsData && !hasMaintenanceData) {
      toast({ title: "Nenhum registro encontrado para o período selecionado.", variant: "destructive" });
      return;
    }

    exportFinancialTotalPDF(filtered, title, { empresaNome, empresaLogoUrl }, exportFmt, undefined, rentals, maintenance);
    setExportOpen(false);
  };

  // Geral: consolida as mesmas fontes já usadas pelo relatório/PDF, com a
  // mesma fórmula validada lá (computeConsolidatedFinancialResult) - nenhuma
  // lógica financeira nova, só leitura combinada do que os outros três já
  // calculam/expõem. Locações/Manutenções caem para 0 quando o usuário não
  // tem financeiro_avancado, igual ao PDF.
  const eventsTotalPago = financials.reduce((s, f) => s + getCachePago(f), 0);
  const eventsTotalCache = financials.reduce((s, f) => s + (f.cache || 0), 0);
  const eventsTotalPendente = eventsTotalCache - eventsTotalPago;
  const eventsTotalCosts = financials.reduce(
    (s, f) => s + (f.transport || 0) + (f.food || 0) + (f.lodging || 0) + (f.other_costs || 0) + sumExtraCosts(parseExtraCosts((f as any).extra_costs)),
    0,
  );
  const rentalsSummary = rentalsSummaryQuery.data;
  const maintenanceSummary = maintenanceSummaryQuery.data;
  const rentalsSection: FinancialRentalsSection | undefined = rentalsSummary
    ? { summary: rentalsSummary, entries: [] }
    : undefined;
  const maintenanceSection: FinancialMaintenanceSection | undefined = maintenanceSummary
    ? { valorTotal: maintenanceSummary.valorTotal, entries: [] }
    : undefined;
  const { receita: totalRecebido, despesa: totalDespesas, resultado: resultadoLiquido } = computeConsolidatedFinancialResult(
    eventsTotalPago, eventsTotalCosts, rentalsSection, maintenanceSection,
  );
  const totalAReceber = eventsTotalPendente + (rentalsSummary?.valorAReceber ?? 0);
  const geralLoading = rentalsPermissions.visualizar && (rentalsSummaryQuery.isLoading || maintenanceSummaryQuery.isLoading);

  // Avoids a flash where the tab appears then immediately disappears: shown
  // optimistically while módulos are still loading, hidden only once loading
  // has settled and the user actually lacks financeiro_avancado - same
  // resolution order LocacoesReceivablesPanel/ManutencaoDespesasPanel already
  // use internally (loadingModules gates the negative branch, not the positive).
  const showLocacoesManutencoesTabs = loadingModules || rentalsPermissions.visualizar;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Financeiro</h1>
        {/* Same visibility condition as before the restructure (financials.length
            preserved on purpose, not widened) - untouched behavior. */}
        {financials.length > 0 && canExport && (
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
            <FileDown className="h-4 w-4 mr-1" /> Exportar
          </Button>
        )}
      </div>

      {/* Export Dialog - gera o mesmo relatório consolidado (Eventos, Locações,
          Manutenções, Resultado Financeiro Consolidado) desta etapa anterior,
          intocado aqui. */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Exportar Relatório Financeiro</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de Exportação</Label>
              <Select value={exportMode} onValueChange={(v) => setExportMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os registros</SelectItem>
                  <SelectItem value="month">Por mês</SelectItem>
                  <SelectItem value="period">Por período (início e fim)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {exportMode === "month" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mês</Label>
                  <Select value={exportMonth.split("-")[1] || "01"} onValueChange={(v) => setExportMonth((prev) => `${prev.split("-")[0]}-${v}`)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"].map((m, i) => (
                        <SelectItem key={i} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ano</Label>
                  <Select value={exportMonth.split("-")[0] || "2026"} onValueChange={(v) => setExportMonth((prev) => `${v}-${prev.split("-")[1]}`)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i)).map((y) => (
                        <SelectItem key={y} value={y}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {exportMode === "period" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Data Início</Label>
                  <Input type="date" value={exportStart} onChange={(e) => setExportStart(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Data Fim</Label>
                  <Input type="date" value={exportEnd} onChange={(e) => setExportEnd(e.target.value)} />
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button variant="outline" onClick={() => handleExport("png")}>
              <ImageIcon className="h-4 w-4 mr-1" /> Exportar PNG
            </Button>
            <Button onClick={() => handleExport("pdf")}>
              <FileDown className="h-4 w-4 mr-1" /> Exportar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="geral">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="eventos">Eventos</TabsTrigger>
          {showLocacoesManutencoesTabs && <TabsTrigger value="locacoes">Locações</TabsTrigger>}
          {showLocacoesManutencoesTabs && <TabsTrigger value="manutencoes">Manutenções</TabsTrigger>}
        </TabsList>

        <TabsContent value="geral" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Receita de Eventos</p>
              <p className="text-xl font-bold">{money.format(eventsTotalPago)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Receita de Locações</p>
              <p className="text-xl font-bold">{geralLoading ? "—" : money.format(rentalsSummary?.valorRecebido ?? 0)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> Despesas de Eventos</p>
              <p className="text-xl font-bold text-destructive">{money.format(eventsTotalCosts)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> Despesas de Manutenções</p>
              <p className="text-xl font-bold text-destructive">{geralLoading ? "—" : money.format(maintenanceSummary?.valorTotal ?? 0)}</p>
            </CardContent></Card>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-accent" /> Total Recebido</p>
              <p className="text-xl font-bold text-accent">{geralLoading ? "—" : money.format(totalRecebido)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-yellow-500" /> Total a Receber</p>
              <p className="text-xl font-bold text-yellow-500">{geralLoading ? "—" : money.format(totalAReceber)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> Total Despesas</p>
              <p className="text-xl font-bold text-destructive">{geralLoading ? "—" : money.format(totalDespesas)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Resultado Líquido Geral</p>
              <p className={`text-xl font-bold ${resultadoLiquido >= 0 ? "text-accent" : "text-destructive"}`}>{geralLoading ? "—" : money.format(resultadoLiquido)}</p>
            </CardContent></Card>
          </div>
          {!rentalsPermissions.visualizar && !loadingModules && (
            <p className="text-xs text-muted-foreground">
              Locações e Manutenções não estão disponíveis para sua conta - o resumo acima reflete apenas Eventos.
            </p>
          )}
        </TabsContent>

        <TabsContent value="eventos">
          <EventosFinanceiroPanel
            empresaId={empresaId}
            empresaReadOnly={empresaReadOnly}
            canExport={canExport}
            empresaNome={empresaNome}
            empresaLogoUrl={empresaLogoUrl}
          />
        </TabsContent>

        {showLocacoesManutencoesTabs && (
          <TabsContent value="locacoes">
            <LocacoesReceivablesPanel empresaId={empresaId ?? null} companyReadOnly={empresaReadOnly} />
          </TabsContent>
        )}
        {showLocacoesManutencoesTabs && (
          <TabsContent value="manutencoes">
            <ManutencaoDespesasPanel empresaId={empresaId ?? null} companyReadOnly={empresaReadOnly} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
