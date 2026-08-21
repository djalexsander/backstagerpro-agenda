import { FormEvent, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  History,
  Loader2,
  MapPin,
  Package,
  Route as RouteIcon,
  ScanLine,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { MaterialPhotoImage } from "@/components/materials/MaterialPhotoImage";
import { MaterialQrScanner } from "@/components/materials/MaterialQrScanner";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useModulePermission } from "@/hooks/useModulePermission";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getTraceabilityPermissions } from "@/lib/material-traceability-permissions";
import { getMaterialTraceability, searchMaterialTraceability } from "@/lib/material-traceability-service";
import type {
  MaterialTraceabilityDetail,
  TraceabilitySituacao,
  TraceabilityTimelineEntry,
} from "@/lib/material-traceability-types";
import {
  buildOndeEstaAgoraSummary,
  describeTimelineEntry,
  formatDateTime,
  situacaoBadgeTone,
  TIMELINE_ENTRY_LABELS,
  TRACEABILITY_SITUACAO_LABELS,
  type SituacaoBadgeTone,
} from "@/lib/material-traceability-domain";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

function toneClass(tone: SituacaoBadgeTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500 text-white";
    case "warning":
      return "bg-amber-500 text-white";
    case "destructive":
      return "bg-destructive text-destructive-foreground";
    default:
      return "";
  }
}

function resultSummaryLine(resumo: TraceabilitySituacao): string {
  switch (resumo.situacao) {
    case "disponivel":
      return "Disponível";
    case "locado":
    case "emprestado":
      if (resumo.locacao) return `${TRACEABILITY_SITUACAO_LABELS[resumo.situacao]} — ${resumo.locacao.cliente_nome}`;
      if (resumo.evento) return `${TRACEABILITY_SITUACAO_LABELS[resumo.situacao]} — ${resumo.evento.evento_nome}`;
      return `${TRACEABILITY_SITUACAO_LABELS[resumo.situacao]} — ${resumo.retirado_por}`;
    case "em_manutencao":
      return `Em manutenção — OS ${resumo.manutencao_numero}`;
    default:
      return TRACEABILITY_SITUACAO_LABELS[resumo.situacao];
  }
}

