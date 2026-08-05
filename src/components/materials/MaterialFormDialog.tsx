import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  generateMaterialBarcodeValue,
  normalizeMaterialBarcode,
} from "@/lib/material-identification";
import {
  materialToForm,
  validateMaterialForm,
  type MaterialFormErrors,
} from "@/lib/material-domain";
import { saveMaterial } from "@/lib/material-service";
import { MaterialIdentificationPendingError } from "@/lib/material-errors";
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
  const [barcodeCopied, setBarcodeCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(material ? materialToForm(material) : { ...EMPTY_MATERIAL_FORM });
    setErrors({});
    setPendingPhotos([]);
    setGenerateQrOnSave(
      !material && (material?.tipo_identificacao ?? "qr_code") !== "codigo_barras",
    );
    setBarcodeCopied(false);
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
      const validation = validateMaterialForm(values, material);
      if (Object.keys(validation).length > 0) {
        setErrors(validation);
        throw new Error("Revise os campos destacados.");
      }

      const materialId = await saveMaterial({
        empresaId,
        values,
        id: material?.id,
        generateQrCode: !material && generateQrOnSave,
      });

      const photoErrors: string[] = [];
      for (const [index, file] of pendingPhotos.entries()) {
        try {
          await uploadMaterialPhoto({
            empresaId,
            materialId: materialId.id,
            file,
            main: !material?.fotos.length && index === 0,
          });
        } catch (error) {
          photoErrors.push(
            error instanceof Error ? error.message : `Falha em ${file.name}`,
          );
        }
      }

      return { materialId: materialId.id, photoErrors };
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

  const generateBarcode = () => {
    setField("codigo_barras", generateMaterialBarcodeValue());
    setBarcodeCopied(false);
  };

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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <div className="space-y-2">
              <Label htmlFor="material-barcode">
                Código de barras
                {(values.tipo_identificacao === "codigo_barras" ||
                  values.tipo_identificacao === "ambos") &&
                  " *"}
              </Label>
              <Input
                id="material-barcode"
                value={values.codigo_barras}
                onChange={(event) =>
                  setField("codigo_barras", event.target.value)
                }
                onBlur={() =>
                  setField(
                    "codigo_barras",
                    normalizeMaterialBarcode(values.codigo_barras) ?? "",
                  )
                }
                disabled={!canGenerateIdentification}
                placeholder="Compatível com Code 128"
                maxLength={80}
              />
              <FieldError message={errors.codigo_barras} />
              <p className="text-xs text-muted-foreground">
                Informe manualmente ou gere um valor aleatório compatível com
                Code 128.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={generateBarcode}
                  disabled={!canGenerateIdentification}
                >
                  <ScanBarcode className="mr-2 h-4 w-4" />
                  {values.codigo_barras
                    ? "Gerar outro código"
                    : "Gerar código de barras"}
                </Button>
                {!!values.codigo_barras.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={copyBarcode}
                  >
                    {barcodeCopied ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    {barcodeCopied ? "Copiado" : "Copiar"}
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2">
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
                O QR Code usa apenas o identificador técnico imutável.
              </p>
            </div>
            <div className="space-y-3 rounded-lg border p-4 sm:col-span-2">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="generate-material-qr"
                  checked={
                    material
                      ? !!material.conteudo_qr_code
                      : generateQrOnSave
                  }
                  disabled={
                    !!material ||
                    !canGenerateIdentification ||
                    values.tipo_identificacao === "qr_code"
                  }
                  onCheckedChange={(checked) => {
                    if (material) return;
                    const shouldGenerate = checked === true;
                    setGenerateQrOnSave(shouldGenerate);
                    if (
                      shouldGenerate &&
                      values.tipo_identificacao === "codigo_barras"
                    ) {
                      setField("tipo_identificacao", "ambos");
                    } else if (
                      !shouldGenerate &&
                      values.tipo_identificacao === "ambos"
                    ) {
                      setField("tipo_identificacao", "codigo_barras");
                    }
                  }}
                />
                <div className="space-y-1">
                  <Label htmlFor="generate-material-qr">
                    Gerar QR Code ao salvar
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {material
                      ? material.conteudo_qr_code
                        ? "O QR Code existente é imutável e não será recriado na edição."
                        : "A edição de campos comuns não cria um novo QR Code."
                      : generateQrOnSave
                        ? "O material será criado e o QR Code ficará disponível nesta mesma ação."
                        : "Este cadastro usará somente o código de barras."}
                  </p>
                </div>
              </div>
              {!material && generateQrOnSave && (
                <div className="flex items-center gap-3 rounded-md bg-muted p-3">
                  <QrCode className="h-8 w-8 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">
                      QR Code preparado no cadastro
                    </p>
                    <code className="text-xs text-muted-foreground">
                      BACKSTAGE-PRO:MATERIAL:&lt;UUID técnico imutável&gt;
                    </code>
                  </div>
                </div>
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
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {saveMutation.isPending ? "Salvando..." : "Salvar material"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
