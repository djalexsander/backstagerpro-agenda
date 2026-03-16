import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PlanoBloqueado } from "@/components/PlanoBloqueado";

interface Props {
  children: React.ReactNode;
  adminOnly?: boolean;
  masterOnly?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false, masterOnly = false }: Props) {
  const { user, loading, isAdmin, isMasterAdmin, empresaBloqueada } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  
  // Block access if empresa trial expired (master_admin is never blocked)
  if (empresaBloqueada && !isMasterAdmin) return <PlanoBloqueado />;

  if (masterOnly && !isMasterAdmin) return <Navigate to="/dashboard" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
