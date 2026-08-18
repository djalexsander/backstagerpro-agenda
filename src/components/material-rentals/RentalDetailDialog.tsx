import { FormEvent, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, Loader2, PackageCheck, Printer, Radio, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MaterialQrScanner } from "@/components/materials/MaterialQrScanner";
import type { CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import { normalizeRentalSearch, getRentalActions, RENTAL_STATUS_LABELS } from "@/lib/material-rental-domain";
import type { RentalPermissions } from "@/lib/material-rental-permissions";
import {
  cancelMaterialRental,
  concludeMaterialRental,
  confirmMaterialRental,
  getMaterialRental,
  markMaterialRentalReady,
  registerRentalCheckin,
  registerRentalCheckout,
  removeMaterialRentalItem,
  saveMaterialRentalItem,
  searchRentalMaterials,
} from "@/lib/material-rental-service";
import type { RentalCustodyView, RentalItemView, RentalMaterialOption } from "@/lib/material-rental-types";
import type { StockLocation } from "@/lib/stock-types";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { useModulePermission } from "@/hooks/useModulePermission";
import { MODULE_KEYS } from "@/constants/module-keys";
import { getFinancialLedgerPermissions } from "@/lib/financial-ledger-permissions";
import { getRentalFinancialSummary, registerRentalReceipt, reverseRentalReceipt } from "@/lib/financial-ledger-service";
import type { FinancialLedgerStatus, PaymentCondition } from "@/lib/financial-ledger-types";
import { splitInstallments } from "@/lib/installment-split";
import { isDesktopRuntime } from "@/lib/printer-service";
import { printRentalReceipt, type RentalReceiptKind } from "@/lib/rental-receipt-print";
import { getRfidPermissions } from "@/lib/rfid-permissions";
import { parseEpcList, reconcileRfidRead, RECONCILIATION_BUCKET_LABELS } from "@/lib/rfid-domain";
import { finishReadSession, recordReadSessionEpcs, resolveEpcs, startReadSession } from "@/lib/rfid-service";
import type { ReconciliationResult } from "@/lib/rfid-types";

const FINANCIAL_STATUS_LABELS: Record<FinancialLedgerStatus, string> = {
  pendente: "Pendente",
  parcial: "Parcialmente pago",
  recebido: "Pago",
  cancelado: "Cancelado",
  cancelado_pendente_regularizacao: "Cancelado · pendente de regularização",
  estornado: "Estornado",
};

const FINANCIAL_STATUS_BADGE: Record<FinancialLedgerStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pendente: "outline",
  parcial: "outline",
  recebido: "default",
  cancelado: "secondary",
  cancelado_pendente_regularizacao: "destructive",
  estornado: "secondary",
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function addDays(base: Date, days: number): string {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function RentalDetailDialog({
  open,
  onOpenChange,
  companyId,
  rentalId,
  permissions,
  locations,
  responsibles,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  rentalId: string | null;
  permissions: RentalPermissions;
  locations: StockLocation[];
  responsibles: CustodyResponsibleOption[];
  onChanged: () => Promise<void> | void;
}) {
  const detailQuery = useQuery({
    queryKey: ["material-rental-detail", companyId, rentalId],
    queryFn: () => getMaterialRental(companyId, rentalId!),
    enabled: open && Boolean(rentalId),
  });
  const rental = detailQuery.data;
  const actions = rental ? getRentalActions(rental) : null;
  const { role, empresaNome } = useAuth();
  const { hasModule } = useCompanyModules(companyId);
  const queryClient = useQueryClient();
  const financialPermissions = getFinancialLedgerPermissions({
    role,
    moduleEnabled: hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO),
    // Backend (company_has_operational_access, inside registrar_recebimento_locacao)
    // is the authoritative gate for read-only companies - this dialog isn't
    // handed that flag today, so a blocked attempt surfaces as a clear toast
    // from the RPC instead of being silently hidden here.
    companyReadOnly: false,
  });
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
  const financialQuery = useQuery({
    queryKey: ["rental-financial-summary", companyId, rentalId],
    queryFn: () => getRentalFinancialSummary(companyId, rentalId!),
    enabled: open && Boolean(rentalId) && financialPermissions.visualizar,
  });
  const invalidateFinancials = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rental-financial-summary", companyId, rentalId] }),
      queryClient.invalidateQueries({ queryKey: ["receivables", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["clients-receivable", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["rentals-financial-summary", companyId] }),
    ]);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptMethod, setReceiptMethod] = useState("pix");
  const [receiptInstallmentId, setReceiptInstallmentId] = useState<string | null>(null);
  const receiptTargetInstallment = useMemo(
    () => (receiptInstallmentId ? financialQuery.data?.parcelas.find((installment) => installment.id === receiptInstallmentId) : null),
    [receiptInstallmentId, financialQuery.data],
  );
  const receiptMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(receiptAmount.replace(",", "."));
      if (!amount || amount <= 0) throw new Error("Informe um valor válido.");
      return registerRentalReceipt(companyId, {
        rentalId: rentalId!,
        amount,
        paymentMethod: receiptMethod,
        clientUuid: crypto.randomUUID(),
        installmentId: receiptInstallmentId ?? undefined,
      });
    },
    onSuccess: async () => {
      await invalidateFinancials();
      setReceiptOpen(false);
      setReceiptAmount("");
      setReceiptInstallmentId(null);
      toast.success("Recebimento registrado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReceiptId, setReverseReceiptId] = useState<string | null>(null);
  const [reverseAmount, setReverseAmount] = useState("");
  const [reverseJustification, setReverseJustification] = useState("");
  const reverseMutation = useMutation({
    mutationFn: async () => {
      if (!reverseReceiptId) throw new Error("Selecione um recebimento.");
      if (!reverseJustification.trim()) throw new Error("Informe a justificativa do estorno.");
      const amount = reverseAmount.trim() ? Number(reverseAmount.replace(",", ".")) : undefined;
      return reverseRentalReceipt(companyId, {
        receiptId: reverseReceiptId,
        justification: reverseJustification.trim(),
        clientUuid: crypto.randomUUID(),
        amount,
      });
    },
    onSuccess: async () => {
      await invalidateFinancials();
      setReverseOpen(false);
      setReverseReceiptId(null);
      setReverseAmount("");
      setReverseJustification("");
      toast.success("Estorno registrado. O recebimento original permanece no histórico.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const openReverseDialog = (receiptId: string) => {
    setReverseReceiptId(receiptId);
    setReverseAmount("");
    setReverseJustification("");
    setReverseOpen(true);
  };

  const [paymentConditionOpen, setPaymentConditionOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"avista" | "parcelado">("avista");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [installmentCount, setInstallmentCount] = useState(2);
  const [installments, setInstallments] = useState<{ numero: number; valor: number; vencimento: string }[]>([]);
  const installmentsSum = useMemo(
    () => Math.round(installments.reduce((sum, installment) => sum + installment.valor, 0) * 100) / 100,
    [installments],
  );
  const regenerateInstallments = (count: number) => {
    const safeCount = Math.max(2, Math.min(24, Math.round(count) || 2));
    setInstallmentCount(safeCount);
    if (!rental) return;
    const today = new Date();
    setInstallments(
      splitInstallments(rental.valor_total, safeCount).map((installment, index) => ({
        ...installment,
        vencimento: addDays(today, 30 * (index + 1)),
      })),
    );
  };
  const openPaymentCondition = () => {
    setPaymentMode("avista");
    setPaymentDueDate("");
    setInstallmentCount(2);
    setInstallments([]);
    setPaymentConditionOpen(true);
  };

  const [busy, setBusy] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const [materials, setMaterials] = useState<RentalMaterialOption[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<RentalMaterialOption | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [scanner, setScanner] = useState("");
  const [scannerCameraOpen, setScannerCameraOpen] = useState(false);
  const [checkoutItem, setCheckoutItem] = useState<RentalItemView | null>(null);
  const [checkinCustody, setCheckinCustody] = useState<RentalCustodyView | null>(null);
  const [locationId, setLocationId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [condition, setCondition] = useState("bom");
  const [occurrence, setOccurrence] = useState("");
  const [justification, setJustification] = useState("");
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
    () => (rental?.itens ?? []).filter((item) => item.material.tipo_controle === "individual" && item.quantidade_pendente_retirada > 0),
    [rental],
  );
  const rfidCheckinCustodies = useMemo(() => {
    if (!rental) return [] as { custody: RentalCustodyView; item: RentalItemView }[];
    return rental.custodias
      .filter((custody) => ["aberta", "parcial"].includes(custody.status) && custody.quantidade_pendente > 0)
      .flatMap((custody) => {
        const item = rental.itens.find((entry) => entry.id === custody.referencia_id);
        return item && item.material.tipo_controle === "individual" ? [{ custody, item }] : [];
      });
  }, [rental]);
  const rfidModesAvailable = useMemo(() => {
    const modes: ("retirada" | "devolucao")[] = [];
    if (permissions.retirar && actions?.canCheckout && rfidCheckoutItems.length > 0) modes.push("retirada");
    if (permissions.devolver && actions?.canCheckin && rfidCheckinCustodies.length > 0) modes.push("devolucao");
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

  const refresh = async () => {
    await detailQuery.refetch();
    await onChanged();
  };
  const execute = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await operation();
      toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  };

  const confirmWithPaymentCondition = async () => {
    if (!rental) return;
    const condition: PaymentCondition =
      paymentMode === "avista"
        ? { formaCobranca: "avista", vencimento: paymentDueDate }
        : { formaCobranca: "parcelado", parcelas: installments };
    setBusy(true);
    try {
      await confirmMaterialRental(companyId, rental.id, requestId("confirm"), condition);
      toast.success("Reserva confirmada.");
      setPaymentConditionOpen(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  };

  const searchMaterials = async (event: FormEvent) => {
    event.preventDefault();
    if (!rental) return;
    setBusy(true);
    try {
      setMaterials(await searchRentalMaterials({
        companyId,
        search: normalizeRentalSearch(materialSearch),
        withdrawalAt: rental.retirada_prevista_em,
        returnAt: rental.devolucao_prevista_em,
        excludeRentalId: rental.id,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na busca.");
    } finally {
      setBusy(false);
    }
  };

  const addItem = async () => {
    if (!rental || !selectedMaterial) return;
    await execute(
      () => saveMaterialRentalItem(companyId, {
        rentalId: rental.id,
        materialId: selectedMaterial.id,
        quantity,
        billingMode: "unidade",
        billingUnits: 1,
        unitPrice,
        discount,
        clientUuid: requestId(`item:${selectedMaterial.id}`),
      }),
      "Material adicionado à locação.",
    );
    setSelectedMaterial(null);
    setMaterials([]);
    setMaterialSearch("");
  };

  const identifyCheckoutItem = (explicitValue?: string) => {
    if (!rental) return;
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
    if (!rental || !checkoutItem || !locationId || !responsible) return;
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
    if (!rental || !checkinCustody || !locationId) return;
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
    if (!rental || !activeRfidMode) return;
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
    if (!rental || !activeRfidMode || !rfidReconciliation || !rfidReconciliation.found.length) return;
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
    await refresh();
  };

  const printReceipt = async (kind: RentalReceiptKind) => {
    if (!rental) return;
    try {
      await printRentalReceipt({
        companyId,
        rental,
        empresaNome: empresaNome || "Backstage Pro",
        kind,
        financial: financialQuery.data,
      });
      if (isDesktopRuntime()) toast.success("Impressão enviada para a impressora.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível imprimir o comprovante.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rental ? `${rental.numero} · ${rental.cliente.nome_fantasia || rental.cliente.nome}` : "Detalhe da locação"}</DialogTitle>
          <DialogDescription>Comercial, reserva e operação física em uma visão, sem duplicar estoque ou custódia.</DialogDescription>
        </DialogHeader>
        {detailQuery.isLoading && <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {detailQuery.error && <p className="text-destructive">{detailQuery.error instanceof Error ? detailQuery.error.message : "Falha ao carregar."}</p>}
        {rental && actions && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Status</p><Badge variant={rental.atrasada ? "destructive" : "secondary"}>{rental.atrasada ? "Atrasada · " : ""}{RENTAL_STATUS_LABELS[rental.status]}</Badge></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Período</p><p className="text-sm font-medium">{new Date(rental.retirada_prevista_em).toLocaleString("pt-BR")}<br />até {new Date(rental.devolucao_prevista_em).toLocaleString("pt-BR")}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Responsável</p><p className="font-medium">{rental.responsavel_nome}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-lg font-bold">{money.format(rental.valor_total)}</p></CardContent></Card>
            </div>

            {financialPermissions.visualizar && financialQuery.data && (
              <div className="space-y-3">
                {financialQuery.data.status === "cancelado_pendente_regularizacao" && (
                  <Card className="border-destructive/40 bg-destructive/5">
                    <CardContent className="space-y-1 p-4 text-sm">
                      <p className="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" />Locação cancelada com valor recebido pendente de regularização</p>
                      <p className="text-muted-foreground">
                        {money.format(financialQuery.data.valor_recebido)} foram recebidos antes do cancelamento e ainda não foram devolvidos ao cliente. Registre o estorno abaixo quando o reembolso for efetuado.
                      </p>
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex flex-wrap gap-6">
                      <div><p className="text-xs text-muted-foreground">Valor da locação</p><p className="font-semibold">{money.format(financialQuery.data.valor_original)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Recebido</p><p className="font-semibold text-emerald-600">{money.format(financialQuery.data.valor_recebido)}</p></div>
                      {financialQuery.data.valor_estornado > 0 && (
                        <div><p className="text-xs text-muted-foreground">Estornado</p><p className="font-semibold text-destructive">{money.format(financialQuery.data.valor_estornado)}</p></div>
                      )}
                      {["pendente", "parcial"].includes(financialQuery.data.status) && (
                        <div><p className="text-xs text-muted-foreground">A receber</p><p className="font-semibold text-amber-600">{money.format(financialQuery.data.valor_original - financialQuery.data.valor_recebido)}</p></div>
                      )}
                      <div><p className="text-xs text-muted-foreground">Condição</p><p className="font-medium">{financialQuery.data.forma_cobranca === "avista" ? "À vista" : "Parcelado"}</p></div>
                      <div>
                        <p className="text-xs text-muted-foreground">Status</p>
                        {financialQuery.data.requer_revisao_vencimento ? (
                          <Badge variant="outline" className="border-amber-500 text-amber-600">Revisar vencimento</Badge>
                        ) : (
                          <Badge variant={FINANCIAL_STATUS_BADGE[financialQuery.data.status]}>{FINANCIAL_STATUS_LABELS[financialQuery.data.status]}</Badge>
                        )}
                      </div>
                    </div>
                    {financialQuery.data.requer_revisao_vencimento && (
                      <p className="w-full text-xs text-amber-600">
                        Este título veio de um registro histórico (backfill) sem condição de pagamento conhecida - não é tratado como vencido. Defina um vencimento real quando revisar.
                      </p>
                    )}
                    {financialPermissions.registrarRecebimento && financialQuery.data.forma_cobranca === "avista" && ["pendente", "parcial"].includes(financialQuery.data.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReceiptInstallmentId(null);
                          setReceiptAmount(String(financialQuery.data!.valor_original - financialQuery.data!.valor_recebido));
                          setReceiptOpen(true);
                        }}
                      >
                        Registrar recebimento
                      </Button>
                    )}
                  </CardContent>

                  {financialQuery.data.forma_cobranca === "avista" && financialQuery.data.recebimentos.length > 0 && (
                    <CardContent className="border-t p-4 pt-3">
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">Histórico</p>
                      <div className="space-y-1">
                        {financialQuery.data.recebimentos.map((receipt) => (
                          <div key={receipt.id} className="flex items-center justify-between text-sm">
                            <span>{receipt.tipo === "estorno" ? "Estorno" : "Recebimento"} · {money.format(receipt.valor)} · {new Date(receipt.data_recebimento).toLocaleDateString("pt-BR")}{receipt.forma_pagamento ? ` · ${receipt.forma_pagamento}` : ""}</span>
                            {receipt.tipo === "recebimento" && financialPermissions.estornar && (
                              <Button size="sm" variant="ghost" onClick={() => openReverseDialog(receipt.id)}>Estornar</Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}

                  {financialQuery.data.forma_cobranca === "parcelado" && (
                    <CardContent className="border-t p-4 pt-3">
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">Parcelas</p>
                      <div className="space-y-2">
                        {financialQuery.data.parcelas.map((installment) => (
                          <div key={installment.id} className="rounded-md border p-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span>Parcela {installment.numero} · {money.format(installment.valor)} · vence {new Date(installment.vencimento).toLocaleDateString("pt-BR")}</span>
                              <div className="flex items-center gap-2">
                                <Badge variant={FINANCIAL_STATUS_BADGE[installment.status]}>{FINANCIAL_STATUS_LABELS[installment.status]}</Badge>
                                {financialPermissions.registrarRecebimento && ["pendente", "parcial"].includes(installment.status) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setReceiptInstallmentId(installment.id);
                                      setReceiptAmount(String(installment.valor - installment.valor_recebido));
                                      setReceiptOpen(true);
                                    }}
                                  >
                                    Receber
                                  </Button>
                                )}
                              </div>
                            </div>
                            {installment.recebimentos.length > 0 && (
                              <div className="mt-2 space-y-1 border-t pt-2">
                                {installment.recebimentos.map((receipt) => (
                                  <div key={receipt.id} className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>{receipt.tipo === "estorno" ? "Estorno" : "Recebimento"} · {money.format(receipt.valor)} · {new Date(receipt.data_recebimento).toLocaleDateString("pt-BR")}</span>
                                    {receipt.tipo === "recebimento" && financialPermissions.estornar && (
                                      <Button size="sm" variant="ghost" onClick={() => openReverseDialog(receipt.id)}>Estornar</Button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {permissions.reservar && actions.canConfirm && (
                hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO) ? (
                  <Button disabled={busy} onClick={openPaymentCondition}>Confirmar reserva</Button>
                ) : (
                  <Button disabled={busy} onClick={() => execute(() => confirmMaterialRental(companyId, rental.id, requestId("confirm")), "Reserva confirmada.")}>Confirmar reserva</Button>
                )
              )}
              {permissions.reservar && actions.canMarkReady && <Button disabled={busy} variant="outline" onClick={() => execute(() => markMaterialRentalReady(companyId, rental.id, requestId("ready")), "Locação pronta para retirada.")}>Marcar pronta</Button>}
              {permissions.editar && actions.canConclude && <Button disabled={busy} variant="outline" onClick={() => execute(() => concludeMaterialRental(companyId, rental.id, requestId("conclude")), "Locação concluída.")}>Concluir</Button>}
              <Button variant="ghost" size="sm" onClick={() => printReceipt("comprovante")}><Printer className="mr-2 h-4 w-4" />Imprimir comprovante</Button>
              {rental.itens.some((item) => item.quantidade_retirada > 0) && (
                <Button variant="ghost" size="sm" onClick={() => printReceipt("retirada")}><Printer className="mr-2 h-4 w-4" />Imprimir retirada</Button>
              )}
              {rental.itens.some((item) => item.quantidade_devolvida > 0) && (
                <Button variant="ghost" size="sm" onClick={() => printReceipt("devolucao")}><Printer className="mr-2 h-4 w-4" />Imprimir devolução</Button>
              )}
            </div>

            <Tabs defaultValue="itens">
              <TabsList><TabsTrigger value="itens">Itens e reservas</TabsTrigger><TabsTrigger value="operacao">Retirada / devolução</TabsTrigger><TabsTrigger value="historico">Histórico</TabsTrigger></TabsList>
              <TabsContent value="itens" className="space-y-4">
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm"><thead><tr className="border-b bg-muted/40 text-left"><th className="p-3">Material</th><th>Contratado</th><th>Retirado</th><th>Devolvido</th><th>Com cliente</th><th>Subtotal</th><th /></tr></thead><tbody>
                    {rental.itens.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="p-3"><strong>{item.material.nome}</strong><br /><span className="text-xs text-muted-foreground">{item.material.codigo_interno}</span></td><td>{item.quantidade_contratada}</td><td>{item.quantidade_retirada}</td><td>{item.quantidade_devolvida}</td><td>{item.quantidade_com_cliente}</td><td>{money.format(item.subtotal)}</td><td>{actions.canEdit && permissions.editar && <Button size="icon" variant="ghost" aria-label="Remover item" onClick={() => execute(() => removeMaterialRentalItem(companyId, rental.id, item.id), "Item removido.")}><Trash2 className="h-4 w-4" /></Button>}</td></tr>)}
                    {!rental.itens.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Adicione ao menos um material antes de confirmar a reserva.</td></tr>}
                  </tbody></table>
                </div>
                {actions.canEdit && permissions.editar && <Card><CardHeader><CardTitle className="text-base">Adicionar material</CardTitle></CardHeader><CardContent className="space-y-3">
                  <form className="flex gap-2" onSubmit={searchMaterials}><Input value={materialSearch} onChange={(event) => setMaterialSearch(event.target.value)} placeholder="Nome, código, QR, serial ou patrimônio" /><Button type="submit" variant="outline" disabled={busy}><ScanLine className="mr-2 h-4 w-4" />Buscar</Button></form>
                  {!!materials.length && <div className="grid gap-2 md:grid-cols-2">{materials.map((material) => <button type="button" key={material.id} onClick={() => { setSelectedMaterial(material); setQuantity(1); setUnitPrice(Number(material.valor_locacao_padrao ?? 0)); }} className={`rounded-md border p-3 text-left ${selectedMaterial?.id === material.id ? "border-primary bg-primary/5" : ""}`}><strong>{material.nome}</strong><p className="text-xs text-muted-foreground">{material.codigo_interno} · físico {material.estoque_fisico} · reservado {material.reservado} · disponível {material.disponivel}</p></button>)}</div>}
                  {selectedMaterial && <div className="grid gap-3 sm:grid-cols-4"><div><Label>Quantidade</Label><Input type="number" min={1} max={selectedMaterial.tipo_controle === "individual" ? 1 : selectedMaterial.disponivel} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div><div><Label>Valor unitário</Label><Input type="number" min={0} step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value))} /></div><div><Label>Desconto</Label><Input type="number" min={0} step="0.01" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></div><div className="flex items-end"><Button className="w-full" disabled={busy || quantity > selectedMaterial.disponivel} onClick={addItem}>Adicionar</Button></div></div>}
                </CardContent></Card>}
              </TabsContent>

              <TabsContent value="operacao" className="space-y-4">
                {permissions.retirar && actions.canCheckout && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4" />Realizar retirada</CardTitle></CardHeader><CardContent className="space-y-3">
                  <div className="flex gap-2"><Input value={scanner} onChange={(event) => setScanner(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); identifyCheckoutItem(); } }} placeholder="Escaneie QR/código ou busque o material contratado" /><Button type="button" variant="outline" onClick={() => setScannerCameraOpen(true)}><Camera className="mr-2 h-4 w-4" />Câmera</Button><Button variant="outline" onClick={() => identifyCheckoutItem()}><ScanLine className="mr-2 h-4 w-4" />Identificar</Button></div>
                  {checkoutItem && <div className="grid gap-3 sm:grid-cols-4"><div><Label>Material</Label><p className="pt-2 text-sm font-medium">{checkoutItem.material.nome}</p></div><div><Label>Quantidade</Label><Input type="number" min={1} max={checkoutItem.quantidade_pendente_retirada} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div><div><Label>Origem</Label><Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue placeholder="Local" /></SelectTrigger><SelectContent>{activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.nome}</SelectItem>)}</SelectContent></Select></div><div><Label>Responsável</Label><Select value={responsible} onValueChange={setResponsible}><SelectTrigger><SelectValue placeholder="Responsável" /></SelectTrigger><SelectContent>{responsibles.map((item) => <SelectItem key={`${item.tipo}:${item.id}`} value={`${item.tipo}:${item.id}`}>{item.nome}</SelectItem>)}</SelectContent></Select></div><div><Label>Condição</Label><Input value={condition} onChange={(event) => setCondition(event.target.value)} /></div><div className="flex items-end"><Button disabled={busy || !locationId || !responsible} onClick={checkout}>Confirmar retirada</Button></div></div>}
                </CardContent></Card>}
                {permissions.devolver && actions.canCheckin && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><RotateCcw className="h-4 w-4" />Receber materiais</CardTitle></CardHeader><CardContent className="space-y-3">
                  <div className="grid gap-2">{rental.custodias.filter((custody) => ["aberta", "parcial"].includes(custody.status)).map((custody) => { const item = rental.itens.find((entry) => entry.id === custody.referencia_id); return <Button key={custody.id} variant={checkinCustody?.id === custody.id ? "default" : "outline"} className="justify-between" onClick={() => { setCheckinCustody(custody); setQuantity(custody.quantidade_pendente); }}><span>{item?.material.nome ?? custody.material_id}</span><span>Pendente: {custody.quantidade_pendente}</span></Button>; })}</div>
                  {checkinCustody && <div className="grid gap-3 sm:grid-cols-4"><div><Label>Quantidade</Label><Input type="number" min={1} max={checkinCustody.quantidade_pendente} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></div><div><Label>Destino</Label><Select value={locationId} onValueChange={setLocationId}><SelectTrigger><SelectValue placeholder="Local" /></SelectTrigger><SelectContent>{activeLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.nome}</SelectItem>)}</SelectContent></Select></div><div><Label>Condição de retorno</Label><Input value={condition} onChange={(event) => setCondition(event.target.value)} /></div><div><Label>Ocorrência/avaria</Label><Input value={occurrence} onChange={(event) => setOccurrence(event.target.value)} /></div><div className="flex items-end"><Button disabled={busy || !locationId} onClick={checkin}>Confirmar devolução</Button></div></div>}
                </CardContent></Card>}
                {!actions.canCheckout && !actions.canCheckin && <p className="rounded-md border p-4 text-sm text-muted-foreground">Nenhuma ação física disponível para o estado atual.</p>}

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
                                <Button
                                  disabled={rfidBusy || !rfidLocationId || (activeRfidMode === "retirada" && !rfidResponsible)}
                                  onClick={confirmRfidBatch}
                                >
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
              </TabsContent>

              <TabsContent value="historico"><div className="space-y-2">{rental.historico.map((event) => <div key={event.id} className="rounded-md border p-3"><div className="flex justify-between gap-3"><strong>{event.descricao}</strong><span className="text-xs text-muted-foreground">{new Date(event.data_efetiva).toLocaleString("pt-BR")}</span></div><p className="text-xs text-muted-foreground">{event.executor_nome}</p></div>)}</div></TabsContent>
            </Tabs>

            {permissions.cancelar && actions.canCancel && <Card className="border-destructive/30"><CardContent className="space-y-2 p-4"><Label className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Cancelar e liberar reservas</Label><Textarea value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Justificativa obrigatória" /><Button variant="destructive" disabled={busy || !justification.trim()} onClick={() => execute(() => cancelMaterialRental(companyId, rental.id, justification, requestId("cancel")), "Locação cancelada; reservas liberadas.")}>Cancelar locação</Button></CardContent></Card>}
          </div>
        )}
      </DialogContent>

      <Dialog open={paymentConditionOpen} onOpenChange={setPaymentConditionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Condição de pagamento</DialogTitle>
            <DialogDescription>Defina como esta locação será cobrada antes de confirmar a reserva. O vencimento nunca é herdado automaticamente da data de devolução.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Forma de cobrança</Label>
              <Select
                value={paymentMode}
                onValueChange={(value) => {
                  const mode = value as "avista" | "parcelado";
                  setPaymentMode(mode);
                  if (mode === "parcelado") regenerateInstallments(installmentCount);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="avista">À vista</SelectItem>
                  <SelectItem value="parcelado">Parcelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentMode === "avista" && (
              <div className="space-y-2">
                <Label htmlFor="payment-due-date">Vencimento *</Label>
                <Input id="payment-due-date" type="date" value={paymentDueDate} onChange={(event) => setPaymentDueDate(event.target.value)} />
              </div>
            )}
            {paymentMode === "parcelado" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="installment-count">Número de parcelas</Label>
                  <Input id="installment-count" type="number" min={2} max={24} value={installmentCount} onChange={(event) => regenerateInstallments(Number(event.target.value))} />
                </div>
                <div className="space-y-2">
                  {installments.map((installment, index) => (
                    <div key={installment.numero} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{installment.numero}/{installments.length}</span>
                      <Input
                        type="number" min={0.01} step="0.01" value={installment.valor}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setInstallments((previous) => previous.map((item, itemIndex) => (itemIndex === index ? { ...item, valor: value } : item)));
                        }}
                      />
                      <Input
                        type="date" value={installment.vencimento}
                        onChange={(event) => {
                          const value = event.target.value;
                          setInstallments((previous) => previous.map((item, itemIndex) => (itemIndex === index ? { ...item, vencimento: value } : item)));
                        }}
                      />
                    </div>
                  ))}
                </div>
                <p className={`text-xs ${rental && installmentsSum === rental.valor_total ? "text-muted-foreground" : "text-destructive"}`}>
                  Soma das parcelas: {money.format(installmentsSum)} de {money.format(rental?.valor_total ?? 0)}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentConditionOpen(false)}>Cancelar</Button>
            <Button
              disabled={busy || (paymentMode === "avista" ? !paymentDueDate : !rental || installmentsSum !== rental.valor_total)}
              onClick={confirmWithPaymentCondition}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar reserva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
            <DialogDescription>
              {receiptTargetInstallment
                ? `Saldo pendente da parcela ${receiptTargetInstallment.numero}: ${money.format(receiptTargetInstallment.valor - receiptTargetInstallment.valor_recebido)}`
                : financialQuery.data && `Saldo pendente: ${money.format(financialQuery.data.valor_original - financialQuery.data.valor_recebido)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Valor recebido *</Label>
              <Input type="number" min={0} step="0.01" value={receiptAmount} onChange={(event) => setReceiptAmount(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select value={receiptMethod} onValueChange={setReceiptMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="cartao">Cartão</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptOpen(false)}>Cancelar</Button>
            <Button disabled={receiptMutation.isPending} onClick={() => receiptMutation.mutate()}>
              {receiptMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar recebimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Estornar recebimento</DialogTitle>
            <DialogDescription>O recebimento original é preservado no histórico; o estorno é uma movimentação nova e auditável.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="reverse-amount">Valor a estornar (em branco = valor total do recebimento)</Label>
              <Input id="reverse-amount" type="number" min={0} step="0.01" value={reverseAmount} onChange={(event) => setReverseAmount(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reverse-justification">Justificativa *</Label>
              <Textarea id="reverse-justification" value={reverseJustification} onChange={(event) => setReverseJustification(event.target.value)} placeholder="Motivo do estorno" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseOpen(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={reverseMutation.isPending || !reverseJustification.trim()} onClick={() => reverseMutation.mutate()}>
              {reverseMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar estorno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MaterialQrScanner open={scannerCameraOpen} onOpenChange={setScannerCameraOpen} onDetected={handleScannerQrDetected} />
    </Dialog>
  );
}
