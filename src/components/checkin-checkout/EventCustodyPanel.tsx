import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ClipboardCheck, Loader2, PackageCheck, PackageOpen, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CheckinDialog } from "@/components/checkin-checkout/CheckinDialog";
import { getEventCustodyTotals, listEventCustodyMaterials } from "@/lib/checkin-checkout-service";
import {
  findPendingMaterialByCode,
  type EventCustodyMaterialSummary,
} from "@/lib/event-custody-domain";
import type { StockLocation } from "@/lib/stock-types";

const PAGE_SIZE = 10;
// Distinct materials per event is bounded by the venue's real equipment
// roster (unlike raw custody rows, which grow with every partial
// return/correction) - one capped, unpaginated fetch is enough to resolve a
// barcode/QR scan regardless of which display page/filter is active, same
// reasoning identifierQuery already relied on before this panel had display
// pagination.
const SCAN_PAGE_SIZE = 100;

function MaterialRow({
  item,
  badge,
  action,
}: {
  item: EventCustodyMaterialSummary;
  badge: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{item.materialNome}</p>
        <p className="text-xs text-muted-foreground">{item.materialCodigo}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="outline">{badge}</Badge>
        {action}
      </div>
    </div>
  );
}

function MaterialListPagination({
  page,
  total,
  onPageChange,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-2 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</Button>
      <span>{page} de {pages}</span>
      <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Próxima</Button>
    </div>
  );
}

