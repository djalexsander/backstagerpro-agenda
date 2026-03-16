import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Settings, Save, Upload, Globe, Shield, Image } from "lucide-react";
import { toast } from "sonner";

type SettingsMap = Record<string, string | null>;

export default function ConfiguracoesSistema() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsMap>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["system-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value");
      if (error) throw error;
      const map: SettingsMap = {};
      data.forEach((row: any) => { map[row.key] = row.value; });
      return map;
    },
  });

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
    const ext = logoFile.name.split(".").pop();
    const path = `system/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("event-files")
      .upload(path, logoFile, { upsert: true });

    if (uploadError) {
      toast.error("Erro ao fazer upload da logo.");
      return;
    }

    const { data: urlData } = supabase.storage
      .from("event-files")
      .getPublicUrl(path);

    const url = urlData.publicUrl;
    setForm(prev => ({ ...prev, platform_logo_url: url }));
    setLogoPreview(url);
    toast.success("Logo enviada com sucesso!");
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
                disabled={!logoFile}
              >
                <Upload className="h-4 w-4 mr-1" /> Enviar
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
