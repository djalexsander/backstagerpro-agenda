import { useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Campo de data pura (sem hora), padronizado sobre o Calendar + Popover que já
 * existem. Substitui o `<input type="date">` nativo mantendo o MESMO contrato de
 * valor: entra e sai sempre como string ISO de data `YYYY-MM-DD` (ou "" quando
 * vazio) - igual ao que os RPCs esperam - então migrar um campo é troca direta
 * de props, sem mexer na regra de negócio ao redor.
 *
 * O gatilho mostra a data no formato brasileiro DD/MM/AAAA e o calendário abre
 * em pt-BR. `YYYY-MM-DD` é parseado (parseISO) e reformatado em horário local,
 * então não há deslocamento de fuso na ida e volta.
 *
 * Por padrão o calendário só troca a data (não há como voltar a "", igual ao
 * `<input type="date">` sem o "x" nativo). Passe `clearable` para exibir um "x"
 * no campo que zera o valor (`onChange("")`) e traz o placeholder de volta - o
 * "x" só aparece quando há uma data e o campo não está desabilitado.
 */
export function DatePicker({
  value,
  onChange,
  disabled = false,
  placeholder = "Selecionar data",
  clearable = false,
  id,
  className,
}: {
  /** Data selecionada como `YYYY-MM-DD`, ou "" quando não há data. */
  value: string;
  /** Recebe a nova data como `YYYY-MM-DD` (ou "" ao limpar, quando `clearable`). */
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Exibe um "x" para limpar a data (volta a "" e ao placeholder). */
  clearable?: boolean;
  /** Encaminhado ao botão-gatilho para casar com um `<Label htmlFor>`. */
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const parsed = value ? parseISO(value) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;
  const showClear = clearable && !disabled && Boolean(selected);

  const trigger = (
    <PopoverTrigger asChild>
      <Button
        type="button"
        id={id}
        variant="outline"
        disabled={disabled}
        className={cn(
          "w-full justify-start text-left font-normal",
          !selected && "text-muted-foreground",
          showClear && "pr-9",
          className,
        )}
      >
        <CalendarIcon className="mr-2 h-4 w-4" />
        {selected ? format(selected, "dd/MM/yyyy", { locale: ptBR }) : placeholder}
      </Button>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {clearable ? (
        <div className="relative">
          {trigger}
          {showClear && (
            <button
              type="button"
              aria-label="Limpar data"
              onClick={() => onChange("")}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        trigger
      )}
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={ptBR}
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (date) onChange(format(date, "yyyy-MM-dd"));
            setOpen(false);
          }}
          initialFocus
          className="pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