function TimelineRow({ entry }: { entry: TraceabilityTimelineEntry }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-muted py-2 pl-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{TIMELINE_ENTRY_LABELS[entry.tipo]}</Badge>
        <span className="text-xs text-muted-foreground">{formatDateTime(entry.data)}</span>
      </div>
      <p className="text-sm">{describeTimelineEntry(entry)}</p>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function MaterialDetail({
  detail,
  onBack,
  showBack,
}: {
  detail: MaterialTraceabilityDetail;
  onBack: () => void;
  showBack: boolean;
}) {
  const { material, resumo, timeline, permissoes, rfid_tags } = detail;
  const onde = buildOndeEstaAgoraSummary(resumo);
  const tone = situacaoBadgeTone(resumo.situacao);
  const activeTag = (rfid_tags ?? []).find((tag) => tag.status === "ativa") ?? null;
  const missingModules = [
    !permissoes.custodia && "Check-in / Check-out",
    !permissoes.locacao && "Locação de Materiais",
    !permissoes.manutencao && "Manutenção de Equipamentos",
  ].filter((label): label is string => Boolean(label));

  return (
    <div className="space-y-4">
      {showBack && (
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar aos resultados
        </Button>
      )}

      <Card className="border-primary/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-5 w-5" /> Onde está agora?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge className={toneClass(tone)}>{onde.headline.toUpperCase()}</Badge>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {onde.linhas.map((linha) => (
              <DetailField key={linha.label} label={linha.label} value={linha.value} />
            ))}
          </div>
          {resumo.situacao === "locado" && resumo.locacao && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/locacoes?locacao=${resumo.locacao.locacao_id}`}>Abrir locação {resumo.locacao.locacao_numero}</Link>
            </Button>
          )}
          {resumo.situacao === "emprestado" && resumo.evento && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/evento/${resumo.evento.evento_id}`}>Abrir evento {resumo.evento.evento_nome}</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-5 w-5" /> Dados do material
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <MaterialPhotoImage path={material.foto_path} alt={material.nome} className="h-20 w-20 shrink-0 rounded-md" />
          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField label="Nome" value={material.nome} />
            <DetailField label="Código interno" value={material.codigo_interno} />
            <DetailField label="Categoria" value={material.categoria_nome} />
            <DetailField label="Patrimônio" value={material.numero_patrimonio} />
            <DetailField label="Série" value={material.numero_serie} />
            <DetailField label="Código de barras" value={material.codigo_barras} />
            <DetailField label="Marca / Modelo" value={[material.marca, material.modelo].filter(Boolean).join(" / ") || null} />
            <DetailField label="Unidade" value={material.unidade_medida} />
            {activeTag && (
              <DetailField
                label="Tag RFID ativa"
                value={activeTag.epc}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-5 w-5" /> Timeline / Histórico
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma movimentação registrada para este material.</p>
          ) : (
            <div className="space-y-1">
              {timeline.map((entry, index) => (
                <TimelineRow key={`${entry.tipo}-${entry.data}-${index}`} entry={entry} />
              ))}
            </div>
          )}
          {missingModules.length > 0 && (
            <>
              <Separator className="my-3" />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" />
                Histórico pode estar incompleto: módulo(s) {missingModules.join(", ")} não ativo(s) para esta empresa.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function RastreabilidadeMateriais() {
  const { role, empresaId: companyId, isMasterAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const { hasModule, isLoading: loadingModules } = useCompanyModules(companyId);
  const moduleEnabled = hasModule(MODULE_KEYS.GESTAO_MATERIAIS);
  const { permission: granular } = useModulePermission({
    companyId,
    featureKey: MODULE_KEYS.GESTAO_MATERIAIS,
    role,
  });
  const permissions = getTraceabilityPermissions({
    role,
    moduleEnabled,
    companySelected: Boolean(companyId),
    granular: granular ? { canView: granular.canView } : null,
  });

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [offset, setOffset] = useState(0);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    setOffset(0);
    setSelectedMaterialId(null);
  }, [debouncedQuery]);

  const searchEnabled = Boolean(companyId && permissions.visualizar && debouncedQuery);
  const searchQuery = useQuery({
    queryKey: ["material-traceability-search", companyId, debouncedQuery, offset],
    queryFn: () => searchMaterialTraceability(companyId!, debouncedQuery, { limit: PAGE_SIZE, offset }),
    enabled: searchEnabled,
  });

  // Um único resultado -> abre a rastreabilidade completa direto, sem clique
  // extra (pedido explícito: "o sistema me mostrar imediatamente").
  useEffect(() => {
    const items = searchQuery.data?.items ?? [];
    if (debouncedQuery && searchQuery.data?.total === 1 && items.length === 1) {
      setSelectedMaterialId(items[0].id);
    }
  }, [searchQuery.data, debouncedQuery]);

  const detailQuery = useQuery({
    queryKey: ["material-traceability-detail", companyId, selectedMaterialId],
    queryFn: () => getMaterialTraceability(companyId!, selectedMaterialId!),
    enabled: Boolean(companyId && permissions.visualizar && selectedMaterialId),
  });

  const executeSearch = (eventOrValue?: FormEvent | string) => {
    const explicitValue = typeof eventOrValue === "string" ? eventOrValue : undefined;
    if (typeof eventOrValue !== "string") eventOrValue?.preventDefault();
    if (explicitValue === undefined) return;
    setQuery(explicitValue);
    setDebouncedQuery(explicitValue.trim());
  };

  const handleQrDetected = (code: string) => {
    executeSearch(code);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!companyId) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Rastreabilidade de Materiais</h1>
          <p className="text-muted-foreground">
            {isMasterAdmin
              ? "Sua conta master não está vinculada a uma empresa operacional."
              : "Nenhuma empresa vinculada à sua conta."}
          </p>
        </div>
      </div>
    );
  }

  if (!loadingModules && !permissions.visualizar) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Rastreabilidade de Materiais</h1>
          <p className="text-muted-foreground">Você não tem permissão para consultar esta tela.</p>
        </div>
        <Card className="border-amber-500/50">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Rastreabilidade de Materiais faz parte de Gestão de Materiais. Peça a um administrador da empresa para conceder
            acesso de visualização em Usuários.
          </CardContent>
        </Card>
      </div>
    );
  }

  const results = searchQuery.data?.items ?? [];
  const total = searchQuery.data?.total ?? 0;
  const showList = Boolean(debouncedQuery) && !selectedMaterialId && results.length > 0 && total !== 1;
  const showBackToList = total > 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <RouteIcon className="h-6 w-6" /> Rastreabilidade de Materiais
        </h1>
        <p className="text-muted-foreground">
          Onde está, para quem foi, quem retirou e quando volta — tudo a partir de um único ponto de busca.
        </p>
      </div>

      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" /> Buscar material
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={executeSearch}>
            <Input
              ref={inputRef}
              autoFocus
              className="h-12 text-base"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome, código, patrimônio, série, QR, código de barras ou EPC RFID"
              autoComplete="off"
            />
            <Button type="button" variant="outline" className="h-12" onClick={() => setCameraOpen(true)}>
              <Camera className="mr-2 h-4 w-4" /> Ler com a câmera
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            A busca acontece automaticamente enquanto você digita. Scanners USB/Bluetooth funcionam como teclado: mantenha o
            cursor no campo. Em celulares e tablets, use "Ler com a câmera".
          </p>
        </CardContent>
      </Card>

      {searchQuery.isFetching && !searchQuery.data && (
        <div className="flex justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {searchQuery.error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive">
            {searchQuery.error instanceof Error ? searchQuery.error.message : "Não foi possível buscar materiais."}
          </CardContent>
        </Card>
      )}

      {debouncedQuery && !searchQuery.isFetching && total === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhum material encontrado para "{debouncedQuery}".
          </CardContent>
        </Card>
      )}

      {showList && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Resultados ({total})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {results.map((material) => (
              <button
                key={material.id}
                type="button"
                onClick={() => setSelectedMaterialId(material.id)}
                className="flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent"
              >
                <MaterialPhotoImage path={material.foto_path} alt={material.nome} className="h-12 w-12 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{material.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {material.codigo_interno}
                    {material.numero_patrimonio ? ` · ${material.numero_patrimonio}` : ""}
                  </p>
                </div>
                <Badge className={toneClass(situacaoBadgeTone(material.resumo.situacao))}>
                  {resultSummaryLine(material.resumo)}
                </Badge>
              </button>
            ))}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-end gap-2 pt-2 text-sm">
                <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>
                  Anterior
                </Button>
                <span>
                  {Math.floor(offset / PAGE_SIZE) + 1} de {Math.ceil(total / PAGE_SIZE)}
                </span>
                <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((current) => current + PAGE_SIZE)}>
                  Próxima
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {detailQuery.isFetching && !detailQuery.data && (
        <div className="flex justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      {detailQuery.error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive">
            {detailQuery.error instanceof Error ? detailQuery.error.message : "Não foi possível abrir a rastreabilidade deste material."}
          </CardContent>
        </Card>
      )}
      {detailQuery.data && (
        <MaterialDetail
          detail={detailQuery.data}
          showBack={showBackToList}
          onBack={() => setSelectedMaterialId(null)}
        />
      )}

      <MaterialQrScanner open={cameraOpen} onOpenChange={setCameraOpen} onDetected={handleQrDetected} />
    </div>
  );
}
