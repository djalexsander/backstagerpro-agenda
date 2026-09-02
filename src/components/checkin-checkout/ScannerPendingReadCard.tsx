import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaterialPhotoImage } from "@/components/materials/MaterialPhotoImage";
import { ScannerOperationForm } from "@/components/checkin-checkout/ScannerOperationForm";
import {
  describePendingReadContext,
  type ScannerOperationContext,
  type ScannerPendingRead,
} from "@/lib/scanner-remoto-domain";
import type { SituacaoBadgeTone } from "@/lib/material-traceability-domain";
import type { CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import type { StockLocation } from "@/lib/stock-types";

// Mesmo mapeamento tom -> classe que RastreabilidadeMateriais.tsx usa no
// bloco "ONDE ESTÁ AGORA?"; neutro fica com o Badge padrão.
function badgeToneClass(tone: SituacaoBadgeTone): string | undefined {
  switch (tone) {
    case "success":
      return "bg-emerald-500 text-white";
    case "warning":
      return "bg-amber-500 text-white";
    case "destructive":
      return "bg-destructive text-destructive-foreground";
    default:
      return undefined;
  }
}

// E4/E4.5: painel read-only mostrado depois de identificar um material numa
// sessão automática neutra. NÃO movimenta nada - apresenta a situação/contexto
// atual (do resumo_situacao_material que a busca já trouxe), o operador
// escolhe CHECK-OUT/CHECK-IN (E4) e monta o contexto da operação (E4.5). A
// confirmação e a gravação real são E5/E6.
export function ScannerPendingReadCard({
  pendingRead,
  companyId,
  locations,
  responsibles,
  rentalModuleEnabled,
  canCheckout,
  canCheckin,
  onChooseOperation,
  onCancelOperation,
  onOperationReady,
  onEditOperation,
  onExecuteOperation,
  onClear,
}: {
  pendingRead: ScannerPendingRead;
  companyId: string;
  locations: StockLocation[];
  responsibles: CustodyResponsibleOption[];
  rentalModuleEnabled: boolean;
  canCheckout: boolean;
  canCheckin: boolean;
  onChooseOperation: (operation: "checkout" | "checkin") => void;
  onCancelOperation: () => void;
  onOperationReady: (context: ScannerOperationContext) => void;
  onEditOperation: () => void;
  onExecuteOperation: (context: ScannerOperationContext) => Promise<void>;
  onClear: () => void;
}) {
  const { material, resumo, selectedCustody, selectedOperation } = pendingRead;
  const context = describePendingReadContext(resumo, selectedCustody);
  const identifier =
    material.numero_patrimonio ||
    material.numero_serie ||
    material.codigo_barras ||
    material.codigo_interno;

  return (
    <Card className="border-primary/40">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Material identificado</CardTitle>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Cancelar leitura
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-3">
          <MaterialPhotoImage
            path={material.foto_path}
            alt={material.nome}
            className="h-16 w-16 shrink-0 rounded-md"
          />
          <div className="min-w-0">
            <p className="font-semibold">{material.nome}</p>
            <p className="text-sm text-muted-foreground">{identifier}</p>
          </div>
        </div>

        <div className="rounded-md border p-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Situação</span>
            <Badge className={badgeToneClass(context.tone)}>{context.headline}</Badge>
          </div>
          {context.lines.length > 0 && (
            <dl className="mt-2 space-y-1 text-sm">
              {context.lines.map((line) => (
                <div key={line.label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd className="text-right font-medium">{line.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {!selectedOperation && (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => onChooseOperation("checkout")}>
              Check-out
            </Button>
            <Button type="button" variant="outline" onClick={() => onChooseOperation("checkin")}>
              Check-in
            </Button>
          </div>
        )}

        {selectedOperation && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">
              {selectedOperation === "checkout" ? "Check-out" : "Check-in"}
            </p>
            <ScannerOperationForm
              pendingRead={pendingRead}
              companyId={companyId}
              locations={locations}
              responsibles={responsibles}
              rentalModuleEnabled={rentalModuleEnabled}
              canCheckout={canCheckout}
              canCheckin={canCheckin}
              onCancel={onCancelOperation}
              onConfirm={onOperationReady}
              onEditAgain={onEditOperation}
              onExecute={onExecuteOperation}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
