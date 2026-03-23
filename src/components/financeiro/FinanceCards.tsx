import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ChevronDown, DollarSign, CheckCircle2, Clock, TrendingDown, TrendingUp } from "lucide-react";

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
type ExtraCost = { name: string; value: number };
type EmployeeExpense = { employeeId: string; name: string; funcao: string; cache: number; food: number };

function parseExtraCosts(raw: any): ExtraCost[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}
function sumExtraCosts(extras: ExtraCost[]): number {
  return extras.reduce((s, e) => s + (e.value || 0), 0);
}
function parseEmployeeExpenses(raw: any): EmployeeExpense[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}
function sumEmployeeCache(emps: EmployeeExpense[]): number {
  return emps.reduce((s, e) => s + (e.cache || 0), 0);
}
function sumEmployeeFood(emps: EmployeeExpense[]): number {
  return emps.reduce((s, e) => s + (e.food || 0), 0);
}
function sumEmployeeExpenses(emps: EmployeeExpense[]): number {
  return emps.reduce((s, e) => s + (e.cache || 0) + (e.food || 0), 0);
}

const fmt = (n: number | null) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

interface FinanceCardProps {
  financials: any[];
  getCachePago: (f: any) => number;
  getCachePendente: (f: any) => number;
  onTogglePayment: (financialId: string, detail: CacheDetail) => void;
}

