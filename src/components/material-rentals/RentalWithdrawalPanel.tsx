import { useMemo, useRef, useState } from "react";
import { Camera, Loader2, PackageCheck, Radio, RotateCcw, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MaterialQrScanner } from "@/components/materials/MaterialQrScanner";
import type { CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import { normalizeRentalSearch } from "@/lib/material-rental-domain";
import type { RentalPermissions } from "@/lib/material-rental-permissions";
import { registerRentalCheckin, registerRentalCheckout } from "@/lib/material-rental-service";
import type { RentalCustodyView, RentalDetail, RentalItemView } from "@/lib/material-rental-types";
import type { StockLocation } from "@/lib/stock-types";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useModulePermission } from "@/hooks/useModulePermission";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getRfidPermissions } from "@/lib/rfid-permissions";
import { parseEpcList, reconcileRfidRead, RECONCILIATION_BUCKET_LABELS } from "@/lib/rfid-domain";
import { finishReadSession, recordReadSessionEpcs, resolveEpcs, startReadSession } from "@/lib/rfid-service";
import type { ReconciliationResult } from "@/lib/rfid-types";

// Extraído da antiga aba "Retirada / devolução" de RentalDetailDialog.tsx -
// reaproveitado tanto pelo modal comercial (Locacoes.tsx, via
// RentalDetailDialog) quanto pelo dialog operacional de Check-in/Check-out
// (RentalWithdrawalDialog.tsx), para que as duas telas compartilhem a mesma
// lógica de retirada/devolução (e as mesmas RPCs
// registrar_retirada_locacao_material/registrar_devolucao_locacao_material)
// em vez de duas cópias. Não importa nada de financial-ledger-* nem exibe
// valores - só quantidades e identificação física.
export function RentalWithdrawalPanel({
  companyId,
  rental,
  actions,
  permissions,
  locations,
  responsibles,
  onRefresh,
}: {
  companyId: string;
  rental: RentalDetail;
  actions: { canCheckout: boolean; canCheckin: boolean };
  permissions: RentalPermissions;
  locations: StockLocation[];
  responsibles: CustodyResponsibleOption[];
  onRefresh: () => Promise<void> | void;
}) {
  const { role } = useAuth();
  const { hasModule } = useCompanyModules(companyId);
  const rfidModuleEnabled = hasModule(MODULE_KEYS.RFID_MATERIAIS) && hasModule(MODULE_KEYS.GESTAO_MATERIAIS);
  const { permission: rfidGrant } = useModulePermission({ companyId, featureKey: MODULE_KEYS.RFID_MATERIAIS, role });
  const rfidPermissions = getRfidPermissions({
    role,
    moduleEnabled: rfidModuleEnabled,
    companyReadOnly: false,
    granular: rfidGrant
      ? { canView: rfidGrant.canView, canCreate: rfidGrant.canCreate, canEdit: rfidGrant.canEdit, canDelete: rfidGrant.canDelete }
      : null,
  });

  const [busy, setBusy] = useState(false);
  const [scanner, setScanner] = useState("");
  const [scannerCameraOpen, setScannerCameraOpen] = useState(false);
  const [checkoutItem, setCheckoutItem] = useState<RentalItemView | null>(null);
  const [checkinCustody, setCheckinCustody] = useState<RentalCustodyView | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [locationId, setLocationId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [condition, setCondition] = useState("bom");
  const [occurrence, setOccurrence] = useState("");
  const requestIds = useRef<Record<string, string>>({});
  const requestId = (key: string) => {
    requestIds.current[key] ??= crypto.randomUUID();
    return requestIds.current[key];
  };

  // Leitura RFID em lote (retirada/devolução) - só relevante para o
  // subconjunto de itens com tag individual (rfid_tags exige tipo_controle
  // = 'individual', mesmo filtro usado pelo modo conferencia_locacao de
  // RfidConferencia.tsx). Materiais por quantidade continuam saindo/voltando
  // só pela identificação manual/QR acima.
  const [rfidMode, setRfidMode] = useState<"retirada" | "devolucao">("retirada");
  const [epcPaste, setEpcPaste] = useState("");
  const [rfidReconciliation, setRfidReconciliation] = useState<ReconciliationResult | null>(null);
  const [rfidLocationId, setRfidLocationId] = useState("");
  const [rfidResponsible, setRfidResponsible] = useState("");
  const [rfidCondition, setRfidCondition] = useState("bom");
  const [rfidOccurrence, setRfidOccurrence] = useState("");
  const [rfidBusy, setRfidBusy] = useState(false);

  const activeLocations = locations.filter((location) => location.ativa);
  const defaultResponsible = useMemo(
    () => responsibles.find((item) => item.tipo === "usuario") ?? responsibles[0],
    [responsibles],
  );

  const rfidCheckoutItems = useMemo(
    () => rental.itens.filter((item) => item.material.tipo_controle === "individual" && item.quantidade_pendente_retirada > 0),
    [rental],
  );
  const rfidCheckinCustodies = useMemo(() => {
    return rental.custodias
      .filter((custody) => ["aberta", "parcial"].includes(custody.status) && custody.quantidade_pendente > 0)
      .flatMap((custody) => {
        const item = rental.itens.find((entry) => entry.id === custody.referencia_id);
        return item && item.material.tipo_controle === "individual" ? [{ custody, item }] : [];
      });
  }, [rental]);
  const rfidModesAvailable = useMemo(() => {
    const modes: ("retirada" | "devolucao")[] = [];
    if (permissions.retirar && actions.canCheckout && rfidCheckoutItems.length > 0) modes.push("retirada");
    if (permissions.devolver && actions.canCheckin && rfidCheckinCustodies.length > 0) modes.push("devolucao");
    return modes;
  }, [permissions.retirar, permissions.devolver, actions, rfidCheckoutItems, rfidCheckinCustodies]);
  const activeRfidMode = rfidModesAvailable.includes(rfidMode) ? rfidMode : rfidModesAvailable[0];
  const rfidExpectedMaterialIds = useMemo(
    () =>
      activeRfidMode === "retirada"
        ? rfidCheckoutItems.map((item) => item.material_id)
        : rfidCheckinCustodies.map((entry) => entry.item.material_id),
    [activeRfidMode, rfidCheckoutItems, rfidCheckinCustodies],
  );

  const execute = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await operation();
      toast.success(success);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  };

  const identifyCheckoutItem = (explicitValue?: string) => {
    const value = normalizeRentalSearch(explicitValue ?? scanner).toLocaleLowerCase("pt-BR");
    const found = rental.itens.find((item) => [
      item.material.id,
      item.material.identificador_unico,
      item.material.codigo_barras,
      item.material.codigo_interno,
      item.material.numero_patrimonio,
      item.material.numero_serie,
      item.material.nome,
    ].some((candidate) => candidate?.toLocaleLowerCase("pt-BR").includes(value)));
    if (!found || found.quantidade_pendente_retirada <= 0) {
      toast.error("Material não pertence à locação ou já foi integralmente retirado.");
      return;
    }
    setCheckoutItem(found);
    setQuantity(Math.min(1, found.quantidade_pendente_retirada));
    setResponsible(defaultResponsible ? `${defaultResponsible.tipo}:${defaultResponsible.id}` : "");
  };

  // onDetected -> identifyCheckoutItem(code) direto, mesmo motivo de
  // handleQrDetected em CheckinCheckout.tsx: setState é assíncrono, ler
  // `scanner` de volta logo em seguida não é garantido ver o valor novo.
  const handleScannerQrDetected = (code: string) => {
    setScanner(code);
    identifyCheckoutItem(code);
    setScannerCameraOpen(false);
  };

  const checkout = async () => {
    if (!checkoutItem || !locationId || !responsible) return;
    const [responsibleType, responsibleId] = responsible.split(":");
    await execute(
      () => registerRentalCheckout(companyId, {
        rentalId: rental.id,
        itemId: checkoutItem.id,
        quantity,
        locationId,
        responsibleType: responsibleType as "usuario" | "funcionario",
        responsibleId,
        condition,
        clientUuid: requestId(`checkout:${checkoutItem.id}`),
      }),
      "Retirada registrada na custódia e no estoque oficial.",
    );
    setCheckoutItem(null);
    setScanner("");
  };

  const checkin = async () => {
    if (!checkinCustody || !locationId) return;
    await execute(
      () => registerRentalCheckin(companyId, {
        rentalId: rental.id,
        custodyId: checkinCustody.id,
        quantity,
        locationId,
        returnCondition: condition,
        occurrence,
        clientUuid: requestId(`checkin:${checkinCustody.id}:${checkinCustody.quantidade_devolvida}`),
      }),
      "Devolução registrada na custódia e no estoque oficial.",
    );
    setCheckinCustody(null);
    setOccurrence("");
  };

  const resetRfidBatch = () => {
    setEpcPaste("");
    setRfidReconciliation(null);
  };

  const readRfidBatch = async () => {
    if (!activeRfidMode) return;
    const parsed = parseEpcList(epcPaste);
    if (!parsed.valid.length) {
      toast.error("Nenhum EPC válido informado.");
      return;
    }
    setRfidBusy(true);
    try {
      const resolutions = await resolveEpcs(parsed.valid);
      setRfidReconciliation(reconcileRfidRead({ expectedMaterialIds: rfidExpectedMaterialIds, resolutions }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao resolver EPCs.");
    } finally {
      setRfidBusy(false);
    }
  };

  // Aplica retirada/devolução para cada material efetivamente lido (found) -
  // nunca para expected/unexpected/unknown - reusando as mesmas RPCs
  // registerRentalCheckout/registerRentalCheckin da identificação manual
  // acima, uma chamada por item. A sessão RFID (rfid_read_sessions) é
  // gravada para auditoria, mas quem efetivamente move custódia/estoque
  // continua sendo essas RPCs, nunca o resultado da conferência por si só.
  const confirmRfidBatch = async () => {
    if (!activeRfidMode || !rfidReconciliation || !rfidReconciliation.found.length) return;
    if (activeRfidMode === "retirada" && (!rfidLocationId || !rfidResponsible)) return;
    if (activeRfidMode === "devolucao" && !rfidLocationId) return;

    setRfidBusy(true);
    const failures: string[] = [];
    let succeeded = 0;
    try {
      const session = await startReadSession({
        tipo: activeRfidMode === "retirada" ? "checkout" : "checkin",
        referenciaTipo: "locacao",
        referenciaId: rental.id,
        expectedMaterialIds: rfidExpectedMaterialIds,
      });
      const observedEpcs = [
        ...rfidReconciliation.found.map((entry) => entry.epc),
        ...rfidReconciliation.unexpected.map((entry) => entry.epc),
        ...rfidReconciliation.unknown.map((entry) => entry.epc),
      ];
      await recordReadSessionEpcs(session.id, observedEpcs);

      if (activeRfidMode === "retirada") {
        const [responsibleType, responsibleId] = rfidResponsible.split(":");
        for (const found of rfidReconciliation.found) {
          const item = rfidCheckoutItems.find((entry) => entry.material_id === found.materialId);
          if (!item) continue;
          try {
            await registerRentalCheckout(companyId, {
              rentalId: rental.id,
              itemId: item.id,
              quantity: 1,
              locationId: rfidLocationId,
              responsibleType: responsibleType as "usuario" | "funcionario",
              responsibleId,
              condition: rfidCondition,
              clientUuid: requestId(`rfid-checkout:${item.id}`),
            });
            succeeded += 1;
          } catch (error) {
            failures.push(`${item.material.nome}: ${error instanceof Error ? error.message : "falha"}`);
          }
        }
      } else {
        for (const found of rfidReconciliation.found) {
          const entry = rfidCheckinCustodies.find((candidate) => candidate.item.material_id === found.materialId);
          if (!entry) continue;
          try {
            await registerRentalCheckin(companyId, {
              rentalId: rental.id,
              custodyId: entry.custody.id,
              quantity: 1,
              locationId: rfidLocationId,
              returnCondition: rfidCondition,
              occurrence: rfidOccurrence,
              clientUuid: requestId(`rfid-checkin:${entry.custody.id}:${entry.custody.quantidade_devolvida}`),
            });
            succeeded += 1;
          } catch (error) {
            failures.push(`${entry.item.material.nome}: ${error instanceof Error ? error.message : "falha"}`);
          }
        }
      }

      await finishReadSession({ sessionId: session.id, status: "concluida" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na leitura RFID em lote.");
      setRfidBusy(false);
      return;
    }

    if (succeeded > 0) {
      toast.success(`${succeeded} ${activeRfidMode === "retirada" ? "retirada(s)" : "devolução(ões)"} confirmada(s) via RFID.`);
    }
    if (failures.length) toast.error(`Falha em ${failures.length} item(ns): ${failures.join("; ")}`);
    resetRfidBatch();
    setRfidBusy(false);
    await onRefresh();
  };

  return (
    <div className="space-y-4">
      {permissions.retirar && actions.canCheckout && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4" />Realizar retirada</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={scanner} onChange={(event) => setScanner(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); identifyCheckoutItem(); } }} placeholder="Escaneie QR/código ou busque o material contratado" />
              <Button type="button" variant="outline" onClick={() => setScannerCameraOpen(true)}><Camera className="mr-2 h-4 w-4" />Câmera</Button>
              <Button variant="outline" onClick={() => identifyCheckoutItem()}><ScanLine className="mr-2 h-4 w-4" />Identificar</Button>
            </div>
            {checkoutItem && (
              <div className="grid gap-3 sm:grid-cols-4">
                <div><Label>Material</Label><p className="pt-2 text-sm font-medium">{checkoutItem.material.nome}</p></div>
                <div><Label>Quantidade</Label><Input type="number" min={1} max={checkoutItem.quantidade_pendente_retirada} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
                <div><Label>Origem</Label><Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue placeholder="Local" /></SelectTrigger><SelectContent>{activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.nome}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Responsável</Label><Select value={responsible} onValueChange={setResponsible}><SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger><SelectContent>{responsibles.map((item) => <SelectItem key={`${item.tipo}:${item.id}`} value={`${item.tipo}:${item.id}`}>{item.nome}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Condição</Label><Input value={condition} onChange={(event) => setCondition(event.target.value)} /></div>
                <div className="flex items-end"><Button disabled={busy || !locationId || !responsible} onClick={checkout}>Confirmar retirada</Button></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {permissions.devolver && actions.canCheckin && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><RotateCcw className="h-4 w-4" />Receber materiais</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2">
              {rental.custodias.filter((custody) => ["aberta", "parcial"].includes(custody.status)).map((custody) => {
                const item = rental.itens.find((entry) => entry.id === custody.referencia_id);
                return (
                  <Button key={custody.id} variant={checkinCustody?.id === custody.id ? "default" : "outline"} className="justify-between" onClick={() => { setCheckinCustody(custody); setQuantity(custody.quantidade_pendente); }}>
                    <span>{item?.material.nome ?? custody.material_id}</span>
                    <span>Pendente: {custody.quantidade_pendente}</span>
                  </Button>
                );
              })}
            </div>
            {checkinCustody && (
              <div className="grid gap-3 sm:grid-cols-4">
                <div><Label>Quantidade</Label><Input type="number" min={1} max={checkinCustody.quantidade_pendente} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
                <div><Label>Destino</Label><Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue placeholder="Local" /></SelectTrigger><SelectContent>{activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.nome}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Condição de retorno</Label><Input value={condition} onChange={(event) => setCondition(event.target.value)} /></div>
                <div><Label>Ocorrência/avaria</Label><Input value={occurrence} onChange={(event) => setOccurrence(event.target.value)} /></div>
                <div className="flex items-end"><Button disabled={busy || !locationId} onClick={checkin}>Confirmar devolução</Button></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {!actions.canCheckout && !actions.canCheckin && (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">Nenhuma ação física disponível para o estado atual.</p>
      )}

      {rfidPermissions.iniciarConferencia && activeRfidMode && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Radio className="h-4 w-4" />Leitura RFID em lote</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Só cobre materiais com tag individual vinculada. Materiais por quantidade continuam saindo/voltando pela identificação acima.
            </p>
            {rfidModesAvailable.length > 1 && (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={activeRfidMode === "retirada" ? "default" : "outline"} onClick={() => { setRfidMode("retirada"); resetRfidBatch(); }}>Retirada</Button>
                <Button type="button" size="sm" variant={activeRfidMode === "devolucao" ? "default" : "outline"} onClick={() => { setRfidMode("devolucao"); resetRfidBatch(); }}>Devolução</Button>
              </div>
            )}
            <div className="space-y-2">
              <Label>EPCs lidos (um por linha, ou colados em lote)</Label>
              <Textarea value={epcPaste} onChange={(event) => setEpcPaste(event.target.value)} placeholder="Cole ou digite os EPCs lidos pelo leitor UHF" rows={3} />
              <Button type="button" variant="outline" disabled={rfidBusy || !epcPaste.trim()} onClick={readRfidBatch}>
                {rfidBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" />}
                Resolver leitura
              </Button>
            </div>
            {rfidReconciliation && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  {(["found", "missing", "unexpected", "unknown", "inactiveTag"] as const).map((bucket) => (
                    <Badge key={bucket} variant={bucket === "found" ? "default" : "outline"}>
                      {RECONCILIATION_BUCKET_LABELS[bucket]}: {rfidReconciliation.counts[bucket]}
                    </Badge>
                  ))}
                </div>
                {rfidReconciliation.found.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-4">
                    {activeRfidMode === "retirada" && (
                      <div><Label>Origem</Label><Select value={rfidLocationId} onValueChange={setRfidLocationId}><SelectTrigger><SelectValue placeholder="Local" /></SelectTrigger><SelectContent>{activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.nome}</SelectItem>)}</SelectContent></Select></div>
                    )}
                    {activeRfidMode === "retirada" && (
                      <div><Label>Responsável</Label><Select value={rfidResponsible} onValueChange={setRfidResponsible}><SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger><SelectContent>{responsibles.map((item) => <SelectItem key={`${item.tipo}:${item.id}`} value={`${item.tipo}:${item.id}`}>{item.nome}</SelectItem>)}</SelectContent></Select></div>
                    )}
                    {activeRfidMode === "devolucao" && (
                      <div><Label>Destino</Label><Select value={rfidLocationId} onValueChange={setRfidLocationId}><SelectTrigger><SelectValue placeholder="Local" /></SelectTrigger><SelectContent>{activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.nome}</SelectItem>)}</SelectContent></Select></div>
                    )}
                    <div><Label>Condição</Label><Input value={rfidCondition} onChange={(event) => setRfidCondition(event.target.value)} /></div>
                    {activeRfidMode === "devolucao" && (
                      <div><Label>Ocorrência/avaria</Label><Input value={rfidOccurrence} onChange={(event) => setRfidOccurrence(event.target.value)} /></div>
                    )}
                    <div className="flex items-end">
                      <Button disabled={rfidBusy || !rfidLocationId || (activeRfidMode === "retirada" && !rfidResponsible)} onClick={confirmRfidBatch}>
                        {rfidBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirmar {rfidReconciliation.found.length} {activeRfidMode === "retirada" ? "retirada(s)" : "devolução(ões)"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <MaterialQrScanner open={scannerCameraOpen} onOpenChange={setScannerCameraOpen} onDetected={handleScannerQrDetected} />
    </div>
  );
}
