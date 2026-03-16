import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

export default function Configuracoes() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Configurações</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-5 w-5 text-muted-foreground" />
            Configurações da Empresa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Aqui você poderá gerenciar as configurações específicas da sua empresa, como dados de contato, logo e preferências.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
