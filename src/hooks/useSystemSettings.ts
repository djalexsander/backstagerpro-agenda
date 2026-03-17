import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type SettingsMap = Record<string, string | null>;

const fetchSystemSettings = async (): Promise<SettingsMap> => {
  const { data, error } = await supabase.from("system_settings").select("key, value");

  if (error) throw error;

  return data.reduce<SettingsMap>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
};

export const useSystemSettings = () =>
  useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
    staleTime: 1000 * 60 * 5,
  });

export const usePlatformBranding = () => {
  const { data, isLoading } = useSystemSettings();

  return {
    platformName: data?.platform_name?.trim() || "Backstage Pro",
    platformLogoUrl: data?.platform_logo_url || null,
    isLoading,
  };
};
