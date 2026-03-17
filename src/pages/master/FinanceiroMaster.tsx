import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { Building2, DollarSign, TrendingUp, Clock, CheckCircle2, BarChart3 } from "lucide-react";
import { format, subMonths, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function FinanceiroMaster() {
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

  const totalRecebido = pagamentos
    .filter((p: any) => p.status === "pago")
    .reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);

  const totalPendente = pagamentos
    .filter((p: any) => p.status === "pendente")
    .reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);

  const totalGeral = pagamentos.reduce(
    (acc: number, p: any) => acc + Number(p.valor || 0),
    0
  );

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

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pago: { label: "Pago", variant: "default" },
    pendente: { label: "Pendente", variant: "secondary" },
    cancelado: { label: "Cancelado", variant: "destructive" },
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Financeiro Master</h1>

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
              <div className="h-10 w-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <Clock className="h-5 w-5 text-yellow-500" />
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
                <p className="text-sm text-muted-foreground">Receita do Mês</p>
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

      {/* Histórico de Pagamentos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Histórico de Pagamentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pagamentos.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum pagamento registrado.</p>
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
                  {pagamentos.map((p: any) => {
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
          </CardTitle>
        </CardHeader>
        <CardContent>
          {empresas.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma empresa cadastrada.</p>
          ) : (
            <div className="space-y-3">
              {empresas.map((e: any) => {
                const pagosEmpresa = pagamentos
                  .filter((p: any) => p.empresa_id === e.id && p.status === "pago")
                  .reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);
                const pendentesEmpresa = pagamentos
                  .filter((p: any) => p.empresa_id === e.id && p.status === "pendente")
                  .reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0);
                const percentual = totalRecebido > 0 ? (pagosEmpresa / totalRecebido) * 100 : 0;

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
                          <p className="text-xs text-yellow-500">+ {formatCurrency(pendentesEmpresa)} pendente</p>
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
