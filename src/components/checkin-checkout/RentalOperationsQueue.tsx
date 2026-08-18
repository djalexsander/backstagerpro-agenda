import { AlertTriangle, CalendarClock, Loader2, PackageOpen, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMaterialRentals } from "@/hooks/useMaterialRentals";
import { computeRentalOperationalQueue } from "@/lib/rental-operations-domain";
import { RENTAL_STATUS_LABELS } from "@/lib/material-rental-domain";
import type { RentalFilters, RentalListItem } from "@/lib/material-rental-types";
import type { RentalPermissions } from "@/lib/material-rental-permissions";

// Fila operacional cabe inteira em uma página larga: não existe (nem deveria
// existir) uma RPC dedicada só para isto - listMaterialRentals já devolve
// tudo que é preciso, e o agrupamento em baldes é puramente client-side (ver
// rental-operations-domain.ts). Mesmo padrão de "buscar tudo em uma
// página grande" já usado pelo seletor de locação de RfidConferencia.tsx.
const QUEUE_PAGE_SIZE = 200;
const EMPTY_QUEUE_FILTERS: RentalFilters = {
  search: "",
  status: "todos",
  customerId: "",
  dateFrom: "",
  dateTo: "",
  overdueOnly: false,
  responsible: "",
};

function RentalCard({ rental, onSelect }: { rental: RentalListItem; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(rental.id)}
      className="w-full rounded-md border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{rental.numero}</span>
        <Badge variant={rental.atrasada ? "destructive" : "outline"}>
          {rental.atrasada ? "Atrasada" : RENTAL_STATUS_LABELS[rental.status]}
        </Badge>
      </div>
      <p className="mt-1 text-sm">{rental.cliente_nome_fantasia || rental.cliente_nome}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Retirada {new Date(rental.retirada_prevista_em).toLocaleString("pt-BR")} · Devolução{" "}
        {new Date(rental.devolucao_prevista_em).toLocaleString("pt-BR")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {rental.quantidade_itens} item(ns) · {rental.quantidade_retirada} retirado · {rental.quantidade_devolvida} devolvido ·{" "}
        {rental.quantidade_com_cliente} com cliente
      </p>
    </button>
  );
}

function QueueSection({
  title,
  icon: Icon,
  rentals,
  emptyLabel,
  onSelect,
}: {
  title: string;
  icon: LucideIcon;
  rentals: RentalListItem[];
  emptyLabel: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
          <Badge variant="secondary">{rentals.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rentals.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          rentals.map((rental) => <RentalCard key={rental.id} rental={rental} onSelect={onSelect} />)
        )}
      </CardContent>
    </Card>
  );
}

export function RentalOperationsQueue({
  companyId,
  permissions,
  onSelect,
}: {
  companyId: string;
  permissions: RentalPermissions;
  onSelect: (rentalId: string) => void;
}) {
  const { rentals, isLoading, error } = useMaterialRentals({
    companyId,
    page: 1,
    pageSize: QUEUE_PAGE_SIZE,
    filters: EMPTY_QUEUE_FILTERS,
    enabled: permissions.visualizar,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Falha ao carregar locações."}</p>;
  }

  const queue = computeRentalOperationalQueue(rentals.items);

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
      <QueueSection title="Pendentes de retirada" icon={PackageOpen} rentals={queue.pendingWithdrawal} emptyLabel="Nenhuma retirada pendente." onSelect={onSelect} />
      <QueueSection title="Pendentes de devolução" icon={RotateCcw} rentals={queue.pendingReturn} emptyLabel="Nenhuma devolução pendente." onSelect={onSelect} />
      <QueueSection title="Em andamento" icon={CalendarClock} rentals={queue.inProgress} emptyLabel="Nenhuma locação em andamento." onSelect={onSelect} />
      <QueueSection title="Atrasadas" icon={AlertTriangle} rentals={queue.overdue} emptyLabel="Nenhuma locação atrasada." onSelect={onSelect} />
    </div>
  );
}
