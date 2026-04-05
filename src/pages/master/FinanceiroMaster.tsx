import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Building2, DollarSign, TrendingUp, Clock, CheckCircle2, BarChart3, FileDown, FilterX, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, subMonths, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { exportMasterFinanceiroPDF } from "@/lib/pdf-export-master";

const MONTHS = [
  { value: "0", label: "Janeiro" }, { value: "1", label: "Fevereiro" },
  { value: "2", label: "Março" }, { value: "3", label: "Abril" },
  { value: "4", label: "Maio" }, { value: "5", label: "Junho" },
  { value: "6", label: "Julho" }, { value: "7", label: "Agosto" },
  { value: "8", label: "Setembro" }, { value: "9", label: "Outubro" },
  { value: "10", label: "Novembro" }, { value: "11", label: "Dezembro" },
];

function getYearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => current - i).map((y) => ({ value: String(y), label: String(y) }));
}

export default function FinanceiroMaster() {
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>(String(new Date().getFullYear()));

  const { data: pagamentos = [] } = useQuery({
    queryKey: ["master-pagamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pagamentos")
        .select("*, empresas(nome_empresa)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["master-empresas-financeiro"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_empresa, plano, status, created_at");
      if (error) throw error;
      return data;
    },
  });

  // Filtered payments
  const filteredPagamentos = useMemo(() => {
    return pagamentos.filter((p: any) => {
      const d = new Date(p.created_at);
      if (filterYear !== "all" && d.getFullYear() !== Number(filterYear)) return false;
      if (filterMonth !== "all" && d.getMonth() !== Number(filterMonth)) return false;
      return true;
    });
  }, [pagamentos, filterMonth, filterYear]);

  const isFiltered = filterMonth !== "all" || filterYear !== String(new Date().getFullYear());
  const filterLabel = useMemo(() => {
    if (filterMonth === "all" && filterYear === "all") return "Geral";
    const mLabel = filterMonth !== "all" ? MONTHS[Number(filterMonth)]?.label : "";
    const yLabel = filterYear !== "all" ? filterYear : "";
    return [mLabel, yLabel].filter(Boolean).join("/");
  }, [filterMonth, filterYear]);

  const totalRecebido = filteredPagamentos
    .filter((p: any) => p.status === "pago")
    .reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);

  const totalPendente = filteredPagamentos
    .filter((p: any) => p.status === "pendente")
    .reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);

  const empresasAtivas = empresas.filter((e: any) => e.status === "ativo").length;

  const mesAtual = new Date().getMonth();
  const anoAtual = new Date().getFullYear();
  const receitaMes = pagamentos
    .filter((p: any) => {
      const d = new Date(p.created_at);
      return p.status === "pago" && d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    })
    .reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);

  const formatCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const chartData = useMemo(() => {
    const months: { month: string; recebido: number; pendente: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      const m = d.getMonth();
      const y = d.getFullYear();
      const label = format(startOfMonth(d), "MMM/yy", { locale: ptBR });
      const recebido = pagamentos
        .filter((p: any) => { const pd = new Date(p.created_at); return p.status === "pago" && pd.getMonth() === m && pd.getFullYear() === y; })
        .reduce((a: number, p: any) => a + Number(p.valor || 0), 0);
      const pendente = pagamentos
        .filter((p: any) => { const pd = new Date(p.created_at); return p.status === "pendente" && pd.getMonth() === m && pd.getFullYear() === y; })
        .reduce((a: number, p: any) => a + Number(p.valor || 0), 0);
      months.push({ month: label, recebido, pendente });
    }
    return months;
  }, [pagamentos]);

  const chartConfig = {
    recebido: { label: "Recebido", color: "hsl(var(--accent))" },
    pendente: { label: "Pendente", color: "hsl(var(--muted-foreground))" },
  };

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pago: { label: "Pago", variant: "default" },
    pendente: { label: "Pendente", variant: "secondary" },
    cancelado: { label: "Cancelado", variant: "destructive" },
  };

  const clearFilters = () => {
    setFilterMonth("all");
    setFilterYear(String(new Date().getFullYear()));
  };

  const handleExportPDF = (type: "filtered" | "all") => {
    const data = type === "all" ? pagamentos : filteredPagamentos;
    const title = type === "all" ? "Geral" : filterLabel;
    exportMasterFinanceiroPDF(data, empresas, title);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Financeiro Master</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses</SelectItem>
              {MONTHS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {getYearOptions().map((y) => (
                <SelectItem key={y.value} value={y.value}>{y.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isFiltered && (
            <Button variant="ghost" size="icon" onClick={clearFilters} title="Limpar filtros">
              <FilterX className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => handleExportPDF("filtered")}>
            <FileDown className="h-4 w-4 mr-1" />
            PDF {filterLabel}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExportPDF("all")}>
            <FileDown className="h-4 w-4 mr-1" />
            PDF Geral
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent/20 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(totalRecebido)}</p>
                <p className="text-sm text-muted-foreground">Total Recebido</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <Clock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(totalPendente)}</p>
                <p className="text-sm text-muted-foreground">Pendente</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(receitaMes)}</p>
                <p className="text-sm text-muted-foreground">Receita do Mês Atual</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{empresasAtivas} / {empresas.length}</p>
                <p className="text-sm text-muted-foreground">Empresas Ativas</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico Receita Mensal */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Receita Mensal (últimos 12 meses)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />} />
              <Bar dataKey="recebido" fill="var(--color-recebido)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="pendente" fill="var(--color-pendente)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Histórico de Pagamentos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Histórico de Pagamentos
            {isFiltered && <Badge variant="secondary" className="ml-2 text-xs">{filterLabel}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredPagamentos.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum pagamento encontrado para o período selecionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-3 font-medium text-muted-foreground">Empresa</th>
                    <th className="pb-3 font-medium text-muted-foreground">Valor</th>
                    <th className="pb-3 font-medium text-muted-foreground">Método</th>
                    <th className="pb-3 font-medium text-muted-foreground">Status</th>
                    <th className="pb-3 font-medium text-muted-foreground">Data</th>
                    <th className="pb-3 font-medium text-muted-foreground">Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPagamentos.map((p: any) => {
                    const sc = statusConfig[p.status] || { label: p.status, variant: "outline" as const };
                    return (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-3 font-medium">{p.empresas?.nome_empresa || "—"}</td>
                        <td className="py-3 font-semibold">{formatCurrency(Number(p.valor || 0))}</td>
                        <td className="py-3 capitalize">{p.metodo || "—"}</td>
                        <td className="py-3">
                          <Badge variant={sc.variant}>{sc.label}</Badge>
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {format(new Date(p.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </td>
                        <td className="py-3 text-muted-foreground max-w-[200px] truncate">{p.descricao || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resumo por Empresa */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Receita por Empresa
            {isFiltered && <Badge variant="secondary" className="ml-2 text-xs">{filterLabel}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {empresas.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma empresa cadastrada.</p>
          ) : (
            <div className="space-y-3">
              {empresas.map((e: any) => {
                const pagosEmpresa = filteredPagamentos
                  .filter((p: any) => p.empresa_id === e.id && p.status === "pago")
                  .reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);
                const pendentesEmpresa = filteredPagamentos
                  .filter((p: any) => p.empresa_id === e.id && p.status === "pendente")
                  .reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);
                const percentual = totalRecebido > 0 ? (pagosEmpresa / totalRecebido) * 100 : 0;

                if (pagosEmpresa === 0 && pendentesEmpresa === 0) return null;

                return (
                  <div key={e.id} className="p-4 rounded-lg bg-muted/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{e.nome_empresa}</p>
                        <p className="text-xs text-muted-foreground capitalize">Plano: {e.plano || "—"}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-accent">{formatCurrency(pagosEmpresa)}</p>
                        {pendentesEmpresa > 0 && (
                          <p className="text-xs text-muted-foreground">+ {formatCurrency(pendentesEmpresa)} pendente</p>
                        )}
                      </div>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-accent h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(percentual, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
