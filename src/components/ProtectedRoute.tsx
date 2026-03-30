import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  children: React.ReactNode;
  adminOnly?: boolean;
  masterOnly?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false, masterOnly = false }: Props) {
  const { user, loading, isAdmin, isMasterAdmin, empresaBloqueada } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // When empresa is blocked/inactive, allow only view access + /plano full access
  // Don't fully block — the layout handles the read-only banner
  if (empresaBloqueada && !isMasterAdmin) {
    const isPlanoRoute = location.pathname === "/plano";
    const isViewOnlyRoute = ["/agenda", "/dashboard", "/financeiro", "/documentos", "/funcionarios", "/backups", "/usuarios"].some(
      r => location.pathname.startsWith(r)
    );
    const isEventView = location.pathname.startsWith("/evento/") && !location.pathname.includes("/editar") && !location.pathname.includes("/novo");

    // Block create/edit routes
    if (!isPlanoRoute && !isViewOnlyRoute && !isEventView) {
      return <Navigate to="/plano" replace />;
    }
  }

  if (masterOnly && !isMasterAdmin) return <Navigate to="/agenda" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/agenda" replace />;

  return <>{children}</>;
}
