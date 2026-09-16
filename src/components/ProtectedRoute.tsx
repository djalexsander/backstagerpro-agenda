import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getSubscriptionRedirect } from "@/lib/access-control";
import { ModuleGate } from "@/components/ModuleGate";
import type { ModuleKey } from "@/constants/module-keys";

interface Props {
  children: React.ReactNode;
  adminOnly?: boolean;
  masterOnly?: boolean;
  skipPlanCheck?: boolean;
  /**
   * P2 (centralização de rotas): módulo(s) exigidos para esta rota. Aceita
   * uma lista para o mesmo OR que ModuleGate já suporta (ex.: /funcionarios,
   * que aceita financeiro_avancado OU checklist_tecnico OU
   * painel_operacional). Delegado inteiramente a <ModuleGate mode="lock">
   * depois das checagens de auth/role abaixo - mesmo hasModule/
   * useCompanyModules/bypass de master_admin de sempre, nenhum sistema de
   * autorização novo. Substitui o padrão anterior de compor <ModuleGate>
   * manualmente ao redor do elemento de cada rota em App.tsx.
   */
  requiredModule?: ModuleKey | string | (ModuleKey | string)[];
}

export function ProtectedRoute({
  children,
  adminOnly = false,
  masterOnly = false,
  skipPlanCheck = false,
  requiredModule,
}: Props) {
  const { user, loading, isAccountActivated, isAdmin, isMasterAdmin, empresaBloqueada, precisaEscolherPlano, statusPagamento } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isAccountActivated) return <Navigate to="/primeiro-acesso" replace />;

  const subscriptionRedirect = getSubscriptionRedirect({
    pathname: location.pathname,
    skipPlanCheck,
    isMasterAdmin,
    companyBlocked: empresaBloqueada,
    needsPlanSelection: precisaEscolherPlano,
    paymentStatus: statusPagamento,
  });
  if (subscriptionRedirect) return <Navigate to={subscriptionRedirect} replace />;

  if (masterOnly && !isMasterAdmin) return <Navigate to="/agenda" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/agenda" replace />;

  if (requiredModule) {
    return (
      <ModuleGate featureKey={requiredModule} mode="lock">
        {children}
      </ModuleGate>
    );
  }

  return <>{children}</>;
}
