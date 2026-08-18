import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Loader2, LogOut, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MaterialQrScanner } from "@/components/materials/MaterialQrScanner";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useScannerRemoto } from "@/hooks/useScannerRemoto";
import { useToast } from "@/hooks/use-toast";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getScannerRemotoPermissions } from "@/lib/scanner-remoto-permissions";
import {
  CUSTODY_CONDITION_LABELS,
  CUSTODY_PURPOSE_LABELS,
  normalizeCustodyScan,
} from "@/lib/checkin-checkout-domain";
import { listCustodyResponsibles } from "@/lib/checkin-checkout-service";
import { listStockLocations } from "@/lib/stock-service";
import type { CustodyCondition, CustodyPurpose } from "@/lib/checkin-checkout-types";
import {
  SCANNER_REMOTO_ACAO_LABELS,
  SCANNER_REMOTO_TIPO_OPERACAO_LABELS,
  type ScannerRemotoTipoOperacao,
} from "@/lib/scanner-remoto-types";

const REALTIME_STATUS_LABEL: Record<string, string> = {
  connected: "Conectado",
  connecting: "Conectando",
  disconnected: "Desconectado",
};

// Mobile-first: this is the phone/PWA side of Scanner Remoto. It reuses the
// exact same MaterialQrScanner camera component and identifier-matching
// convention as the desktop's Check-in/Check-out (CheckinCheckout.tsx) -
// the only thing new here is the session wrapper and the fact that this
// terminal talks to registrar_leitura_scanner_remoto instead of calling
// registrar_checkout_material/registrar_checkin_material directly (that RPC
// resolves the material and delegates to those same two RPCs server-side).
export default function ScannerRemoto() {
  const { role, empresaId: companyId, empresaReadOnly, isMasterAdmin } = useAuth();
  const { hasModule, isLoading: loadingModules } = useCompanyModules(companyId);
  const moduleEnabled =
    hasModule(MODULE_KEYS.CHECKIN_CHECKOUT) &&
    hasModule(MODULE_KEYS.GESTAO_MATERIAIS) &&
    hasModule(MODULE_KEYS.CONTROLE_ESTOQUE);
  const permissions = getScannerRemotoPermissions({
    role,
    moduleEnabled,
    companyReadOnly: empresaReadOnly,
    companySelected: Boolean(companyId),
  });
  const { toast } = useToast();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [startingSession, setStartingSession] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState({
    tipoOperacao: "misto" as ScannerRemotoTipoOperacao,
    condicao: "bom" as CustodyCondition,
    responsibleId: "",
    purpose: "" as CustodyPurpose | "",
    originLocationId: "",
    destinationLocationId: "",
    titulo: "",
  });

  const { sessions, reads, realtimeStatus, startSession, registerRead, endSession } =
    useScannerRemoto({
      companyId,
      sessaoId: activeSessionId,
      enabled: permissions.visualizar,
    });

  const locationsQuery = useQuery({
    queryKey: ["stock-locations", companyId],
    queryFn: () => listStockLocations(companyId!, true),
    enabled: Boolean(companyId) && permissions.checkout,
  });
  const responsiblesQuery = useQuery({
    queryKey: ["material-custody-responsibles", companyId],
    queryFn: () => listCustodyResponsibles(companyId!),
    enabled: Boolean(companyId) && permissions.checkout,
  });

  const locations = locationsQuery.data ?? [];
  // Same simplification CheckinCheckout.tsx's own quick picker uses -
  // funcionario-type responsibles aren't offered here yet, the RPC already
  // supports them for whenever that picker is added.
  const responsibles = (responsiblesQuery.data ?? []).filter((item) => item.tipo === "usuario");
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  if (!companyId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Scanner Remoto</h1>
        <p className="text-muted-foreground">
          {isMasterAdmin
            ? "Sua conta master não está vinculada a uma empresa operacional."
            : "Nenhuma empresa vinculada à sua conta."}
        </p>
      </div>
    );
  }

  if (!loadingModules && !permissions.visualizar) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Scanner Remoto</h1>
        <Card className="border-amber-500/50">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Scanner Remoto usa o mesmo acesso do Check-in / Check-out (Gestão
            de Materiais e Controle de Estoque também precisam estar ativos).
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleStartSession = async (event: FormEvent) => {
    event.preventDefault();
    if (!companyId) return;
    const needsCheckoutFields = form.tipoOperacao === "checkout" || form.tipoOperacao === "misto";
    const needsCheckinFields = form.tipoOperacao === "checkin" || form.tipoOperacao === "misto";
    if (needsCheckoutFields && (!form.originLocationId || !form.responsibleId || !form.purpose)) {
      toast({ title: "Preencha origem, responsável e finalidade", variant: "destructive" });
      return;
    }
    if (needsCheckinFields && !form.destinationLocationId) {
      toast({ title: "Selecione a localização de destino", variant: "destructive" });
      return;
    }
    const responsible = responsibles.find((item) => item.id === form.responsibleId);
    setStartingSession(true);
    try {
      const session = await startSession({
        tipoOperacao: form.tipoOperacao,
        condicao: form.condicao,
        responsibleType: responsible?.tipo,
        responsibleId: responsible?.id,
        purpose: form.purpose || undefined,
        originLocationId: form.originLocationId || undefined,
        destinationLocationId: form.destinationLocationId || undefined,
        titulo: form.titulo.trim() || undefined,
        clientUuid: crypto.randomUUID(),
      });
      setActiveSessionId(session.id);
    } catch (error) {
      toast({
        title: "Não foi possível iniciar a sessão",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setStartingSession(false);
    }
  };

  const submitScan = async (code: string) => {
    const normalized = normalizeCustodyScan(code);
    if (!normalized || !activeSessionId) return;
    setScanning(true);
    try {
      const read = await registerRead({
        sessaoId: activeSessionId,
        codigoLido: normalized,
        clientUuid: crypto.randomUUID(),
      });
      const succeeded = read.acao_executada === "checkout" || read.acao_executada === "checkin";
      toast({
        title: read.resultado?.mensagem ?? (succeeded ? "Leitura registrada" : "Leitura não processada"),
        variant: succeeded ? "default" : "destructive",
      });
    } catch (error) {
      // Only session-level problems (encerrada, não encontrada, dados
      // ausentes) reject the call - a rejected/unmatched scan is a normal
      // result handled above, not an exception.
      toast({
        title: "Não foi possível registrar a leitura",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setManualCode("");
      setScanning(false);
    }
  };

  const handleManualSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitScan(manualCode);
  };

  const handleEndSession = async () => {
    if (!activeSessionId) return;
    try {
      await endSession(activeSessionId);
      setActiveSessionId(null);
    } catch (error) {
      toast({
        title: "Não foi possível encerrar a sessão",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Scanner Remoto</h1>
        <Badge variant={realtimeStatus === "connected" ? "outline" : "destructive"} className="gap-1">
          {realtimeStatus === "connected" ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          {REALTIME_STATUS_LABEL[realtimeStatus]}
        </Badge>
      </div>

      {!activeSession && (
        <>
          {sessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sessões abertas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {session.titulo || SCANNER_REMOTO_TIPO_OPERACAO_LABELS[session.tipo_operacao]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Aberta em {new Date(session.aberta_em).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setActiveSessionId(session.id)}>
                      Usar
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nova sessão</CardTitle>
            </CardHeader>
            <CardContent>
              {!permissions.checkout ? (
                <p className="text-sm text-muted-foreground">
                  Sua conta pode visualizar sessões, mas não tem permissão para
                  iniciar check-out/check-in (mesma regra do Check-in/Check-out
                  no desktop).
                </p>
              ) : (
                <form className="space-y-3" onSubmit={handleStartSession}>
                  <div className="space-y-1.5">
                    <Label>Tipo de operação</Label>
                    <Select
                      value={form.tipoOperacao}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          tipoOperacao: value as ScannerRemotoTipoOperacao,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(SCANNER_REMOTO_TIPO_OPERACAO_LABELS) as ScannerRemotoTipoOperacao[]).map(
                          (key) => (
                            <SelectItem key={key} value={key}>
                              {SCANNER_REMOTO_TIPO_OPERACAO_LABELS[key]}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Condição padrão</Label>
                    <Select
                      value={form.condicao}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, condicao: value as CustodyCondition }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CUSTODY_CONDITION_LABELS) as CustodyCondition[]).map((key) => (
                          <SelectItem key={key} value={key}>
                            {CUSTODY_CONDITION_LABELS[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(form.tipoOperacao === "checkout" || form.tipoOperacao === "misto") && (
                    <>
                      <div className="space-y-1.5">
                        <Label>Localização de origem</Label>
                        <Select
                          value={form.originLocationId}
                          onValueChange={(value) =>
                            setForm((current) => ({ ...current, originLocationId: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map((location) => (
                              <SelectItem key={location.id} value={location.id}>
                                {location.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Responsável</Label>
                        <Select
                          value={form.responsibleId}
                          onValueChange={(value) =>
                            setForm((current) => ({ ...current, responsibleId: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {responsibles.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Finalidade</Label>
                        <Select
                          value={form.purpose}
                          onValueChange={(value) =>
                            setForm((current) => ({ ...current, purpose: value as CustodyPurpose }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(CUSTODY_PURPOSE_LABELS) as CustodyPurpose[]).map((key) => (
                              <SelectItem key={key} value={key}>
                                {CUSTODY_PURPOSE_LABELS[key]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  {(form.tipoOperacao === "checkin" || form.tipoOperacao === "misto") && (
                    <div className="space-y-1.5">
                      <Label>Localização de destino</Label>
                      <Select
                        value={form.destinationLocationId}
                        onValueChange={(value) =>
                          setForm((current) => ({ ...current, destinationLocationId: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {locations.map((location) => (
                            <SelectItem key={location.id} value={location.id}>
                              {location.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Título (opcional)</Label>
                    <Input
                      value={form.titulo}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, titulo: event.target.value }))
                      }
                      placeholder="Ex.: Load-out show sexta"
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={startingSession}>
                    {startingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : "Iniciar sessão"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {activeSession && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {activeSession.titulo || SCANNER_REMOTO_TIPO_OPERACAO_LABELS[activeSession.tipo_operacao]}
              </CardTitle>
              <Button size="sm" variant="outline" onClick={handleEndSession}>
                <LogOut className="mr-1 h-3.5 w-3.5" /> Encerrar
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <form className="flex gap-2" onSubmit={handleManualSubmit}>
                <Input
                  autoFocus
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="Digite ou cole o código"
                  disabled={scanning}
                />
                <Button type="submit" disabled={scanning || !manualCode.trim()}>
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ler"}
                </Button>
              </form>
              <Button type="button" variant="secondary" className="w-full" onClick={() => setCameraOpen(true)}>
                <Camera className="mr-2 h-4 w-4" /> Abrir câmera
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leituras desta sessão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reads.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma leitura ainda.</p>
              )}
              {reads.map((read) => (
                <div
                  key={read.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{read.material_nome ?? read.codigo_lido}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(read.created_at).toLocaleTimeString("pt-BR")}
                      {read.resultado?.mensagem ? ` · ${read.resultado.mensagem}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant={
                      read.acao_executada === "checkout" || read.acao_executada === "checkin"
                        ? "outline"
                        : "destructive"
                    }
                  >
                    {SCANNER_REMOTO_ACAO_LABELS[read.acao_executada]}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <MaterialQrScanner
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onDetected={(code) => void submitScan(code)}
      />
    </div>
  );
}
