import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getSubscriptionRedirect } from "@/lib/access-control";

interface Props {
  children: React.ReactNode;
  adminOnly?: boolean;
  masterOnly?: boolean;
  skipPlanCheck?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false, masterOnly = false, skipPlanCheck = false }: Props) {
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

  return <>{children}</>;
}
