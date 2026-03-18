import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface AgendaFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusChange: (v: string) => void;
  cityFilter: string;
  onCityChange: (v: string) => void;
  cities: string[];
  periodStart: string;
  onPeriodStartChange: (v: string) => void;
  periodEnd: string;
  onPeriodEndChange: (v: string) => void;
}

export function AgendaFilters({
  search, onSearchChange,
  statusFilter, onStatusChange,
  cityFilter, onCityChange,
  cities,
  periodStart, onPeriodStartChange,
  periodEnd, onPeriodEndChange,
}: AgendaFiltersProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por evento, artista ou cidade..." className="pl-9" value={search} onChange={(e) => onSearchChange(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="confirmado">Confirmado</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
            <SelectItem value="em_negociacao">Em Negociação</SelectItem>
            <SelectItem value="finalizado">Finalizado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={cityFilter} onValueChange={onCityChange}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Cidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-end">
        <div className="flex gap-2 items-center">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Período:</span>
          <Input type="date" className="w-36 h-9 text-xs" value={periodStart} onChange={(e) => onPeriodStartChange(e.target.value)} />
          <span className="text-xs text-muted-foreground">até</span>
          <Input type="date" className="w-36 h-9 text-xs" value={periodEnd} onChange={(e) => onPeriodEndChange(e.target.value)} />
        </div>
        {(periodStart || periodEnd) && (
          <button className="text-xs text-primary hover:underline" onClick={() => { onPeriodStartChange(""); onPeriodEndChange(""); }}>
            Limpar período
          </button>
        )}
      </div>
    </div>
  );
}
