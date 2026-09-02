import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  Copy,
  ImagePlus,
  Loader2,
  QrCode,
  ScanBarcode,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  EMPTY_MATERIAL_FORM,
  MATERIAL_IDENTIFICATION_TYPE_LABELS,
  MANUAL_MATERIAL_STATUSES,
  MATERIAL_STATUS_LABELS,
  MATERIAL_UNITS,
  type MaterialCategory,
  type MaterialFormValues,
  type MaterialPhoto,
  type MaterialWithRelations,
} from "@/lib/material-types";
import {
  buildMaterialQrContent,
  normalizeMaterialBarcode,
} from "@/lib/material-identification";
import {
  materialToForm,
  validateMaterialForm,
  type MaterialFormErrors,
} from "@/lib/material-domain";
import {
  generateMaterialBarcode,
  generateMaterialQrCode,
  saveMaterial,
} from "@/lib/material-service";
import { MaterialIdentificationPendingError } from "@/lib/material-errors";
import { MaterialBarcodePreview } from "./MaterialBarcodePreview";
import {
  removeMaterialPhoto,
  setMainMaterialPhoto,
  uploadMaterialPhoto,
} from "@/lib/material-photo-service";
import { MaterialPhotoGallery } from "./MaterialPhotoGallery";

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="text-xs text-destructive">{message}</p>
  ) : null;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full">
      <h3 className="font-semibold">{children}</h3>
      <Separator className="mt-2" />
    </div>
  );
}

