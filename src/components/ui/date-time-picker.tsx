import { format } from "date-fns";
import { X } from "lucide-react";

import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Campo de data + hora, sem timezone: substitui o `<input type="datetime-local">`
 * mantendo o MESMO contrato de valor — entra e sai como string
 * `YYYY-MM-DDTHH:mm` (ou "" quando vazio), igual ao que os serviços/RPCs já
 * recebem hoje. A conversão local→UTC (`new Date(value).toISOString()`) continua
 * no serviço, fora deste componente.
 *
 * A data reusa o `DatePicker` (Calendar + Popover, pt-BR, gatilho DD/MM/AAAA); a
 * hora é um `<input type="time">` em HH:mm. Trocar só a data preserva a hora e
 * vice-versa. Nada aqui vira `Date` nem faz conta de fuso — só quebra e junta a
 * string no "T"; a parte que faltar é completada (data → hoje local, hora →
 * 00:00) para o valor emitido ser sempre `YYYY-MM-DDTHH:mm` completo ou "".
 *
 * `clearable` mostra um "x" que zera data e hora de uma vez (`onChange("")`).
 */
export function DateTimePicker({
  value,
  onChange,
  disabled = false,
  placeholder = "Selecionar data",
  clearable = false,
  id,
  className,
}: {
  /** `YYYY-MM-DDTHH:mm`, ou "" quando não há data/hora. */
  value: string;
  /** Recebe `YYYY-MM-DDTHH:mm` (ou "" ao limpar, quando `clearable`). */
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Exibe um "x" para limpar data e hora (volta a ""). */
  clearable?: boolean;
  /** Encaminhado ao gatilho de data para casar com um `<Label htmlFor>`. */
  id?: string;
  className?: string;
}) {
  const [datePart = "", timeRaw = ""] = value.split("T");
  const timePart = timeRaw.slice(0, 5);
  const showClear = clearable && !disabled && Boolean(datePart || timePart);

  const emit = (nextDate: string, nextTime: string) => {
    if (!nextDate && !nextTime) {
      onChange("");
      return;
    }
    const day = nextDate || format(new Date(), "yyyy-MM-dd");
    const time = nextTime || "00:00";
    onChange(`${day}T${time}`);
  };

  return (
    // Empilhado no mobile (data em cima, hora embaixo, ambos 100%); volta a ficar
    // lado a lado a partir de `sm`. `min-w-0` impede o gatilho de data de forçar
    // overflow quando os dois dividem a linha.
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>
      <div className="min-w-0 flex-1">
        <DatePicker
          id={id}
          value={datePart}
          onChange={(nextDate) => emit(nextDate, timePart)}
          disabled={disabled}
          placeholder={placeholder}
        />
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="time"
          aria-label="Hora"
          className="w-full sm:w-32"
          value={timePart}
          onChange={(event) => emit(datePart, event.target.value)}
          disabled={disabled}
        />
        {showClear && (
          <button
            type="button"
            aria-label="Limpar data e hora"
            onClick={() => onChange("")}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
