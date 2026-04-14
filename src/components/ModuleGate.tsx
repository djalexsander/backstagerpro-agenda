/**
 * ============================================================================
 * COMPONENTE: ModuleGate
 * ============================================================================
 *
 * Renderiza children apenas se a empresa do usuário possui o módulo ativo.
 * Oferece 3 modos de bloqueio:
 *
 * - "hide"    → não renderiza nada (padrão, ideal para itens de menu)
 * - "lock"    → renderiza um placeholder visual de módulo bloqueado
 * - "custom"  → renderiza o fallback fornecido via prop
 *
 * Uso:
 *   <ModuleGate featureKey="financeiro_avancado">
 *     <FinanceiroAvancado />
 *   </ModuleGate>
 *
 *   <ModuleGate featureKey="relatorios" mode="lock">
 *     <Relatorios />
 *   </ModuleGate>
 */

import React from "react";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useAuth } from "@/contexts/AuthContext";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ModuleKey } from "@/constants/module-keys";

interface ModuleGateProps {
  /** feature_key do módulo requerido */
  featureKey: ModuleKey | string;
  /** Comportamento quando o módulo não está ativo */
  mode?: "hide" | "lock" | "custom";
  /** Fallback customizado (usado quando mode="custom") */
  fallback?: React.ReactNode;
  /** Conteúdo protegido */
  children: React.ReactNode;
}

export function ModuleGate({
  featureKey,
  mode = "hide",
  fallback,
  children,
}: ModuleGateProps) {
  const { hasModule, isLoading } = useCompanyModules();
  const { isMasterAdmin } = useAuth();

  // Master admin sempre tem acesso total
  if (isMasterAdmin) return <>{children}</>;

  // Enquanto carrega, não bloqueia (evita flash)
  if (isLoading) return null;

  // Se o módulo está ativo, renderiza normalmente
  if (hasModule(featureKey)) return <>{children}</>;

  // Módulo inativo — aplica bloqueio
  switch (mode) {
    case "hide":
      return null;

    case "lock":
      return <ModuleLockedPlaceholder featureKey={featureKey} />;

    case "custom":
      return <>{fallback ?? null}</>;

    default:
      return null;
  }
}

/**
 * Placeholder visual para módulos bloqueados.
 * Exibido quando mode="lock".
 */
function ModuleLockedPlaceholder({ featureKey }: { featureKey: string }) {
  return (
    <Card className="border-dashed border-muted-foreground/30">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-muted-foreground mb-1">
          Módulo não disponível
        </h3>
        <p className="text-sm text-muted-foreground/70 max-w-sm">
          Este recurso requer um módulo adicional. Acesse{" "}
          <a href="/plano" className="underline text-primary">
            Plano &amp; Assinatura
          </a>{" "}
          para mais informações.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Hook simples para verificação inline de módulo.
 * Alternativa ao componente quando se precisa de lógica condicional.
 *
 * Uso:
 *   const { canAccess } = useModuleAccess("financeiro_avancado");
 *   if (canAccess) { ... }
 */
export function useModuleAccess(featureKey: ModuleKey | string) {
  const { hasModule, isLoading } = useCompanyModules();
  const { isMasterAdmin } = useAuth();

  return {
    canAccess: isMasterAdmin || hasModule(featureKey),
    isLoading,
  };
}
