import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Eye,
  FilterX,
  FolderCog,
  Package,
  Pencil,
  Plus,
  Power,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useMaterials } from "@/hooks/useMaterials";
import { useAuth } from "@/contexts/AuthContext";
import {
  filterAndSortMaterials,
  paginateMaterials,
  type MaterialFilters,
} from "@/lib/material-filters";
import {
  MATERIAL_STATUS_LABELS,
  type MaterialOperationalStatus,
  type MaterialWithRelations,
} from "@/lib/material-types";
import { setMaterialActive } from "@/lib/material-service";
import { CategoryManager } from "@/components/materials/CategoryManager";
import { MaterialFormDialog } from "@/components/materials/MaterialFormDialog";
import { MaterialDetailsDialog } from "@/components/materials/MaterialDetailsDialog";
import { MaterialPhotoImage } from "@/components/materials/MaterialPhotoImage";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getMaterialPermissions } from "@/lib/material-permissions";

const PAGE_SIZE = 10;

const initialFilters: MaterialFilters = {
  search: "",
  categoryId: "todos",
  status: "todos",
  location: "",
  active: "ativos",
  sortField: "nome",
  sortDirection: "asc",
};

function statusBadgeClass(status: MaterialOperationalStatus) {
  if (status === "disponivel") return "bg-emerald-500 text-white";
  if (status === "em_manutencao") return "bg-amber-500 text-white";
  if (status === "avariado" || status === "extraviado") {
    return "bg-destructive text-destructive-foreground";
  }
  return "";
}

