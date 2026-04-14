/**
 * Constantes de categorias e badges comerciais para módulos.
 */

export const MODULE_CATEGORIES = [
  { value: "operacional", label: "Operacional", color: "text-blue-600" },
  { value: "financeiro", label: "Financeiro", color: "text-green-600" },
  { value: "gestao", label: "Gestão", color: "text-indigo-600" },
  { value: "capacidade", label: "Capacidade", color: "text-purple-600" },
  { value: "premium", label: "Premium", color: "text-amber-600" },
] as const;

export const MODULE_BADGES = [
  { value: "recomendado", label: "Recomendado", variant: "default" as const, className: "bg-primary text-primary-foreground" },
  { value: "mais_vendido", label: "Mais vendido", variant: "default" as const, className: "bg-green-600 text-white" },
  { value: "essencial", label: "Essencial", variant: "default" as const, className: "bg-blue-600 text-white" },
  { value: "upgrade_sugerido", label: "Upgrade sugerido", variant: "default" as const, className: "bg-amber-500 text-white" },
] as const;

export type ModuleCategory = (typeof MODULE_CATEGORIES)[number]["value"];
export type ModuleBadge = (typeof MODULE_BADGES)[number]["value"];

export function getCategoryLabel(cat: string): string {
  return MODULE_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}

export function getCategoryColor(cat: string): string {
  return MODULE_CATEGORIES.find((c) => c.value === cat)?.color ?? "text-muted-foreground";
}

export function getBadgeInfo(badge: string | null | undefined) {
  if (!badge) return null;
  return MODULE_BADGES.find((b) => b.value === badge) ?? null;
}
