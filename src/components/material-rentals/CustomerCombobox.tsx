import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listRentalCustomers } from "@/lib/material-rental-service";
import type { CustomerOption } from "@/lib/material-rental-types";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 20;

function customerLabel(customer: CustomerOption) {
  return customer.nome_fantasia || customer.nome;
}

// CPF/CNPJ, telefone ou e-mail - o primeiro disponível ajuda a diferenciar
// clientes com nomes parecidos. Se nenhum existir mas o rótulo principal já
// usou o nome fantasia, cai para a razão social/nome completo.
function customerHint(customer: CustomerOption) {
  if (customer.cpf_cnpj) return customer.cpf_cnpj;
  if (customer.telefone) return customer.telefone;
  if (customer.email) return customer.email;
  return customer.nome_fantasia ? customer.nome : null;
}

export function CustomerCombobox({
  companyId,
  customers,
  selected,
  onSelect,
  onCreateNew,
  disabled,
}: {
  companyId: string;
  customers: CustomerOption[];
  selected: CustomerOption | null;
  onSelect: (customer: CustomerOption) => void;
  onCreateNew?: (typedText: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  // Começa cada abertura sem busca, mostrando a lista já carregada em vez de
  // repetir o texto da última vez que o campo foi usado.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const searchQuery = useQuery({
    queryKey: ["rental-customers-search", companyId, debouncedSearch, RESULT_LIMIT],
    queryFn: () => listRentalCustomers(companyId, debouncedSearch, RESULT_LIMIT),
    enabled: open && debouncedSearch.length > 0,
    staleTime: 30_000,
  });

  // Sem busca: reaproveita a lista já carregada pela página (mesma query key
  // "rental-customers" do hook useMaterialRentals) - zero requisição extra
  // ao só abrir o campo. Com busca: pesquisa server-side (nome, fantasia,
  // CPF/CNPJ, telefone, e-mail), limitada e debounced.
  const results = debouncedSearch ? (searchQuery.data ?? []) : customers.slice(0, RESULT_LIMIT);
  const isSearching = debouncedSearch.length > 0 && searchQuery.isFetching;
  const hasMore = !debouncedSearch && customers.length > RESULT_LIMIT;
  const trimmedTyped = search.trim();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Cliente"
          disabled={disabled}
          className="h-10 w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? customerLabel(selected) : "Buscar cliente..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Nome, CPF/CNPJ, telefone ou e-mail..."
            aria-label="Buscar cliente"
            autoFocus
          />
          <CommandList>
            {isSearching && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
              </div>
            )}
            {!isSearching && results.length === 0 && (
              <CommandEmpty className="space-y-2 px-4 py-6 text-center text-sm">
                <p className="text-muted-foreground">Nenhum cliente encontrado.</p>
                {onCreateNew && trimmedTyped && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      onCreateNew(trimmedTyped);
                      setOpen(false);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Cadastrar novo cliente
                  </Button>
                )}
              </CommandEmpty>
            )}
            {!isSearching && results.length > 0 && (
              <CommandGroup>
                {results.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    value={customer.id}
                    onSelect={() => {
                      onSelect(customer);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", selected?.id === customer.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{customerLabel(customer)}</span>
                      {customerHint(customer) && (
                        <span className="truncate text-xs text-muted-foreground">{customerHint(customer)}</span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {hasMore && !isSearching && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                Mostrando {RESULT_LIMIT} de {customers.length}+ clientes · digite para refinar a busca.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
