import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import PainelOperacional from "./PainelOperacional";
import ChecklistCentral from "./ChecklistCentral";

type OperationalTab = "painel" | "checklist";

// Ponto único de entrada no menu para Painel Operacional + Checklist Técnico
// (antes duas entradas separadas em Administração). Nenhuma lógica nova:
// as duas telas existentes são reaproveitadas sem alteração, cada uma
// continua fazendo seu próprio gate de módulo internamente
// (useModuleAccess em PainelOperacional.tsx/ChecklistCentral.tsx) - agrupar
// no menu não funde autorização. As abas do detalhe do evento
// (EventDetail.tsx) não têm relação com esta tela e não foram tocadas.
export default function OperacaoEvento() {
  const [searchParams] = useSearchParams();
  const { empresaId, isMasterAdmin } = useAuth();
  const { hasModule } = useCompanyModules(empresaId);

  const requestedTab = searchParams.get("aba");
  const defaultTab: OperationalTab =
    requestedTab === "checklist"
      ? "checklist"
      : requestedTab === "painel"
        ? "painel"
        : isMasterAdmin || hasModule(MODULE_KEYS.PAINEL_OPERACIONAL) || !hasModule(MODULE_KEYS.CHECKLIST_TECNICO)
          ? "painel"
          : "checklist";

  const [tab, setTab] = useState<OperationalTab>(defaultTab);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Operação do Evento</h1>
        <p className="text-muted-foreground">Painel operacional e checklist técnico de cada evento, reunidos em um só lugar.</p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as OperationalTab)}>
        <TabsList>
          <TabsTrigger value="painel">Painel Operacional</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
        </TabsList>
        <TabsContent value="painel" className="mt-4">
          <PainelOperacional />
        </TabsContent>
        <TabsContent value="checklist" className="mt-4">
          <ChecklistCentral />
        </TabsContent>
      </Tabs>
    </div>
  );
}