export function MaterialFormDialog({
  open,
  onOpenChange,
  empresaId,
  categories,
  material,
  canGenerateIdentification,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string;
  categories: MaterialCategory[];
  material: MaterialWithRelations | null;
  canGenerateIdentification: boolean;
  onSaved: (materialId: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<MaterialFormValues>(
    EMPTY_MATERIAL_FORM,
  );
  const [errors, setErrors] = useState<MaterialFormErrors>({});
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);
  const [generateQrOnSave, setGenerateQrOnSave] = useState(true);
  const [persistedMaterialId, setPersistedMaterialId] = useState<string | null>(null);
  const [technicalIdentifier, setTechnicalIdentifier] = useState<string | null>(null);
  const [qrContent, setQrContent] = useState<string | null>(null);
  const [barcodeCopied, setBarcodeCopied] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const [confirmAutomaticBarcodeOpen, setConfirmAutomaticBarcodeOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(material ? materialToForm(material) : { ...EMPTY_MATERIAL_FORM });
    setErrors({});
    setPendingPhotos([]);
    setGenerateQrOnSave(
      !material && (material?.tipo_identificacao ?? "qr_code") !== "codigo_barras",
    );
    setPersistedMaterialId(material?.id ?? null);
    setTechnicalIdentifier(material?.identificador_unico ?? null);
    setQrContent(material?.conteudo_qr_code ?? null);
    setBarcodeCopied(false);
    setQrCopied(false);
    setConfirmAutomaticBarcodeOpen(false);
  }, [open, material]);

  const setField = <K extends keyof MaterialFormValues>(
    field: K,
    value: MaterialFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validation = validateMaterialForm(
        values,
        material,
        false,
      );
      if (Object.keys(validation).length > 0) {
        setErrors(validation);
        throw new Error("Revise os campos destacados.");
      }

      const currentMaterialId = material?.id ?? persistedMaterialId ?? undefined;
      let savedMaterial = await saveMaterial({
        empresaId,
        values,
        id: currentMaterialId,
        generateQrCode: !currentMaterialId && generateQrOnSave,
        generateBarcode: false,
      });

      if (currentMaterialId && generateQrOnSave && !qrContent) {
        const generatedQrContent = await generateMaterialQrCode(savedMaterial.id);
        savedMaterial = { ...savedMaterial, conteudo_qr_code: generatedQrContent };
      }

      const photoErrors: string[] = [];
      for (const [index, file] of pendingPhotos.entries()) {
        try {
          await uploadMaterialPhoto({
            empresaId,
            materialId: savedMaterial.id,
            file,
            main: !material?.fotos.length && index === 0,
          });
        } catch (error) {
          photoErrors.push(
            error instanceof Error ? error.message : `Falha em ${file.name}`,
          );
        }
      }

      return { materialId: savedMaterial.id, photoErrors };
    },
    onSuccess: async ({ materialId, photoErrors }) => {
      await onSaved(materialId);
      onOpenChange(false);
      toast({
        title: material ? "Material atualizado" : "Material cadastrado",
        description:
          photoErrors.length > 0
            ? `Cadastro salvo, mas ${photoErrors.length} foto(s) não foram enviadas.`
            : undefined,
        variant: photoErrors.length > 0 ? "destructive" : "default",
      });
    },
    onError: async (error: Error) => {
      if (error instanceof MaterialIdentificationPendingError) {
        await onSaved(error.materialId);
        onOpenChange(false);
      }
      toast({
        title:
          error instanceof MaterialIdentificationPendingError
            ? "Identificação pendente"
            : "Não foi possível salvar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const identificationMutation = useMutation({
    mutationFn: async (kind: "barcode" | "qr") => {
      const currentMaterialId = material?.id ?? persistedMaterialId;
      if (currentMaterialId) {
        const generatedValue = kind === "barcode"
          ? await generateMaterialBarcode(currentMaterialId)
          : await generateMaterialQrCode(currentMaterialId);
        return {
          kind,
          materialId: currentMaterialId,
          barcode: kind === "barcode" ? generatedValue : values.codigo_barras.trim() || null,
          qr: kind === "qr" ? generatedValue : qrContent,
          identifier: technicalIdentifier,
          createdDraft: false,
        };
      }

      const willHaveBarcode = kind === "barcode" || Boolean(values.codigo_barras.trim());
      const willHaveQr = kind === "qr";
      const generationValues: MaterialFormValues = {
        ...values,
        codigo_barras: kind === "barcode" ? "" : values.codigo_barras,
        tipo_identificacao: willHaveBarcode && willHaveQr
          ? "ambos"
          : willHaveBarcode
            ? "codigo_barras"
            : "qr_code",
      };
      const validation = validateMaterialForm(generationValues, null, kind === "barcode");
      if (Object.keys(validation).length > 0) {
        setErrors(validation);
        throw new Error("Preencha os campos obrigatórios antes de gerar a identificação.");
      }

      const created = await saveMaterial({
        empresaId,
        values: generationValues,
        generateQrCode: kind === "qr",
        generateBarcode: kind === "barcode",
      });
      return {
        kind,
        materialId: created.id,
        barcode: created.codigo_barras,
        qr: created.conteudo_qr_code,
        identifier: created.identificador_unico,
        createdDraft: true,
      };
    },
    onSuccess: (result) => {
      setPersistedMaterialId(result.materialId);
      setTechnicalIdentifier(result.identifier);
      setQrContent(result.qr);
      setValues((current) => {
        const barcode = result.barcode ?? current.codigo_barras;
        const hasQr = Boolean(result.qr);
        const hasBarcode = Boolean(barcode.trim());
        return {
          ...current,
          codigo_barras: barcode,
          tipo_identificacao: hasQr && hasBarcode
            ? "ambos"
            : hasBarcode
              ? "codigo_barras"
              : "qr_code",
        };
      });
      if (result.kind === "qr") setGenerateQrOnSave(true);
      setBarcodeCopied(false);
      setQrCopied(false);
      toast({
        title: result.kind === "qr" ? "QR Code gerado" : "Código de barras gerado",
        description: result.createdDraft
          ? "O material foi salvo para reservar sua identificação. Continue a edição e conclua em Salvar material."
          : undefined,
      });
    },
    onError: (error: Error) => {
      if (error instanceof MaterialIdentificationPendingError) {
        setPersistedMaterialId(error.materialId);
      }
      toast({
        title: "Não foi possível gerar a identificação",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const copyBarcode = async () => {
    if (!values.codigo_barras.trim()) return;
    try {
      await navigator.clipboard.writeText(values.codigo_barras.trim());
      setBarcodeCopied(true);
      window.setTimeout(() => setBarcodeCopied(false), 1500);
    } catch {
      toast({
        title: "Não foi possível copiar o código de barras",
        variant: "destructive",
      });
    }
  };

  const requestAutomaticBarcode = () => {
    if (values.codigo_barras.trim()) {
      setConfirmAutomaticBarcodeOpen(true);
      return;
    }
    identificationMutation.mutate("barcode");
  };

  const requestQrCode = () => {
    if (qrContent && technicalIdentifier) {
      setQrContent(buildMaterialQrContent(technicalIdentifier));
      toast({ title: "Visualização do QR Code reconstruída" });
      return;
    }
    identificationMutation.mutate("qr");
  };

  const copyQrContent = async () => {
    if (!qrContent) return;
    try {
      await navigator.clipboard.writeText(qrContent);
      setQrCopied(true);
      window.setTimeout(() => setQrCopied(false), 1500);
    } catch {
      toast({ title: "Não foi possível copiar o conteúdo do QR Code", variant: "destructive" });
    }
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen || material || !persistedMaterialId) {
      onOpenChange(nextOpen);
      return;
    }
    void onSaved(persistedMaterialId).finally(() => onOpenChange(false));
  };

  const handleSetMain = async (photo: MaterialPhoto) => {
    if (!material) return;
    setBusyPhotoId(photo.id);
    try {
      await setMainMaterialPhoto({
        empresaId,
        materialId: material.id,
        photoId: photo.id,
      });
      await onSaved(material.id);
    } catch (error) {
      toast({
        title: "Não foi possível definir a foto principal",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyPhotoId(null);
    }
  };

  const handleRemovePhoto = async (photo: MaterialPhoto) => {
    if (!material) return;
    setBusyPhotoId(photo.id);
    try {
      await removeMaterialPhoto({
        empresaId,
        materialId: material.id,
        photoId: photo.id,
        storagePath: photo.storage_path,
      });
      await onSaved(material.id);
      toast({ title: "Foto removida" });
    } catch (error) {
      toast({
        title: "Não foi possível remover a foto",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyPhotoId(null);
    }
  };

  const activeCategories = categories.filter(
    (category) => category.ativo || category.id === values.categoria_id,
  );
  const statusChanged =
    !!material && material.status_operacional !== values.status_operacional;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {material ? "Editar material" : "Cadastrar material"}
          </DialogTitle>
          <DialogDescription>
            {material
              ? "Atualize os dados permitidos sem alterar a identidade técnica do material."
              : "Preencha os dados e prepare as identificações antes de salvar."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!saveMutation.isPending) saveMutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <SectionTitle>Identificação</SectionTitle>
            <div className="space-y-2">
              <Label htmlFor="material-code">Código interno *</Label>
              <Input
                id="material-code"
                value={values.codigo_interno}
                onChange={(event) =>
                  setField("codigo_interno", event.target.value)
                }
              />
              <FieldError message={errors.codigo_interno} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-name">Nome *</Label>
              <Input
                id="material-name"
                value={values.nome}
                onChange={(event) => setField("nome", event.target.value)}
              />
              <FieldError message={errors.nome} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="material-description">Descrição</Label>
              <Textarea
                id="material-description"
                value={values.descricao}
                onChange={(event) =>
                  setField("descricao", event.target.value)
                }
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-serial">Número de série</Label>
              <Input
                id="material-serial"
                value={values.numero_serie}
                onChange={(event) =>
                  setField("numero_serie", event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-asset-number">
                Número de patrimônio
              </Label>
              <Input
                id="material-asset-number"
                value={values.numero_patrimonio}
                onChange={(event) =>
                  setField("numero_patrimonio", event.target.value)
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Tipo de identificação</Label>
              <Select
                value={values.tipo_identificacao}
                disabled={!canGenerateIdentification}
                onValueChange={(value) => {
                  setField(
                    "tipo_identificacao",
                    value as MaterialFormValues["tipo_identificacao"],
                  );
                  if (!material) {
                    setGenerateQrOnSave(value !== "codigo_barras");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MATERIAL_IDENTIFICATION_TYPE_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Escolha quais identificações deseja usar neste material.
              </p>
            </div>
            <div
              className={`grid min-w-0 gap-4 sm:col-span-2 ${
                values.tipo_identificacao === "ambos" ? "lg:grid-cols-2" : ""
              }`}
              data-testid="material-identification-cards"
            >
              {values.tipo_identificacao !== "qr_code" && (
                <section
                  className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-lg border bg-card p-4 shadow-sm"
                  data-testid="material-barcode-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">Código de barras</h3>
                      <p className="text-xs text-muted-foreground">Identificação rápida para leitura no scanner.</p>
                    </div>
                    {!material?.codigo_barras && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={requestAutomaticBarcode}
                        disabled={!canGenerateIdentification || identificationMutation.isPending}
                      >
                        {identificationMutation.isPending && identificationMutation.variables === "barcode" ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ScanBarcode className="mr-2 h-4 w-4" />
                        )}
                        {identificationMutation.isPending && identificationMutation.variables === "barcode"
                          ? "Gerando..."
                          : "Gerar código automático"}
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="material-barcode">Código de barras</Label>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                      <Input
                        id="material-barcode"
                        className="min-w-0"
                        value={values.codigo_barras}
                        onChange={(event) => setField("codigo_barras", event.target.value)}
                        onBlur={() =>
                          setField(
                            "codigo_barras",
                            normalizeMaterialBarcode(values.codigo_barras) ?? "",
                          )
                        }
                        disabled={!canGenerateIdentification}
                        placeholder="Ainda não gerado"
                        maxLength={80}
                      />
                      {values.codigo_barras.trim() && (
                        <Button type="button" variant="ghost" size="sm" onClick={copyBarcode}>
                          {barcodeCopied ? (
                            <Check className="mr-2 h-4 w-4" />
                          ) : (
                            <Copy className="mr-2 h-4 w-4" />
                          )}
                          {barcodeCopied ? "Copiado" : "Copiar"}
                        </Button>
                      )}
                    </div>
                    <FieldError message={errors.codigo_barras} />
                  </div>

                  {identificationMutation.isError && identificationMutation.variables === "barcode" && (
                    <p className="text-sm text-destructive" role="alert">
                      Não foi possível gerar o código. Tente novamente.
                    </p>
                  )}
                  {values.codigo_barras.trim() ? (
                    <div
                      className="flex min-h-28 min-w-0 items-center justify-center overflow-hidden rounded-md border bg-white p-2"
                      data-testid="material-barcode-preview"
                    >
                      <MaterialBarcodePreview value={values.codigo_barras.trim()} />
                    </div>
                  ) : (
                    <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                      O código e sua prévia aparecerão aqui.
                    </div>
                  )}
                </section>
              )}

              {values.tipo_identificacao !== "codigo_barras" && (
                <section
                  className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-lg border bg-card p-4 shadow-sm"
                  data-testid="material-qr-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">QR Code</h3>
                      <p className="text-xs text-muted-foreground">Identificação técnica única do material.</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={requestQrCode}
                      disabled={!canGenerateIdentification || identificationMutation.isPending}
                    >
                      {identificationMutation.isPending && identificationMutation.variables === "qr" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <QrCode className="mr-2 h-4 w-4" />
                      )}
                      {identificationMutation.isPending && identificationMutation.variables === "qr"
                        ? "Gerando..."
                        : "Gerar QR Code"}
                    </Button>
                  </div>

                  {identificationMutation.isError && identificationMutation.variables === "qr" && (
                    <p className="text-sm text-destructive" role="alert">
                      Não foi possível gerar o QR Code. Tente novamente.
                    </p>
                  )}
                  {qrContent ? (
                    <div
                      className="flex min-w-0 flex-1 flex-col items-center gap-3 rounded-md border bg-white p-3 text-foreground"
                      data-testid="material-qr-preview"
                    >
                      <QRCodeSVG
                        value={qrContent}
                        size={120}
                        level="M"
                        title={`QR Code de ${values.nome || "material"}`}
                      />
                      <div className="w-full min-w-0 space-y-2 text-xs">
                        <Label>Conteúdo</Label>
                        <code className="block break-all rounded bg-muted p-2 text-muted-foreground">
                          {qrContent}
                        </code>
                        {technicalIdentifier && (
                          <p className="break-all text-muted-foreground">
                            Identificador imutável: {technicalIdentifier}
                          </p>
                        )}
                        <Button type="button" variant="ghost" size="sm" onClick={copyQrContent}>
                          {qrCopied ? (
                            <Check className="mr-2 h-4 w-4" />
                          ) : (
                            <Copy className="mr-2 h-4 w-4" />
                          )}
                          {qrCopied ? "Copiado" : "Copiar conteúdo do QR"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                      O QR Code e seu conteúdo aparecerão aqui.
                    </div>
                  )}
                </section>
              )}
            </div>

            <SectionTitle>Classificação</SectionTitle>
            <div className="space-y-2">
              <Label>Categoria *</Label>
              <Select
                value={values.categoria_id}
                onValueChange={(value) => setField("categoria_id", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {activeCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.nome}
                      {!category.ativo ? " (inativa)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.categoria_id} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="material-brand">Marca</Label>
                <Input
                  id="material-brand"
                  value={values.marca}
                  onChange={(event) => setField("marca", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="material-model">Modelo</Label>
                <Input
                  id="material-model"
                  value={values.modelo}
                  onChange={(event) => setField("modelo", event.target.value)}
                />
              </div>
            </div>

            <SectionTitle>Controle de estoque</SectionTitle>
            <div className="space-y-2">
              <Label>Tipo de controle *</Label>
              <Select
                value={values.tipo_controle}
                onValueChange={(value: "individual" | "quantidade") =>
                  setField("tipo_controle", value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Item individual</SelectItem>
                  <SelectItem value="quantidade">
                    Item por quantidade
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Unidade *</Label>
              <Select
                value={values.unidade_medida}
                onValueChange={(value) => setField("unidade_medida", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_UNITS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.unidade_medida} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-minimum-stock">Estoque mínimo</Label>
              <Input
                id="material-minimum-stock"
                type="number"
                min="0"
                step="1"
                value={values.estoque_minimo}
                onChange={(event) =>
                  setField("estoque_minimo", event.target.value)
                }
              />
              <FieldError message={errors.estoque_minimo} />
            </div>
            <p className="col-span-full rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              O saldo não é editado neste cadastro. Use “Registrar saldo
              inicial” ou uma movimentação no módulo Estoque.
            </p>

            <SectionTitle>Situação operacional</SectionTitle>
            <div className="space-y-2">
              <Label>Status operacional</Label>
              <Select
                value={values.status_operacional}
                disabled={!material}
                onValueChange={(value) =>
                  setField(
                    "status_operacional",
                    value as MaterialFormValues["status_operacional"],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_MATERIAL_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {MATERIAL_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.status_operacional} />
              {!material && (
                <p className="text-xs text-muted-foreground">
                  Novos itens iniciam como Disponível.
                </p>
              )}
            </div>
            {statusChanged && values.status_operacional !== "disponivel" && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="material-status-reason">
                  Justificativa da alteração *
                </Label>
                <Textarea
                  id="material-status-reason"
                  value={values.justificativa_status}
                  onChange={(event) =>
                    setField("justificativa_status", event.target.value)
                  }
                  rows={2}
                />
                <FieldError message={errors.justificativa_status} />
              </div>
            )}

            <SectionTitle>Valores</SectionTitle>
            {(
              [
                ["valor_aquisicao", "Valor de aquisição"],
                ["valor_reposicao", "Valor de reposição"],
                ["valor_locacao_padrao", "Valor padrão de locação"],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={field}>{label}</Label>
                <Input
                  id={field}
                  inputMode="decimal"
                  value={values[field]}
                  onChange={(event) => setField(field, event.target.value)}
                  placeholder="0,00"
                />
                <FieldError message={errors[field]} />
              </div>
            ))}

            <SectionTitle>Aquisição</SectionTitle>
            <div className="space-y-2">
              <Label htmlFor="material-purchase-date">Data de aquisição</Label>
              <Input
                id="material-purchase-date"
                type="date"
                value={values.data_aquisicao}
                onChange={(event) =>
                  setField("data_aquisicao", event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-supplier">Fornecedor</Label>
              <Input
                id="material-supplier"
                value={values.fornecedor}
                onChange={(event) =>
                  setField("fornecedor", event.target.value)
                }
              />
            </div>

            <SectionTitle>Fotos</SectionTitle>
            {material && (
              <div className="sm:col-span-2">
                <MaterialPhotoGallery
                  photos={material.fotos}
                  materialName={material.nome}
                  canManage
                  busyPhotoId={busyPhotoId}
                  onSetMain={handleSetMain}
                  onRemove={handleRemovePhoto}
                />
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label
                htmlFor="material-photos"
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-4"
              >
                <ImagePlus className="h-5 w-5 text-primary" />
                Adicionar JPEG, PNG ou WebP, até 8 MB por arquivo
              </Label>
              <Input
                id="material-photos"
                type="file"
                multiple
                className="hidden"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) =>
                  setPendingPhotos(Array.from(event.target.files ?? []))
                }
              />
              {pendingPhotos.map((file, index) => (
                <div
                  key={`${file.name}-${file.size}`}
                  className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                >
                  <span className="truncate">{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setPendingPhotos((current) =>
                        current.filter((_, fileIndex) => fileIndex !== index),
                      )
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <SectionTitle>Observações</SectionTitle>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="material-notes">Observações</Label>
              <Textarea
                id="material-notes"
                value={values.observacoes}
                onChange={(event) =>
                  setField("observacoes", event.target.value)
                }
                rows={4}
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              disabled={saveMutation.isPending}
              onClick={() => handleDialogOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saveMutation.isPending || identificationMutation.isPending}>
              {saveMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {saveMutation.isPending ? "Salvando..." : "Salvar material"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <AlertDialog
        open={confirmAutomaticBarcodeOpen}
        onOpenChange={(open) =>
          !identificationMutation.isPending && setConfirmAutomaticBarcodeOpen(open)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir o código digitado?</AlertDialogTitle>
            <AlertDialogDescription>
              O valor manual ainda não persistido será substituído por um novo
              código automático de 10 dígitos gerado pelo servidor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={identificationMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={identificationMutation.isPending}
              onClick={() => identificationMutation.mutate("barcode")}
            >
              Confirmar e gerar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