export function FinanceCards({ financials, getCachePago, getCachePendente, onTogglePayment }: FinanceCardProps) {
  const totalCache = financials.reduce((s, f) => s + (f.cache || 0), 0);
  const totalCachePago = financials.reduce((s, f) => s + getCachePago(f), 0);
  const totalCachePendente = totalCache - totalCachePago;
  const totalFixedCosts = financials.reduce((s, f) => s + (f.transport || 0) + (f.food || 0) + (f.lodging || 0), 0);
  const totalExtraCosts = financials.reduce((s, f) => s + sumExtraCosts(parseExtraCosts(f.extra_costs)), 0);
  const totalEmployeeCosts = financials.reduce((s, f) => s + sumEmployeeExpenses(parseEmployeeExpenses(f.funcionarios_cache)), 0);
  const totalCosts = totalFixedCosts + totalExtraCosts + totalEmployeeCosts;
  const totalProfit = totalCachePago - totalCosts;

  // Pending items
  const pendingItems: { financialId: string; eventName: string; label: string; valor: number; detail: CacheDetail; type: "entrada" | "parcela" | "recebimento"; parcelaIndex?: number }[] = [];
  financials.forEach((f) => {
    const detail = f.cache_detail as CacheDetail | null;
    if (!detail) return;
    const eventName = f.events?.name || "Evento";
    if (detail.entrada > 0 && !detail.entradaPaga) {
      pendingItems.push({ financialId: f.id, eventName, label: "Entrada", valor: detail.entrada, detail, type: "entrada" });
    }
    if (detail.parcelado) {
      (detail.parcelas || []).forEach((p, i) => {
        if (!p.pago) {
          pendingItems.push({ financialId: f.id, eventName, label: `Parcela ${p.numero}${p.vencimento ? ` (${p.vencimento.split("-").reverse().join("/")})` : ""}`, valor: p.valor, detail, type: "parcela", parcelaIndex: i });
        }
      });
    } else if (!detail.recebimentoPago && (detail.valorTotal - (detail.entrada || 0)) > 0) {
      pendingItems.push({ financialId: f.id, eventName, label: "Recebimento", valor: detail.valorTotal - (detail.entrada || 0), detail, type: "recebimento" });
    }
  });

  const handleTogglePaid = (item: typeof pendingItems[0]) => {
    const newDetail = JSON.parse(JSON.stringify(item.detail)) as CacheDetail;
    if (item.type === "entrada") newDetail.entradaPaga = true;
    else if (item.type === "parcela" && item.parcelaIndex !== undefined) newDetail.parcelas[item.parcelaIndex].pago = true;
    else if (item.type === "recebimento") newDetail.recebimentoPago = true;
    onTogglePayment(item.financialId, newDetail);
  };

  const costBreakdown = financials.map((f) => {
    const extras = parseExtraCosts(f.extra_costs);
    const emps = parseEmployeeExpenses(f.funcionarios_cache);
    return {
      eventName: f.events?.name || "Evento",
      transport: f.transport || 0,
      food: f.food || 0,
      lodging: f.lodging || 0,
      employees: sumEmployeeExpenses(emps),
      extras: sumExtraCosts(extras),
      total: (f.transport || 0) + (f.food || 0) + (f.lodging || 0) + sumExtraCosts(extras) + sumEmployeeExpenses(emps),
    };
  });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {/* Total Cachê */}
      <Popover>
        <PopoverTrigger asChild>
          <Card className="cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all">
            <CardContent className="pt-4 pb-3 px-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-accent/10 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{fmt(totalCache)}</p>
                  <p className="text-[10px] text-muted-foreground">Total Cachê</p>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 space-y-2 text-xs" align="start">
          <p className="font-semibold text-sm mb-2">Detalhes do Cachê</p>
          {financials.map((f) => (
            <div key={f.id} className="flex justify-between items-center py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground truncate mr-2">{f.events?.name || "—"}</span>
              <span className="font-medium whitespace-nowrap">{fmt(f.cache)}</span>
            </div>
          ))}
        </PopoverContent>
      </Popover>

      {/* Recebido */}
      <Popover>
        <PopoverTrigger asChild>
          <Card className="cursor-pointer hover:ring-1 hover:ring-accent/30 transition-all">
            <CardContent className="pt-4 pb-3 px-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-accent/10 flex items-center justify-center">
                  <CheckCircle2 className="h-4 w-4 text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-accent truncate">{fmt(totalCachePago)}</p>
                  <p className="text-[10px] text-muted-foreground">Recebido</p>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 space-y-2 text-xs" align="start">
          <p className="font-semibold text-sm mb-2">Valores Recebidos</p>
          {financials.map((f) => {
            const pago = getCachePago(f);
            if (pago <= 0) return null;
            return (
              <div key={f.id} className="flex justify-between items-center py-1 border-b border-border last:border-0">
                <span className="text-muted-foreground truncate mr-2">{f.events?.name || "—"}</span>
                <span className="font-medium text-accent whitespace-nowrap">{fmt(pago)}</span>
              </div>
            );
          })}
          {totalCachePago <= 0 && <p className="text-muted-foreground">Nenhum recebimento ainda.</p>}
        </PopoverContent>
      </Popover>

      {/* Pendente */}
      <Popover>
        <PopoverTrigger asChild>
          <Card className="cursor-pointer hover:ring-1 hover:ring-[hsl(var(--warning))]/30 transition-all">
            <CardContent className="pt-4 pb-3 px-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-[hsl(var(--warning))]/10 flex items-center justify-center">
                  <Clock className="h-4 w-4 text-[hsl(var(--warning))]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[hsl(var(--warning))] truncate">{fmt(totalCachePendente)}</p>
                  <p className="text-[10px] text-muted-foreground">Pendente</p>
                  {pendingItems.length > 0 && <p className="text-[9px] text-muted-foreground">{pendingItems.length} item(ns)</p>}
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3 space-y-2 text-xs" align="start">
          <p className="font-semibold text-sm mb-2">Pendências</p>
          {pendingItems.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma pendência.</p>
          ) : (
            pendingItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
                <Checkbox
                  checked={false}
                  onCheckedChange={() => handleTogglePaid(item)}
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.eventName}</p>
                  <p className="text-muted-foreground truncate">{item.label}</p>
                </div>
                <span className="font-semibold text-[hsl(var(--warning))] whitespace-nowrap">{fmt(item.valor)}</span>
              </div>
            ))
          )}
        </PopoverContent>
      </Popover>

      {/* Total Custos */}
      <Popover>
        <PopoverTrigger asChild>
          <Card className="cursor-pointer hover:ring-1 hover:ring-destructive/30 transition-all">
            <CardContent className="pt-4 pb-3 px-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-destructive/10 flex items-center justify-center">
                  <TrendingDown className="h-4 w-4 text-destructive" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{fmt(totalCosts)}</p>
                  <p className="text-[10px] text-muted-foreground">Total Custos</p>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3 space-y-2 text-xs" align="end">
          <p className="font-semibold text-sm mb-2">Detalhes dos Custos</p>
          {costBreakdown.map((c, i) => (
            <div key={i} className="space-y-1 pb-2 border-b border-border last:border-0 last:pb-0">
              <p className="font-medium">{c.eventName}</p>
              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                {c.transport > 0 && <span>Transporte: {fmt(c.transport)}</span>}
                {c.food > 0 && <span>Alimentação: {fmt(c.food)}</span>}
                {c.lodging > 0 && <span>Hospedagem: {fmt(c.lodging)}</span>}
                {c.employees > 0 && <span>Funcionários: {fmt(c.employees)}</span>}
                {c.extras > 0 && <span>Extras: {fmt(c.extras)}</span>}
              </div>
              <p className="text-destructive font-medium">Total: {fmt(c.total)}</p>
            </div>
          ))}
        </PopoverContent>
      </Popover>

      {/* Resultado */}
      <Popover>
        <PopoverTrigger asChild>
          <Card className="cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all">
            <CardContent className="pt-4 pb-3 px-3">
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 shrink-0 rounded-lg flex items-center justify-center ${totalProfit >= 0 ? "bg-accent/10" : "bg-destructive/10"}`}>
                  {totalProfit >= 0 ? <TrendingUp className="h-4 w-4 text-accent" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold truncate ${totalProfit >= 0 ? "text-accent" : "text-destructive"}`}>{fmt(totalProfit)}</p>
                  <p className="text-[10px] text-muted-foreground">Resultado</p>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 space-y-2 text-xs" align="end">
          <p className="font-semibold text-sm mb-2">Resumo</p>
          <div className="flex justify-between"><span className="text-muted-foreground">Recebido</span><span className="text-accent font-medium">{fmt(totalCachePago)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Custos</span><span className="text-destructive font-medium">- {fmt(totalCosts)}</span></div>
          <div className="border-t border-border pt-1 flex justify-between font-semibold">
            <span>Resultado</span>
            <span className={totalProfit >= 0 ? "text-accent" : "text-destructive"}>{fmt(totalProfit)}</span>
          </div>
          {totalCachePendente > 0 && (
            <p className="text-[hsl(var(--warning))] text-[10px]">+ {fmt(totalCachePendente)} pendente de recebimento</p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
