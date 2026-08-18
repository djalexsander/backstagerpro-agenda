import { CalendarDays, Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  MATERIAL_STATUS_LABELS,
  type MaterialWithRelations,
} from "@/lib/material-types";
import { formatBrazilianCurrency } from "@/lib/material-domain";
import { MaterialPhotoGallery } from "./MaterialPhotoGallery";
import { MaterialPhotoImage } from "./MaterialPhotoImage";
import { MaterialIdentificationCard } from "./MaterialIdentificationCard";
import { MaterialRfidSection } from "./MaterialRfidSection";
import { getMaterialStockSnapshot } from "@/lib/stock-service";
import { STOCK_MOVEMENT_LABELS } from "@/lib/stock-domain";
import { getMaterialMaintenanceSummary } from "@/lib/equipment-maintenance-service";

function Detail({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(withTime ? value : `${value}T12:00:00`));
}

function MaterialStockSection({
  material,
  companyId,
  canViewStock,
  canManageStock,
}: {
  material: MaterialWithRelations;
  companyId: string | null;
  canViewStock: boolean;
  canManageStock: boolean;
}) {
  const enabled = !!companyId && canViewStock;
  const { data, isLoading } = useQuery({
    queryKey: ["material-stock-snapshot", companyId, material.id],
    queryFn: () => getMaterialStockSnapshot(companyId!, material.id),
    enabled,
  });
  if (!enabled) return null;
  return (
    <>
      <Separator />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Estoque</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Detail
              label="Saldo consolidado"
              value={`${material.quantidade} ${material.unidade_medida}`}
            />
            <Detail label="Estoque mínimo" value={material.estoque_minimo} />
            <Detail
              label="Situação"
              value={
                material.quantidade === 0
                  ? "Sem saldo"
                  : material.quantidade <= material.estoque_minimo
                    ? "Abaixo do mínimo"
                    : "Normal"
              }
            />
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              Saldo por localização
            </p>
            <div className="flex flex-wrap gap-2">
              {isLoading && <span className="text-sm">Carregando…</span>}
              {data?.balances.map((balance) => (
                <Badge key={balance.id} variant="outline">
                  {balance.localizacao?.nome ?? "Localização"}: {balance.quantidade}
                </Badge>
              ))}
              {!isLoading && !data?.balances.length && (
                <span className="text-sm text-muted-foreground">
                  Nenhuma localização com saldo.
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              Movimentações recentes
            </p>
            <div className="space-y-2">
              {data?.movements.map((movement) => (
                <div
                  key={movement.id}
                  className="flex items-center justify-between rounded-md border p-2 text-sm"
                >
                  <span>
                    {STOCK_MOVEMENT_LABELS[movement.tipo_movimentacao]} ·{" "}
                    {movement.quantidade}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(movement.data_efetiva, true)}
                  </span>
                </div>
              ))}
              {!isLoading && !data?.movements.length && (
                <span className="text-sm text-muted-foreground">
                  Nenhuma movimentação registrada.
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link
                to={`/estoque?empresa=${companyId}&material=${material.id}&tab=historico`}
              >
                Abrir histórico
              </Link>
            </Button>
            {canManageStock && (
              <Button asChild size="sm">
                <Link to={`/estoque?empresa=${companyId}&material=${material.id}`}>
                  Movimentar estoque
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function MaterialMaintenanceSection({ material, companyId, enabled }: { material: MaterialWithRelations; companyId: string | null; enabled: boolean }) {
  const summary = useQuery({ queryKey: ["material-maintenance-summary", companyId, material.id],
    queryFn: () => getMaterialMaintenanceSummary(companyId!, material.id), enabled: Boolean(companyId && enabled) });
  if (!enabled) return null;
  return <><Separator /><Card><CardHeader className="pb-2"><CardTitle className="text-base">Manutenção</CardTitle></CardHeader><CardContent className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-4"><Detail label="Manutenção ativa" value={summary.data?.manutencoes_ativas ? `${summary.data.quantidade_indisponivel} indisponível(is)` : "Não"} /><Detail label="Histórico" value={`${summary.data?.historico_total ?? 0} ordem(ns)`} /><Detail label="Próxima preventiva" value={formatDate(summary.data?.proxima_preventiva_em)} /><Detail label="Custo acumulado" value={formatBrazilianCurrency(summary.data?.custo_acumulado ?? 0)} /></div>
    <Button asChild size="sm" variant="outline"><Link to={`/manutencoes?material=${material.id}`}>Ver manutenções</Link></Button>
  </CardContent></Card></>;
}

export function MaterialDetailsDialog({
  material,
  open,
  onOpenChange,
  canGenerateIdentification = false,
  companyId,
  canViewStock = false,
  canManageStock = false,
  canViewMaintenance = false,
  canPrintLabels = false,
  canViewRfid = false,
  canManageRfid = false,
  onChanged,
}: {
  material: MaterialWithRelations | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canGenerateIdentification?: boolean;
  companyId: string | null;
  canViewStock?: boolean;
  canManageStock?: boolean;
  canViewMaintenance?: boolean;
  canPrintLabels?: boolean;
  canViewRfid?: boolean;
  canManageRfid?: boolean;
  onChanged: () => Promise<void>;
}) {
  if (!material) return null;
  const mainPhoto =
    material.fotos.find((photo) => photo.foto_principal) ?? material.fotos[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            {material.nome}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          <div className="space-y-3">
            <MaterialPhotoImage
              path={mainPhoto?.storage_path}
              alt={material.nome}
              className="aspect-square w-full rounded-xl border"
            />
            <div className="flex flex-wrap gap-2">
              <Badge>{MATERIAL_STATUS_LABELS[material.status_operacional]}</Badge>
              <Badge variant={material.ativo ? "outline" : "secondary"}>
                {material.ativo ? "Ativo" : "Inativo"}
              </Badge>
              <Badge variant="outline">
                {material.tipo_controle === "individual"
                  ? "Individual"
                  : "Por quantidade"}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Detail label="Código interno" value={material.codigo_interno} />
            <Detail label="Categoria" value={material.categoria?.nome} />
            <Detail
              label="Quantidade"
              value={`${material.quantidade} ${material.unidade_medida}`}
            />
            <Detail label="Marca" value={material.marca} />
            <Detail label="Modelo" value={material.modelo} />
            <Detail label="Número de série" value={material.numero_serie} />
            <Detail
              label="Patrimônio"
              value={material.numero_patrimonio}
            />
            <Detail
              label="Identificador técnico"
              value={
                material.identificador_unico ? (
                  <code className="text-xs">{material.identificador_unico}</code>
                ) : (
                  "Não aplicável"
                )
              }
            />
            <Detail
              label="Aquisição"
              value={formatBrazilianCurrency(material.valor_aquisicao)}
            />
            <Detail
              label="Reposição"
              value={formatBrazilianCurrency(material.valor_reposicao)}
            />
            <Detail
              label="Locação padrão"
              value={formatBrazilianCurrency(material.valor_locacao_padrao)}
            />
            <Detail
              label="Data de aquisição"
              value={formatDate(material.data_aquisicao)}
            />
            <Detail label="Fornecedor" value={material.fornecedor} />
            <Detail
              label="Criado em"
              value={
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDate(material.created_at, true)}
                </span>
              }
            />
            <Detail
              label="Atualizado em"
              value={formatDate(material.updated_at, true)}
            />
          </div>
        </div>

        <MaterialIdentificationCard
          material={material}
          canGenerate={canGenerateIdentification}
          onChanged={onChanged}
        />

        {canViewRfid && (
          <MaterialRfidSection
            material={material}
            companyId={companyId}
            canView={canViewRfid}
            canManage={canManageRfid}
          />
        )}

        <MaterialStockSection
          material={material}
          companyId={companyId}
          canViewStock={canViewStock}
          canManageStock={canManageStock}
        />
        <MaterialMaintenanceSection material={material} companyId={companyId} enabled={canViewMaintenance} />
        {canPrintLabels && <><Separator /><Button asChild size="sm" variant="outline"><Link to={`/etiquetas?material_id=${encodeURIComponent(material.id)}`}>Criar etiqueta</Link></Button></>}

        {(material.descricao || material.observacoes) && (
          <>
            <Separator />
            <div className="grid gap-4 md:grid-cols-2">
              <Detail label="Descrição" value={material.descricao} />
              <Detail label="Observações" value={material.observacoes} />
            </div>
          </>
        )}

        {material.justificativa_status && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Justificativa do status atual
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {material.justificativa_status}
            </CardContent>
          </Card>
        )}

        <Separator />
        <div className="space-y-3">
          <h3 className="font-semibold">Galeria</h3>
          <MaterialPhotoGallery
            photos={material.fotos}
            materialName={material.nome}
          />
        </div>

      </DialogContent>
    </Dialog>
  );
}
