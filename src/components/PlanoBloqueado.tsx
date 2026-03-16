import { ShieldX, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export function PlanoBloqueado() {
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto h-20 w-20 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldX className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Acesso Bloqueado</h1>
        <p className="text-muted-foreground">
          O período de teste gratuito da sua empresa expirou. 
          Entre em contato com o administrador do sistema para fazer upgrade do plano e continuar usando o Backstage Pro.
        </p>
        <div className="pt-4">
          <Button variant="outline" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
