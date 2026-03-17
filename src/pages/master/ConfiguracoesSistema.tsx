import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Save, Upload, Globe, Shield, Image } from "lucide-react";
import { toast } from "sonner";
import { useSystemSettings } from "@/hooks/useSystemSettings";

type SettingsMap = Record<string, string | null>;

export default function ConfiguracoesSistema() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsMap>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const { data: settings, isLoading } = useSystemSettings();

  useEffect(() => {
    if (settings) {
      setForm(settings);
      if (settings.platform_logo_url) {
        setLogoPreview(settings.platform_logo_url);
      }
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (updates: SettingsMap) => {
      const promises = Object.entries(updates).map(([key, value]) =>
        supabase
          .from("system_settings")
          .update({ value })
          .eq("key", key)
      );
      const results = await Promise.all(promises);
      const err = results.find(r => r.error);
      if (err?.error) throw err.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      toast.success("Configurações salvas com sucesso!");
    },
    onError: () => toast.error("Erro ao salvar configurações."),
  });

  const handleLogoUpload = async () => {
    if (!logoFile) return;

    setIsUploadingLogo(true);

    try {
      const ext = logoFile.name.split(".").pop()?.toLowerCase() || "png";
      const path = `system/logo-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("event-files")
        .upload(path, logoFile, { upsert: false });

      if (uploadError) {
        toast.error(`Erro ao fazer upload da logo: ${uploadError.message}`);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("event-files")
        .getPublicUrl(path);

      const url = `${urlData.publicUrl}?v=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("system_settings")
        .update({ value: url })
        .eq("key", "platform_logo_url");

      if (updateError) {
        toast.error("Upload concluído, mas não foi possível salvar a logo.");
        return;
      }

      setForm(prev => ({ ...prev, platform_logo_url: url }));
      setLogoPreview(url);
      setLogoFile(null);
      if (logoInputRef.current) logoInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      toast.success("Logo enviada com sucesso!");
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleSave = () => {
    saveMutation.mutate(form);
  };

  const updateField = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Configurações do Sistema</h1>
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Configurações do Sistema</h1>
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? "Salvando..." : "Salvar Alterações"}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Identidade da Plataforma */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Identidade da Plataforma
            </CardTitle>
            <CardDescription>Nome e marca exibidos no sistema.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="platform_name">Nome da Plataforma</Label>
              <Input
                id="platform_name"
                value={form.platform_name ?? ""}
                onChange={(e) => updateField("platform_name", e.target.value)}
                placeholder="Ex: Backstage Pro"
              />
            </div>
          </CardContent>
        </Card>

        {/* Logo */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Image className="h-5 w-5 text-primary" />
              Logo da Plataforma
            </CardTitle>
            <CardDescription>Logo exibida na sidebar e telas de login.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {logoPreview && (
              <div className="flex items-center justify-center p-4 rounded-lg bg-muted/50">
                <img
                  src={logoPreview}
                  alt="Logo"
                  className="max-h-16 object-contain"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setLogoFile(file);
                    setLogoPreview(URL.createObjectURL(file));
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogoUpload}
                disabled={!logoFile || isUploadingLogo}
              >
                <Upload className="h-4 w-4 mr-1" />
                {isUploadingLogo ? "Enviando..." : "Enviar"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Parâmetros Globais */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Parâmetros Globais
            </CardTitle>
            <CardDescription>Limites e padrões do sistema.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default_trial_days">Dias de Trial Padrão</Label>
              <Input
                id="default_trial_days"
                type="number"
                min={0}
                value={form.default_trial_days ?? "7"}
                onChange={(e) => updateField("default_trial_days", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Período de teste padrão ao criar uma nova empresa.
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="max_empresas">Máximo de Empresas</Label>
              <Input
                id="max_empresas"
                type="number"
                min={1}
                value={form.max_empresas ?? "100"}
                onChange={(e) => updateField("max_empresas", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Limite total de empresas cadastradas na plataforma.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* PIX */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Configuração PIX
            </CardTitle>
            <CardDescription>Dados para geração de QR Code PIX nas cobranças.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pix_tipo_chave">Tipo da Chave</Label>
              <Select
                value={form.pix_tipo_chave ?? "celular"}
                onValueChange={(val) => updateField("pix_tipo_chave", val)}
              >
                <SelectTrigger id="pix_tipo_chave">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpf">CPF</SelectItem>
                  <SelectItem value="cnpj">CNPJ</SelectItem>
                  <SelectItem value="celular">Celular</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="aleatoria">Chave Aleatória</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pix_chave">Chave PIX</Label>
              <Input
                id="pix_chave"
                value={form.pix_chave ?? ""}
                onChange={(e) => updateField("pix_chave", e.target.value)}
                placeholder={
                  form.pix_tipo_chave === "cpf" ? "000.000.000-00" :
                  form.pix_tipo_chave === "cnpj" ? "00.000.000/0000-00" :
                  form.pix_tipo_chave === "email" ? "email@exemplo.com" :
                  form.pix_tipo_chave === "aleatoria" ? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" :
                  "+5544999999999"
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pix_nome_recebedor">Nome do Recebedor</Label>
              <Input
                id="pix_nome_recebedor"
                value={form.pix_nome_recebedor ?? ""}
                onChange={(e) => updateField("pix_nome_recebedor", e.target.value)}
                placeholder="Backstage Pro Sistemas"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pix_cidade">Cidade</Label>
              <Input
                id="pix_cidade"
                value={form.pix_cidade ?? ""}
                onChange={(e) => updateField("pix_cidade", e.target.value)}
                placeholder="Maringá"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pix_banco">Banco</Label>
              <Input
                id="pix_banco"
                value={form.pix_banco ?? ""}
                onChange={(e) => updateField("pix_banco", e.target.value)}
                placeholder="Nubank, Itaú, etc."
              />
            </div>
          </CardContent>
        </Card>

        {/* Manutenção */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Segurança & Manutenção
            </CardTitle>
            <CardDescription>Controles de acesso ao sistema.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Modo Manutenção</Label>
                <p className="text-xs text-muted-foreground">
                  Quando ativo, apenas master admins podem acessar o sistema.
                </p>
              </div>
              <Switch
                checked={form.maintenance_mode === "true"}
                onCheckedChange={(checked) =>
                  updateField("maintenance_mode", checked ? "true" : "false")
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
