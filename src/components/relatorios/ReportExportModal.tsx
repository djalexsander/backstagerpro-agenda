import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getFinancialLedgerPermissions } from "@/lib/financial-ledger-permissions";
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
import { format, startOfMonth, parseISO } from "date-fns";
import { toast } from "sonner";
import type { ExportFormat } from "@/lib/pdf-export";
import {
  executeReportExport,
  MONTHS,
  MODES_BY_REPORT,
  REPORT_TITLES,
  type ExportFilters,
  type ExportMode,
  type ReportType,
} from "@/lib/report-export-service";

export type { ExportFilters, ExportMode, ReportType } from "@/lib/report-export-service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportType: ReportType;
  exportFormat: ExportFormat;
}

export function ReportExportModal({ open, onOpenChange, reportType, exportFormat }: Props) {
  const { empresaId, empresaNome, empresaLogoUrl, role, empresaReadOnly } = useAuth();
  const { hasModule } = useCompanyModules(empresaId);
  // Same gate as the on-screen Locações panel (LocacoesReceivablesPanel) -
  // the exported report must never show a section the user couldn't already
  // see live: role + módulo financeiro_avancado, mirrored here instead of
  // re-derived inside report-export-service so permission logic stays in
  // exactly one place.
  const rentalsPermissions = getFinancialLedgerPermissions({
    role,
    moduleEnabled: hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO),
    companyReadOnly: empresaReadOnly,
    companySelected: Boolean(empresaId),
  });
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

  useEffect(() => {
    const defaultMode = MODES_BY_REPORT[reportType][0]?.value ?? "periodo";

    setFilters((prev) => {
      if (MODES_BY_REPORT[reportType].some((mode) => mode.value === prev.mode)) {
        return prev;
      }

      return {
        ...prev,
        mode: defaultMode,
        eventId: undefined,
      };
    });
  }, [reportType]);

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
        .limit(1000);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId && open,
  });

  const availableModes = MODES_BY_REPORT[reportType];

  const handleConfirmExport = async () => {
    if (!empresaId) {
      toast.error("Não foi possível identificar a empresa para gerar o relatório.");
      return;
    }

    setExporting(true);

    try {
      await executeReportExport({
        empresaId,
        reportType,
        exportFormat,
        filters,
        branding: { empresaNome, empresaLogoUrl },
        includeRentals: rentalsPermissions.visualizar,
      });

      onOpenChange(false);
    } catch (err) {
      console.error("Export error:", err);
      toast.error(err instanceof Error ? err.message : "Não foi possível gerar o relatório.");
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
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Gerando {exportFormat.toUpperCase()}...</>
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
