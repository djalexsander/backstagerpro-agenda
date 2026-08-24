import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RentalWithdrawalPanel } from "@/components/material-rentals/RentalWithdrawalPanel";
import { getRentalActions, RENTAL_STATUS_LABELS } from "@/lib/material-rental-domain";
import { getMaterialRental } from "@/lib/material-rental-service";
import type { RentalPermissions } from "@/lib/material-rental-permissions";
import type { CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import type { StockLocation } from "@/lib/stock-types";

// Versão operacional (sem dados comerciais) de RentalDetailDialog, para uso
// exclusivo dentro de Check-in/Check-out > Locações. Reaproveita
// RentalWithdrawalPanel - a mesma UI e as mesmas RPCs de retirada/devolução
// (registrar_retirada_locacao_material/registrar_devolucao_locacao_material)
// usadas pelo modal comercial em Locacoes.tsx - mas nunca busca nem exibe
// valor_total, valor_unitario, subtotal, desconto, recebido, a receber,
// parcelas, vencimentos ou estornos: este componente nem importa
// financial-ledger-service/financial-ledger-types.
export function RentalWithdrawalDialog({
  open,
  onOpenChange,
  companyId,
  rentalId,
  permissions,
  locations,
  responsibles,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  rentalId: string | null;
  permissions: RentalPermissions;
  locations: StockLocation[];
  responsibles: CustodyResponsibleOption[];
  onChanged: () => Promise<void> | void;
}) {
  const detailQuery = useQuery({
    queryKey: ["material-rental-detail", companyId, rentalId],
    queryFn: () => getMaterialRental(companyId, rentalId!),
    enabled: open && Boolean(rentalId),
  });
  const rental = detailQuery.data;
  const actions = rental ? getRentalActions(rental) : null;

  const refresh = async () => {
    await detailQuery.refetch();
    await onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rental ? `${rental.numero} · ${rental.cliente.nome_fantasia || rental.cliente.nome}` : "Retirada / devolução de locação"}</DialogTitle>
          <DialogDescription>Retirada e devolução física dos materiais desta locação.</DialogDescription>
        </DialogHeader>
        {detailQuery.isLoading && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {detailQuery.error && <p className="text-destructive">{detailQuery.error instanceof Error ? detailQuery.error.message : "Falha ao carregar."}</p>}
        {rental && actions && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Status</p><Badge variant={rental.atrasada ? "destructive" : "secondary"}>{rental.atrasada ? "Atrasada · " : ""}{RENTAL_STATUS_LABELS[rental.status]}</Badge></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Período</p><p className="text-sm font-medium">{new Date(rental.retirada_prevista_em).toLocaleString("pt-BR")}<br />até {new Date(rental.devolucao_prevista_em).toLocaleString("pt-BR")}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Responsável</p><p className="font-medium">{rental.responsavel_nome}</p></CardContent></Card>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="p-3">Material</th><th>Contratado</th><th>Retirado</th><th>Pendente retirada</th><th>Devolvido</th><th>Com cliente</th>
                  </tr>
                </thead>
                <tbody>
                  {rental.itens.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="p-3"><strong>{item.material.nome}</strong><br /><span className="text-xs text-muted-foreground">{item.material.codigo_interno}</span></td>
                      <td>{item.quantidade_contratada}</td>
                      <td>{item.quantidade_retirada}</td>
                      <td>{item.quantidade_pendente_retirada}</td>
                      <td>{item.quantidade_devolvida}</td>
                      <td>{item.quantidade_com_cliente}</td>
                    </tr>
                  ))}
                  {!rental.itens.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Esta locação não possui materiais.</td></tr>}
                </tbody>
              </table>
            </div>

            <RentalWithdrawalPanel
              companyId={companyId}
              rental={rental}
              actions={actions}
              permissions={permissions}
              locations={locations}
              responsibles={responsibles}
              onRefresh={refresh}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