// Conferência de retorno por evento: mostra o que foi retirado/devolvido/
// pendente para o evento selecionado (paginado e filtrado no servidor via
// listar_custodias_evento_por_material/obter_totais_custodia_evento - ver
// checkin-checkout-service.ts), e permite dar check-in direto de um material
// pendente, seja pelo botão "Fazer check-in" ou digitando/lendo o código do
// material (leitor USB/QR que emula teclado - ver findPendingMaterialByCode).
// Os dois caminhos resolvem para a mesma custódia (a mais antiga pendente) e
// abrem o mesmo CheckinDialog. Reaproveita o CheckinDialog e a RPC de
// check-in já existentes por inteiro (mesma validação de quantidade/pendente
// que a aba "Operações em aberto" já usa) - nenhuma lógica de check-in nova
// foi criada aqui. Câmera, Scanner Remoto e RFID/EPC por evento continuam
// fora de escopo.
export function EventCustodyPanel({
  companyId,
  canCheckin,
  locations,
}: {
  companyId: string;
  canCheckin: boolean;
  locations: StockLocation[];
}) {
  const [eventId, setEventId] = useState("");
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState("");
  const [pendingPage, setPendingPage] = useState(1);
  const [returnedPage, setReturnedPage] = useState(1);
  const [checkinOperation, setCheckinOperation] = useState<
    EventCustodyMaterialSummary["custodiasAbertas"][number] | null
  >(null);
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setPendingPage(1);
    setReturnedPage(1);
  }, [eventId, search, locationId]);

  const eventsQuery = useQuery({
    queryKey: ["checkin-checkout-events", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, date")
        .eq("empresa_id", companyId)
        .order("date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: Boolean(companyId),
  });
  const events = eventsQuery.data ?? [];

  const trimmedSearch = search.trim() || undefined;
  const activeLocationId = locationId || undefined;

  const totalsQuery = useQuery({
    queryKey: ["event-custody", companyId, eventId, "totals", trimmedSearch, activeLocationId],
    queryFn: () => getEventCustodyTotals(companyId, eventId, { search: trimmedSearch, locationId: activeLocationId }),
    enabled: Boolean(companyId) && Boolean(eventId),
  });

  const pendingQuery = useQuery({
    queryKey: ["event-custody", companyId, eventId, "materials", "pendente", pendingPage, trimmedSearch, activeLocationId],
    queryFn: () =>
      listEventCustodyMaterials(companyId, eventId, {
        pendente: true,
        page: pendingPage,
        pageSize: PAGE_SIZE,
        search: trimmedSearch,
        locationId: activeLocationId,
      }),
    enabled: Boolean(companyId) && Boolean(eventId),
  });

  const returnedQuery = useQuery({
    queryKey: ["event-custody", companyId, eventId, "materials", "devolvido", returnedPage, trimmedSearch, activeLocationId],
    queryFn: () =>
      listEventCustodyMaterials(companyId, eventId, {
        pendente: false,
        page: returnedPage,
        pageSize: PAGE_SIZE,
        search: trimmedSearch,
        locationId: activeLocationId,
      }),
    enabled: Boolean(companyId) && Boolean(eventId),
  });

  // Full (capped) pending set for the barcode/QR scan - deliberately NOT
  // filtered by search/locationId and NOT tied to pendingPage, so scanning
  // still resolves a material that the current display filter/page happens
  // to be hiding.
  const scanPendingQuery = useQuery({
    queryKey: ["event-custody", companyId, eventId, "materials-scan"],
    queryFn: () => listEventCustodyMaterials(companyId, eventId, { pendente: true, page: 1, pageSize: SCAN_PAGE_SIZE }),
    enabled: Boolean(companyId) && Boolean(eventId) && canCheckin,
  });
  const scanPendingMaterials = scanPendingQuery.data?.items ?? [];
  const pendingMaterialIds = scanPendingMaterials.map((item) => item.materialId);

  // identificador_unico não é exposto por listar_custodias_evento_por_material
  // (só o fallback material_identificador, que pode ser patrimônio/série/
  // código de barras) - por isso é resolvido aqui, direto contra materiais,
  // só para os materiais pendentes deste evento. Ver findPendingMaterialByCode.
  const identifierQuery = useQuery({
    queryKey: ["event-custody-material-identifiers", companyId, pendingMaterialIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materiais")
        .select("id, identificador_unico")
        .eq("empresa_id", companyId)
        .in("id", pendingMaterialIds);
      if (error) throw error;
      return data;
    },
    enabled: Boolean(companyId) && pendingMaterialIds.length > 0,
  });
  const identificadorUnicoPorMaterial = new Map(
    (identifierQuery.data ?? []).map((row) => [row.id, row.identificador_unico]),
  );

  const refreshAfterCheckin = async () => {
    await queryClient.invalidateQueries({ queryKey: ["event-custody", companyId, eventId] });
  };

  const handleScanSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const match = findPendingMaterialByCode(scanPendingMaterials, scanValue, identificadorUnicoPorMaterial);
    if (!match || match.custodiasAbertas.length === 0) {
      setScanError("Nenhum material pendente encontrado para este código.");
      return;
    }
    setScanError(null);
    setScanValue("");
    setCheckinOperation(match.custodiasAbertas[0]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="space-y-2">
            <Label>Evento</Label>
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder={eventsQuery.isLoading ? "Carregando eventos..." : "Selecione um evento"} />
              </SelectTrigger>
              <SelectContent>
                {events.map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {event.name} · {format(parseISO(event.date), "dd/MM/yyyy")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {eventId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Buscar material</Label>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nome ou código do material"
                />
              </div>
              <div className="space-y-1">
                <Label>Localização de saída</Label>
                <Select value={locationId || "todas"} onValueChange={(value) => setLocationId(value === "todas" ? "" : value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    {locations.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.codigo} · {item.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Mostra as custódias registradas com finalidade Evento vinculadas ao evento selecionado.
          </p>
        </CardContent>
      </Card>

      {!eventId && (
        <p className="p-4 text-center text-sm text-muted-foreground">
          Selecione um evento para ver os materiais retirados e pendentes de devolução.
        </p>
      )}

      {eventId && totalsQuery.isLoading && (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      )}

      {eventId && totalsQuery.error && (
        <p className="text-sm text-destructive">
          {totalsQuery.error instanceof Error ? totalsQuery.error.message : "Não foi possível carregar as custódias do evento."}
        </p>
      )}

      {eventId && totalsQuery.data && (
        <>
          {canCheckin && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <Label htmlFor="event-custody-scan">Check-in por código</Label>
                <form className="flex gap-2" onSubmit={handleScanSubmit}>
                  <Input
                    id="event-custody-scan"
                    autoFocus
                    value={scanValue}
                    onChange={(event) => {
                      setScanValue(event.target.value);
                      setScanError(null);
                    }}
                    placeholder="Digite ou leia o código do material"
                    autoComplete="off"
                  />
                  <Button type="submit" disabled={!scanValue.trim()}>
                    <ScanLine className="mr-1 h-4 w-4" /> Buscar
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground">
                  Scanners USB/Bluetooth funcionam como teclado: mantenha o cursor no campo e finalize com Enter.
                </p>
                {scanError && <p className="text-sm text-destructive">{scanError}</p>}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total retirado</p><p className="text-2xl font-bold">{totalsQuery.data.totalRetirado}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total devolvido</p><p className="text-2xl font-bold">{totalsQuery.data.totalDevolvido}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total pendente</p><p className="text-2xl font-bold">{totalsQuery.data.totalPendente}</p></CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PackageOpen className="h-4 w-4" /> Materiais pendentes
                  <Badge variant="secondary">{pendingQuery.data?.total ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingQuery.isLoading ? (
                  <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : pendingQuery.error ? (
                  <p className="p-4 text-center text-sm text-destructive">Não foi possível carregar os materiais pendentes.</p>
                ) : !pendingQuery.data?.items.length ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">Nenhum material pendente.</p>
                ) : (
                  pendingQuery.data.items.map((item) => (
                    <MaterialRow
                      key={item.materialId}
                      item={item}
                      badge={`${item.quantidadePendente} pendente(s) de ${item.quantidadeRetirada}`}
                      action={
                        canCheckin && item.custodiasAbertas.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCheckinOperation(item.custodiasAbertas[0])}
                          >
                            <ClipboardCheck className="mr-1 h-4 w-4" /> Fazer check-in
                          </Button>
                        )
                      }
                    />
                  ))
                )}
                <MaterialListPagination page={pendingPage} total={pendingQuery.data?.total ?? 0} onPageChange={setPendingPage} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PackageCheck className="h-4 w-4" /> Materiais totalmente devolvidos
                  <Badge variant="secondary">{returnedQuery.data?.total ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {returnedQuery.isLoading ? (
                  <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : returnedQuery.error ? (
                  <p className="p-4 text-center text-sm text-destructive">Não foi possível carregar os materiais devolvidos.</p>
                ) : !returnedQuery.data?.items.length ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">Nenhum material devolvido ainda.</p>
                ) : (
                  returnedQuery.data.items.map((item) => (
                    <MaterialRow
                      key={item.materialId}
                      item={item}
                      badge={`${item.quantidadeRetirada} devolvido(s)`}
                    />
                  ))
                )}
                <MaterialListPagination page={returnedPage} total={returnedQuery.data?.total ?? 0} onPageChange={setReturnedPage} />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <CheckinDialog
        open={!!checkinOperation}
        onOpenChange={(open) => !open && setCheckinOperation(null)}
        companyId={companyId}
        operation={checkinOperation}
        locations={locations}
        onSaved={refreshAfterCheckin}
      />
    </div>
  );
}
