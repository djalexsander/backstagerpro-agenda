import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "react-router-dom";

export function ReadOnlyBanner() {
  const { empresaReadOnly } = useAuth();
  const location = useLocation();

  // Don't show on /plano page (full access there)
  if (!empresaReadOnly || location.pathname === "/plano") return null;

  return (
    <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center gap-2 text-sm text-destructive">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        Acesso restrito — somente visualização. Acesse{" "}
        <a href="/plano" className="underline font-medium">Plano & Assinatura</a>{" "}
        para regularizar sua situação.
      </span>
    </div>
  );
}

export function PlanoBloqueado() {
  return <ReadOnlyBanner />;
}
