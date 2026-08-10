import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getFinancialLedgerPermissions } from "@/lib/financial-ledger-permissions";
import { getMaintenanceExpensesSummary, listMaintenanceExpenses } from "@/lib/financial-ledger-service";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PAGE_SIZE = 10;

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-10 text-center">
      <AlertCircle className="h-6 w-6 text-destructive" />
      <p className="text-sm text-destructive">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" />Tentar novamente
      </Button>
    </div>
  );
}

// Same shape as LocacoesReceivablesPanel (summary cards + filtered table +
// pagination), but read-only: maintenance costs are already-settled expenses
// synced on order completion, so there is no "receber"/estornar flow here.
export function ManutencaoDespesasPanel({
  empresaId,
  companyReadOnly,
}: {
  empresaId: string | null;
  companyReadOnly: boolean;
}) {
  const { role } = useAuth();
  const { hasModule, isLoading: loadingModules } = useCompanyModules(empresaId);
  const permissions = getFinancialLedgerPermissions({
    role,
    moduleEnabled: hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO),
    companyReadOnly,
    companySelected: Boolean(empresaId),
  });

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const summaryQuery = useQuery({
    queryKey: ["maintenance-expenses-summary", empresaId],
    queryFn: () => getMaintenanceExpensesSummary(empresaId!),
    enabled: Boolean(empresaId && permissions.visualizar),
  });

  const expensesQuery = useQuery({
    queryKey: ["maintenance-expenses", empresaId, page, search],
    queryFn: () => listMaintenanceExpenses(empresaId!, page, PAGE_SIZE, search),
    enabled: Boolean(empresaId && permissions.visualizar),
  });

  if (!empresaId || (!loadingModules && !permissions.visualizar)) {
    return null;
  }

  const items = expensesQuery.data?.items ?? [];
  const total = expensesQuery.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const summary = summaryQuery.data;

  return (
    <Card>
      <CardHeader><CardTitle>Manutenções</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {summaryQuery.isError ? (
          <ErrorState
            message={summaryQuery.error instanceof Error ? summaryQuery.error.message : "Não foi possível carregar o resumo de manutenções."}
            onRetry={() => summaryQuery.refetch()}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Custo total</p>
                <p className="text-xl font-bold text-destructive">{summaryQuery.isLoading ? "—" : money.format(summary?.valorTotal ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Ordens concluídas com custo</p>
                <p className="text-xl font-bold">{summaryQuery.isLoading ? "—" : summary?.quantidadeOrdens ?? 0}</p>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="relative sm:max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Buscar por ordem, material ou descrição"
          />
        </div>

        {expensesQuery.isLoading ? (
          <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : expensesQuery.isError ? (
          <ErrorState
            message={expensesQuery.error instanceof Error ? expensesQuery.error.message : "Não foi possível carregar as despesas de manutenção."}
            onRetry={() => expensesQuery.refetch()}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ordem</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead>Concluída em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono font-medium">{item.ordem_numero}</TableCell>
                    <TableCell>
                      <strong>{item.material_nome}</strong>
                      <p className="text-xs text-muted-foreground">{item.material_codigo}</p>
                    </TableCell>
                    <TableCell>{item.descricao}</TableCell>
                    <TableCell className="text-right font-medium text-destructive">{money.format(item.valor_original)}</TableCell>
                    <TableCell>{new Date(item.concluida_em).toLocaleDateString("pt-BR")}</TableCell>
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Nenhuma despesa de manutenção encontrada.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
          <span className="text-sm">{page} de {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Próxima</Button>
        </div>
      </CardContent>
    </Card>
  );
}
