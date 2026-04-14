import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon, FileText, Image, Loader2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import { exportAgendaPDF, exportFinancialTotalPDF, type ExportFormat } from "@/lib/pdf-export";

export type ReportType = "dashboard" | "financeiro" | "agenda";
export type ExportMode = "periodo" | "mensal" | "evento";

interface ExportFilters {
  mode: ExportMode;
  startDate?: Date;
  endDate?: Date;
  month?: number;
  year?: number;
  eventId?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportType: ReportType;
  exportFormat: ExportFormat;
}

const REPORT_TITLES: Record<ReportType, string> = {
  dashboard: "Relatório do Dashboard",
  financeiro: "Relatório Financeiro",
  agenda: "Relatório da Agenda",
};

const MODES_BY_REPORT: Record<ReportType, { value: ExportMode; label: string }[]> = {
  dashboard: [
    { value: "periodo", label: "Por período" },
    { value: "mensal", label: "Mensal" },
  ],
  financeiro: [
    { value: "periodo", label: "Por período" },
    { value: "mensal", label: "Mensal" },
    { value: "evento", label: "Evento específico" },
  ],
  agenda: [
    { value: "periodo", label: "Por período" },
    { value: "mensal", label: "Mensal" },
    { value: "evento", label: "Evento específico" },
  ],
};

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function ReportExportModal({ open, onOpenChange, reportType, exportFormat }: Props) {
  const { empresaId, empresaNome, empresaLogoUrl } = useAuth();
  const [filters, setFilters] = useState<ExportFilters>({
    mode: "periodo",
    startDate: startOfMonth(new Date()),
    endDate: new Date(),
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
  });
  const [exporting, setExporting] = useState(false);

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => currentYear - i), [currentYear]);

  // Load events for "evento específico" mode
  const { data: events = [] } = useQuery({
    queryKey: ["events-export-modal", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("events")
        .select("id, name, artist, date")
        .eq("empresa_id", empresaId)
        .order("date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId && open,
  });

  const availableModes = MODES_BY_REPORT[reportType];

  const getDateRange = (): { start: string; end: string; title: string } => {
    if (filters.mode === "mensal") {
      const m = filters.month ?? 0;
      const y = filters.year ?? currentYear;
      const d = new Date(y, m, 1);
      return {
        start: format(startOfMonth(d), "yyyy-MM-dd"),
        end: format(endOfMonth(d), "yyyy-MM-dd"),
        title: `${MONTHS[m]} ${y}`,
      };
    }
    return {
      start: filters.startDate ? format(filters.startDate, "yyyy-MM-dd") : "",
      end: filters.endDate ? format(filters.endDate, "yyyy-MM-dd") : "",
      title: filters.startDate && filters.endDate
        ? `${format(filters.startDate, "dd/MM/yyyy")} a ${format(filters.endDate, "dd/MM/yyyy")}`
        : "Período personalizado",
    };
  };

  const handleConfirmExport = async () => {
    setExporting(true);
    try {
      const branding = { empresaNome, empresaLogoUrl };
      const { start, end, title } = getDateRange();

      if (reportType === "agenda") {
        let filtered = events;
        if (filters.mode === "evento" && filters.eventId) {
          filtered = events.filter(e => e.id === filters.eventId);
        } else {
          filtered = events.filter(e => {
            const d = e.date;
            return d >= start && d <= end;
          });
        }
        await exportAgendaPDF(filtered as any, branding, exportFormat);
      } else if (reportType === "financeiro") {
        // Fetch financials with date range
        let query = supabase
          .from("financials")
          .select("*, events!inner(name, artist, date, venue, city, status)")
          .eq("empresa_id", empresaId!);

        if (filters.mode === "evento" && filters.eventId) {
          query = query.eq("event_id", filters.eventId);
        } else {
          query = query.gte("events.date", start).lte("events.date", end);
        }

        const { data: financials = [] } = await query;
        await exportFinancialTotalPDF(financials as any, title, branding, exportFormat);
      } else if (reportType === "dashboard") {
        // For dashboard, export agenda-style with period filter as overview
        const filtered = events.filter(e => {
          const d = e.date;
          return d >= start && d <= end;
        });
        await exportAgendaPDF(filtered as any, branding, exportFormat);
      }

      onOpenChange(false);
    } catch (err: any) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {exportFormat === "pdf" ? <FileText className="h-5 w-5 text-primary" /> : <Image className="h-5 w-5 text-primary" />}
            Exportar {REPORT_TITLES[reportType]}
          </DialogTitle>
          <DialogDescription>
            Configure o recorte do relatório antes de gerar o arquivo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Format badge */}
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground w-20">Formato</Label>
            <span className="text-sm font-medium uppercase bg-primary/10 text-primary px-2.5 py-0.5 rounded">
              {exportFormat}
            </span>
          </div>

          {/* Export mode */}
          <div className="space-y-1.5">
            <Label className="text-sm">Modo de exportação</Label>
            <Select
              value={filters.mode}
              onValueChange={(v) => setFilters(prev => ({ ...prev, mode: v as ExportMode }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableModes.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dynamic fields */}
          {filters.mode === "periodo" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">Data inicial</Label>
                <DatePickerField
                  date={filters.startDate}
                  onSelect={(d) => setFilters(prev => ({ ...prev, startDate: d }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Data final</Label>
                <DatePickerField
                  date={filters.endDate}
                  onSelect={(d) => setFilters(prev => ({ ...prev, endDate: d }))}
                />
              </div>
            </div>
          )}

          {filters.mode === "mensal" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">Mês</Label>
                <Select
                  value={String(filters.month ?? 0)}
                  onValueChange={(v) => setFilters(prev => ({ ...prev, month: Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Ano</Label>
                <Select
                  value={String(filters.year ?? currentYear)}
                  onValueChange={(v) => setFilters(prev => ({ ...prev, year: Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {filters.mode === "evento" && (
            <div className="space-y-1.5">
              <Label className="text-sm">Selecionar evento</Label>
              <Select
                value={filters.eventId || ""}
                onValueChange={(v) => setFilters(prev => ({ ...prev, eventId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha um evento..." />
                </SelectTrigger>
                <SelectContent>
                  {events.map(e => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} — {e.artist} ({format(parseISO(e.date), "dd/MM/yy")})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirmExport} disabled={exporting}>
            {exporting ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Gerando...</>
            ) : (
              <>Gerar {exportFormat.toUpperCase()}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DatePickerField({ date, onSelect }: { date?: Date; onSelect: (d?: Date) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-full justify-start text-left font-normal h-9 text-sm", !date && "text-muted-foreground")}
        >
          <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
          {date ? format(date, "dd/MM/yyyy") : "Selecionar"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={onSelect}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
