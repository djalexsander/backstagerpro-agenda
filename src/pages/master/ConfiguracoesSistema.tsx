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
import { Save, Upload, Globe, Shield, Image } from "lucide-react";
import { toast } from "sonner";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPlatformLogo } from "@/lib/logo-service";
import { validateLogoFile } from "@/lib/logo-security";

type SettingsMap = Record<string, string | null>;

/** Keys that are actively used and should be saved */
const SAVEABLE_KEYS = [
  "platform_name",
  "platform_logo_url",
  "maintenance_mode",
  "update_mode",
];

export default function ConfiguracoesSistema() {
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const [form, setForm] = useState<SettingsMap>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const { data: settings, isLoading } = useSystemSettings();

  useEffect(() => {
    if (settings) {
      console.log("[ConfigSistema] Settings loaded from DB:", settings);
      setForm(settings);
      if (settings.platform_logo_url) {
        setLogoPreview(settings.platform_logo_url);
      }
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (updates: SettingsMap) => {
      // Only save keys that are actively used — never overwrite with empty/null
      const entries = Object.entries(updates).filter(
        ([key, value]) => SAVEABLE_KEYS.includes(key) && value !== undefined
      );

      console.log("[ConfigSistema] Saving settings:", entries);

      const promises = entries.map(([key, value]) =>
        supabase
          .from("system_settings")
          .update({ value, updated_at: new Date().toISOString() })
          .eq("key", key)
      );
      const results = await Promise.all(promises);
      const err = results.find(r => r.error);
      if (err?.error) throw err.error;

      console.log("[ConfigSistema] Settings saved successfully");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      toast.success("Configurações salvas com sucesso!");
    },
    onError: (e) => {
      console.error("[ConfigSistema] Error saving settings:", e);
      toast.error("Erro ao salvar configurações.");
    },
  });

  const handleLogoUpload = async () => {
    if (!logoFile) return;

    setIsUploadingLogo(true);

    try {
      const url = await uploadPlatformLogo({ file: logoFile, role });

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
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Erro ao fazer upload da logo: ${error.message}`
          : "Erro ao fazer upload da logo",
      );
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
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      validateLogoFile(file);
                      setLogoFile(file);
                      setLogoPreview(URL.createObjectURL(file));
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Logo inválida",
                      );
                      e.target.value = "";
                    }
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

        {/* Manutenção */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Segurança & Manutenção
            </CardTitle>
            <CardDescription>Controles de acesso e atualização do sistema.</CardDescription>
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

            <Separator />

            <div className="space-y-2">
              <Label>Modo de Atualização</Label>
              <p className="text-xs text-muted-foreground">
                Define como as empresas recebem novas versões do aplicativo.
              </p>
              <Select
                value={form.update_mode ?? "manual"}
                onValueChange={(val) => updateField("update_mode", val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o modo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual — Exibe banner para atualizar</SelectItem>
                  <SelectItem value="auto">Automático — Atualiza sem interação</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
