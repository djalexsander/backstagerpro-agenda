import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

export default function ConfiguracoesSistema() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Configurações do Sistema</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-5 w-5 text-muted-foreground" />
            Configurações Gerais
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            As configurações do sistema estarão disponíveis aqui. Você poderá gerenciar parâmetros globais como limites de planos, integrações e notificações.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