export default function Materiais() {
  const { toast } = useToast();
  const { role, empresaReadOnly, isMasterAdmin } = useAuth();
  const { hasModule } = useCompanyModules();
  const permissions = getMaterialPermissions({
    role,
    moduleEnabled:
      isMasterAdmin || hasModule(MODULE_KEYS.GESTAO_MATERIAIS),
    companyReadOnly: empresaReadOnly,
  });
  const canManage =
    permissions.criar ||
    permissions.editar ||
    permissions.inativar ||
    permissions.gerenciarCategorias ||
    permissions.gerenciarFotos ||
    permissions.alterarStatus ||
    permissions.gerarIdentificadores;
  const {
    empresaId,
    categories,
    materials,
    isLoading,
    error,
    invalidateMaterials,
    invalidateCategories,
  } = useMaterials();
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activeTarget, setActiveTarget] =
    useState<MaterialWithRelations | null>(null);

  const filtered = useMemo(
    () => filterAndSortMaterials(materials, filters),
    [materials, filters],
  );
  const pagination = useMemo(
    () => paginateMaterials(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => setPage(1), [filters]);
  useEffect(() => {
    if (pagination.page !== page) setPage(pagination.page);
  }, [page, pagination.page]);

  const editMaterial =
    materials.find((material) => material.id === editId) ?? null;
  const detailMaterial =
    materials.find((material) => material.id === detailId) ?? null;

  const activeMutation = useMutation({
    mutationFn: async (material: MaterialWithRelations) => {
      if (!empresaId) throw new Error("Empresa não identificada.");
      await setMaterialActive({
        empresaId,
        id: material.id,
        active: !material.ativo,
      });
    },
    onSuccess: async () => {
      await invalidateMaterials();
      toast({
        title: activeTarget?.ativo
          ? "Material inativado"
          : "Material reativado",
      });
      setActiveTarget(null);
    },
    onError: (mutationError: Error) =>
      toast({
        title: "Não foi possível alterar o material",
        description: mutationError.message,
        variant: "destructive",
      }),
  });

  const updateFilter = <K extends keyof MaterialFilters>(
    field: K,
    value: MaterialFilters[K],
  ) => setFilters((current) => ({ ...current, [field]: value }));

  const openCreate = () => {
    if (categories.every((category) => !category.ativo)) {
      toast({
        title: "Cadastre uma categoria ativa primeiro",
        variant: "destructive",
      });
      setCategoryOpen(true);
      return;
    }
    setEditId(null);
    setFormOpen(true);
  };

  const locations = [
    ...new Set(
      materials
        .map((material) => material.localizacao)
        .filter((value): value is string => !!value),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const renderActions = (material: MaterialWithRelations) => (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDetailId(material.id)}
        title="Visualizar"
      >
        <Eye className="h-4 w-4" />
      </Button>
      {canManage && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditId(material.id);
              setFormOpen(true);
            }}
            title="Editar"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={material.ativo ? "text-destructive" : "text-emerald-600"}
            onClick={() => setActiveTarget(material)}
            title={material.ativo ? "Inativar" : "Reativar"}
          >
            <Power className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );

  if (!empresaId && !isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          Nenhuma empresa ativa foi identificada para este usuário.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Package className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Materiais
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastro e controle dos materiais e equipamentos da empresa.
          </p>
        </div>
      {(permissions.gerenciarCategorias || permissions.criar) && (
          <div className="flex gap-2">
            {permissions.gerenciarCategorias && (
              <Button variant="outline" onClick={() => setCategoryOpen(true)}>
                <FolderCog className="mr-2 h-4 w-4" />
                Categorias
              </Button>
            )}
            {permissions.criar && (
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Cadastrar
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total", materials.length],
          ["Ativos", materials.filter((item) => item.ativo).length],
          [
            "Disponíveis",
            materials.filter(
              (item) => item.ativo && item.status_operacional === "disponivel",
            ).length,
          ],
          ["Categorias", categories.filter((item) => item.ativo).length],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="Nome, código, patrimônio, série, UUID, QR ou código de barras"
            />
          </div>
          <Select
            value={filters.categoryId}
            onValueChange={(value) => updateFilter("categoryId", value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as categorias</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.status}
            onValueChange={(value) =>
              updateFilter(
                "status",
                value as MaterialOperationalStatus | "todos",
              )
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {Object.entries(MATERIAL_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.location || "todas"}
            onValueChange={(value) =>
              updateFilter("location", value === "todas" ? "" : value)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Localização" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as localizações</SelectItem>
              {locations.map((location) => (
                <SelectItem key={location} value={location}>
                  {location}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.active}
            onValueChange={(value) =>
              updateFilter("active", value as MaterialFilters["active"])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativos">Somente ativos</SelectItem>
              <SelectItem value="inativos">Somente inativos</SelectItem>
              <SelectItem value="todos">Ativos e inativos</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Select
              value={filters.sortField}
              onValueChange={(value) =>
                updateFilter(
                  "sortField",
                  value as MaterialFilters["sortField"],
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nome">Ordenar por nome</SelectItem>
                <SelectItem value="codigo">Ordenar por código</SelectItem>
                <SelectItem value="categoria">Ordenar por categoria</SelectItem>
                <SelectItem value="quantidade">
                  Ordenar por quantidade
                </SelectItem>
                <SelectItem value="status">Ordenar por status</SelectItem>
                <SelectItem value="localizacao">
                  Ordenar por localização
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                updateFilter(
                  "sortDirection",
                  filters.sortDirection === "asc" ? "desc" : "asc",
                )
              }
              title="Inverter ordenação"
            >
              {filters.sortDirection === "asc" ? (
                <ArrowDownAZ className="h-4 w-4" />
              ) : (
                <ArrowUpAZ className="h-4 w-4" />
              )}
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() => setFilters(initialFilters)}
          >
            <FilterX className="mr-2 h-4 w-4" />
            Limpar filtros
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">
            Não foi possível carregar os materiais:{" "}
            {error instanceof Error ? error.message : "erro desconhecido"}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : pagination.rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            Nenhum material encontrado com os filtros atuais.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Foto</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Marca / Modelo</TableHead>
                  <TableHead>Qtd.</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.rows.map((material) => {
                  const mainPhoto =
                    material.fotos.find((photo) => photo.foto_principal) ??
                    material.fotos[0];
                  return (
                    <TableRow key={material.id}>
                      <TableCell>
                        <MaterialPhotoImage
                          path={mainPhoto?.storage_path}
                          alt={material.nome}
                          className="h-10 w-10 rounded"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {material.codigo_interno}
                      </TableCell>
                      <TableCell className="font-medium">
                        {material.nome}
                      </TableCell>
                      <TableCell>{material.categoria?.nome ?? "—"}</TableCell>
                      <TableCell>
                        {[material.marca, material.modelo]
                          .filter(Boolean)
                          .join(" / ") || "—"}
                      </TableCell>
                      <TableCell>
                        {material.quantidade} {material.unidade_medida}
                      </TableCell>
                      <TableCell>{material.localizacao || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          className={statusBadgeClass(
                            material.status_operacional,
                          )}
                          variant="secondary"
                        >
                          {
                            MATERIAL_STATUS_LABELS[
                              material.status_operacional
                            ]
                          }
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={material.ativo ? "outline" : "secondary"}
                        >
                          {material.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {renderActions(material)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 md:hidden">
            {pagination.rows.map((material) => {
              const mainPhoto =
                material.fotos.find((photo) => photo.foto_principal) ??
                material.fotos[0];
              return (
                <Card key={material.id}>
                  <CardContent className="flex gap-3 p-4">
                    <MaterialPhotoImage
                      path={mainPhoto?.storage_path}
                      alt={material.nome}
                      className="h-20 w-20 shrink-0 rounded-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{material.nome}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {material.codigo_interno}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {material.categoria?.nome ?? "Sem categoria"} ·{" "}
                        {material.quantidade} {material.unidade_medida}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge
                          className={statusBadgeClass(
                            material.status_operacional,
                          )}
                          variant="secondary"
                        >
                          {
                            MATERIAL_STATUS_LABELS[
                              material.status_operacional
                            ]
                          }
                        </Badge>
                        {!material.ativo && (
                          <Badge variant="secondary">Inativo</Badge>
                        )}
                      </div>
                      <div className="mt-2">{renderActions(material)}</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {pagination.pageCount > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Página {pagination.page} de {pagination.pageCount} ·{" "}
            {filtered.length} registro(s)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      {empresaId && canManage && (
        <>
          <CategoryManager
            open={categoryOpen}
            onOpenChange={setCategoryOpen}
            empresaId={empresaId}
            categories={categories}
            onChanged={invalidateCategories}
          />
          <MaterialFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            empresaId={empresaId}
            categories={categories}
            material={editMaterial}
            canGenerateIdentification={permissions.gerarIdentificadores}
            onSaved={async (materialId) => {
              await invalidateMaterials();
              setDetailId(materialId);
            }}
          />
        </>
      )}
      <MaterialDetailsDialog
        material={detailMaterial}
        open={!!detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        canGenerateIdentification={permissions.gerarIdentificadores}
        onChanged={invalidateMaterials}
      />

      <AlertDialog
        open={!!activeTarget}
        onOpenChange={(open) => !open && setActiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {activeTarget?.ativo ? "Inativar material?" : "Reativar material?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {activeTarget?.ativo
                ? "O material deixará de aparecer nos cadastros ativos, mas seu histórico e suas fotos serão preservados."
                : "O material voltará a aparecer na listagem de itens ativos."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={activeMutation.isPending}
              onClick={() => activeTarget && activeMutation.mutate(activeTarget)}
            >
              {activeMutation.isPending ? "Salvando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
