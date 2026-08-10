import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  applyPermissionToggle,
  groupPermissionRows,
  type ModulePermissionEntry,
  type PermissionAction,
} from "@/lib/user-module-permissions-service";

interface UserModulePermissionsFieldsProps {
  rows: ModulePermissionEntry[];
  onChange: (rows: ModulePermissionEntry[]) => void;
  isLoading?: boolean;
}

const ACTIONS: { key: PermissionAction; label: string }[] = [
  { key: "canView", label: "Visualizar" },
  { key: "canCreate", label: "Adicionar/Executar" },
  { key: "canEdit", label: "Editar" },
  { key: "canDelete", label: "Excluir" },
];

const GRID_COLUMNS = "grid-cols-[minmax(0,1fr)_repeat(4,minmax(2.75rem,1fr))]";

/** Checklist de permissões por módulo, agrupado nas mesmas 4 categorias do menu lateral. Controlado: `rows` já vem filtrado só com os módulos ativos (não-capacidade) da empresa (list_user_module_permissions / buildEmptyPermissionRows). */
export function UserModulePermissionsFields({ rows, onChange, isLoading }: UserModulePermissionsFieldsProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando permissões...</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta empresa não possui módulos ativos para configurar permissões.
      </p>
    );
  }

  const updateRow = (featureKey: string, action: PermissionAction, checked: boolean) => {
    onChange(
      rows.map((row) => (row.featureKey === featureKey ? applyPermissionToggle(row, action, checked) : row)),
    );
  };

  const setCategoryAll = (categoryRows: ModulePermissionEntry[], granted: boolean) => {
    const featureKeys = new Set(categoryRows.map((row) => row.featureKey));
    onChange(
      rows.map((row) =>
        featureKeys.has(row.featureKey)
          ? { ...row, canView: granted, canCreate: granted, canEdit: granted, canDelete: granted }
          : row,
      ),
    );
  };

  const categories = groupPermissionRows(rows);

  return (
    <div className="space-y-2 rounded-md border p-2">
      <p className="px-1 text-sm font-medium">Permissões por módulo</p>
      {categories.map((category) => {
        const open = !collapsedCategories[category.id];
        return (
          <Collapsible
            key={category.id}
            open={open}
            onOpenChange={(next) =>
              setCollapsedCategories((prev) => ({ ...prev, [category.id]: !next }))
            }
            className="rounded-sm border bg-muted/20"
            data-testid={`permission-category-${category.id}`}
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <CollapsibleTrigger className="flex flex-1 items-center gap-1.5 text-left text-sm font-medium">
                <ChevronDown
                  className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open ? "" : "-rotate-90")}
                />
                {category.label}
                <span className="text-xs font-normal text-muted-foreground">({category.rows.length})</span>
              </CollapsibleTrigger>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={() => setCategoryAll(category.rows, true)}
                >
                  Marcar todos
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={() => setCategoryAll(category.rows, false)}
                >
                  Limpar todos
                </Button>
              </div>
            </div>
            <CollapsibleContent className="border-t px-2 pb-2">
              <div className={cn("grid items-center gap-x-1 pt-1.5 text-center text-[10px] font-medium text-muted-foreground", GRID_COLUMNS)}>
                <span />
                {ACTIONS.map(({ key, label }) => (
                  <span key={key}>{label}</span>
                ))}
              </div>
              {category.rows.map((row) => (
                <div
                  key={row.featureKey}
                  className={cn("grid items-center gap-x-1 border-t py-1 first:border-t-0", GRID_COLUMNS)}
                >
                  <span className="pr-1 text-sm">{row.moduleName}</span>
                  {ACTIONS.map(({ key, label }) => (
                    <span key={key} className="flex justify-center">
                      <Checkbox
                        // Slightly bigger than the shadcn default (h-4 w-4): this grid has no
                        // adjacent text label anymore to enlarge the tap target like the old
                        // layout did, so the box itself needs to carry that on touch screens.
                        className="h-5 w-5"
                        checked={row[key]}
                        aria-label={`${label} - ${row.moduleName}`}
                        onCheckedChange={(checked) => updateRow(row.featureKey, key, checked === true)}
                      />
                    </span>
                  ))}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
