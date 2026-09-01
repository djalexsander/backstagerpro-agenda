import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useEmpresaDados } from "@/hooks/useEmpresaDados";
import {
  BR_UFS,
  EMPRESA_DADOS_SELECT,
  emptyEmpresaForm,
  empresaFormFromDados,
  isValidEmpresaDocumento,
  normalizeEmpresaForm,
  type EmpresaDados,
  type EmpresaFormField,
  type EmpresaFormValues,
} from "@/lib/empresa-dados";
import { uploadCompanyLogo, removeCompanyLogo } from "@/lib/logo-service";
import { validateLogoFile } from "@/lib/logo-security";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_UF = "__none__";

const TEXT_FIELDS: Array<{
  field: Exclude<EmpresaFormField, "estado">;
  label: string;
  placeholder?: string;
  inputMode?: "text" | "email" | "tel" | "numeric";
  colSpan?: 1 | 2;
}> = [
  { field: "nome_empresa", label: "Nome da empresa / Nome fantasia", colSpan: 2 },
  { field: "razao_social", label: "Razão social", colSpan: 2 },
  { field: "cpf_cnpj", label: "CNPJ ou CPF", placeholder: "Somente números", inputMode: "numeric" },
  { field: "email", label: "E-mail", inputMode: "email" },
  { field: "telefone", label: "Telefone", inputMode: "tel" },
  { field: "whatsapp", label: "WhatsApp", inputMode: "tel" },
  { field: "cep", label: "CEP", placeholder: "Somente números", inputMode: "numeric" },
  { field: "endereco", label: "Endereço", colSpan: 2 },
  { field: "numero", label: "Número" },
  { field: "complemento", label: "Complemento" },
  { field: "bairro", label: "Bairro" },
  { field: "cidade", label: "Cidade" },
];

