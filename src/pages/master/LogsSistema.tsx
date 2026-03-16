import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollText } from "lucide-react";

export default function LogsSistema() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Logs do Sistema</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-muted-foreground" />
            Registros de Atividade
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Os logs de atividade do sistema serão exibidos aqui. Acompanhe ações de usuários, criação de empresas e alterações importantes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