export default function ConfiguracoesEmpresa() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { empresaId, role, isMasterAdmin, refreshProfile } = useAuth();
  const { data: empresaDados, isLoading } = useEmpresaDados();

  const [form, setForm] = useState<EmpresaFormValues>(emptyEmpresaForm);
  const [documentoError, setDocumentoError] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Semeia o formulário quando os dados chegam (ou quando a empresa muda).
  // Depende só do id — um refetch por foco de janela não sobrescreve edições.
  useEffect(() => {
    setForm(empresaFormFromDados(empresaDados));
    setLogoPreview(empresaDados?.logo_url ?? null);
    setDocumentoError(null);
  }, [empresaDados?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (field: EmpresaFormField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "cpf_cnpj") setDocumentoError(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!empresaId) throw new Error("Empresa não identificada.");
      const payload = normalizeEmpresaForm(form);
      const { data, error } = await supabase
        .from("empresas")
        .update(payload)
        .eq("id", empresaId)
        .select(EMPRESA_DADOS_SELECT)
        .maybeSingle<EmpresaDados>();
      if (error) {
        if (error.code === "23505") {
          throw new Error("Este CNPJ/CPF já está cadastrado em outra empresa.");
        }
        if (error.code === "23514") {
          throw new Error("Algum campo não está no formato aceito. Revise o CPF/CNPJ.");
        }
        throw new Error(error.message || "Não foi possível salvar os dados da empresa.");
      }
      return data;
    },
    onSuccess: (data) => {
      if (data) {
        setForm(empresaFormFromDados(data));
        setLogoPreview(data.logo_url ?? null);
      }
      queryClient.invalidateQueries({ queryKey: ["empresa-dados"] });
      void refreshProfile();
      toast({ title: "Dados da empresa salvos!" });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }),
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!empresaId) throw new Error("Empresa não identificada.");
      validateLogoFile(file);
      const url = await uploadCompanyLogo({
        companyId: empresaId,
        actorCompanyId: empresaId,
        file,
        role,
      });
      const { error } = await supabase
        .from("empresas")
        .update({ logo_url: url })
        .eq("id", empresaId);
      if (error) throw new Error(error.message);
      return url;
    },
    onSuccess: (url) => {
      setLogoPreview(url);
      queryClient.invalidateQueries({ queryKey: ["empresa-dados"] });
      void refreshProfile();
      toast({ title: "Logo atualizada!" });
    },
    onError: (error: Error) => {
      setLogoPreview(empresaDados?.logo_url ?? null);
      toast({ title: "Não foi possível enviar a logo", description: error.message, variant: "destructive" });
    },
  });

  const removeLogoMutation = useMutation({
    mutationFn: async () => {
      if (!empresaId) throw new Error("Empresa não identificada.");
      await removeCompanyLogo({ companyId: empresaId, actorCompanyId: empresaId, role });
      const { error } = await supabase
        .from("empresas")
        .update({ logo_url: null })
        .eq("id", empresaId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setLogoPreview(null);
      queryClient.invalidateQueries({ queryKey: ["empresa-dados"] });
      void refreshProfile();
      toast({ title: "Logo removida!" });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível remover a logo", description: error.message, variant: "destructive" }),
  });

  const handleLogoSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      validateLogoFile(file);
    } catch (error) {
      toast({
        title: "Logo inválida",
        description: error instanceof Error ? error.message : "Arquivo inválido",
        variant: "destructive",
      });
      return;
    }
    setLogoPreview(URL.createObjectURL(file));
    uploadLogoMutation.mutate(file);
  };

  if (!empresaId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6" /> Empresa</h1>
        <p className="text-muted-foreground">
          {isMasterAdmin
            ? "Sua conta master não está vinculada a uma empresa operacional."
            : "Empresa não identificada."}
        </p>
      </div>
    );
  }

  const saving = saveMutation.isPending;
  const logoBusy = uploadLogoMutation.isPending || removeLogoMutation.isPending;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6" /> Empresa</h1>
        <p className="text-muted-foreground">
          Dados cadastrais da sua empresa. São usados nos documentos (contratos, riders, termos) e no cabeçalho dos PDFs.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Logo</CardTitle>
              <CardDescription>PNG, JPG ou WebP • máx. 2 MB</CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleLogoSelect}
              />
              <div className="flex items-center gap-3">
                {logoPreview ? (
                  <div className="h-16 w-16 rounded-lg border border-border overflow-hidden bg-muted">
                    <img src={logoPreview} alt="Logo da empresa" className="h-full w-full object-contain p-1" />
                  </div>
                ) : (
                  <div className="h-16 w-16 rounded-lg border border-dashed border-border flex items-center justify-center bg-muted/50">
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoBusy}
                  >
                    {logoBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                    {logoPreview ? "Trocar" : "Enviar"}
                  </Button>
                  {empresaDados?.logo_url && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => removeLogoMutation.mutate()}
                      disabled={logoBusy}
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Remover
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados cadastrais</CardTitle>
              <CardDescription>Só o nome é obrigatório. Os demais campos são opcionais.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!isValidEmpresaDocumento(normalizeEmpresaForm(form).cpf_cnpj)) {
                    setDocumentoError(
                      "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido, ou deixe em branco.",
                    );
                    return;
                  }
                  saveMutation.mutate();
                }}
              >
                {TEXT_FIELDS.map(({ field, label, placeholder, inputMode, colSpan }) => (
                  <div key={field} className={`space-y-2 ${colSpan === 2 ? "sm:col-span-2" : ""}`}>
                    <Label htmlFor={`empresa-${field}`}>
                      {label}
                      {field === "nome_empresa" && <span className="text-destructive"> *</span>}
                    </Label>
                    <Input
                      id={`empresa-${field}`}
                      value={form[field]}
                      inputMode={inputMode}
                      placeholder={placeholder}
                      onChange={(event) => setField(field, event.target.value)}
                    />
                    {field === "cpf_cnpj" && documentoError && (
                      <p className="text-xs text-destructive">{documentoError}</p>
                    )}
                  </div>
                ))}

                <div className="space-y-2">
                  <Label htmlFor="empresa-estado">Estado (UF)</Label>
                  <Select
                    value={form.estado || NO_UF}
                    onValueChange={(value) => setField("estado", value === NO_UF ? "" : value)}
                  >
                    <SelectTrigger id="empresa-estado">
                      <SelectValue placeholder="Selecione a UF" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_UF}>— Não informado —</SelectItem>
                      {BR_UFS.map((uf) => (
                        <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-2 flex justify-end pt-2">
                  <Button type="submit" disabled={saving || !form.nome_empresa.trim()}>
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Salvar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
