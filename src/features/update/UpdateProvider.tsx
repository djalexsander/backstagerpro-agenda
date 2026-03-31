import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import {
  isTauri,
  registerPWAUpdate,
  installPWAUpdate,
  checkForTauriUpdate,
  installTauriUpdate,
} from "./UpdateService";
import { supabase } from "@/integrations/supabase/client";

interface UpdateContextType {
  updateAvailable: boolean;
  isUpdating: boolean;
  newVersion: string | null;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => void;
}

const UpdateContext = createContext<UpdateContextType | null>(null);

export const useUpdate = () => {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useUpdate must be used within UpdateProvider");
  return ctx;
};

export const UpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const autoInstallTriggered = useRef(false);

  useEffect(() => {
    if (isTauri()) {
      const checkTauri = async () => {
        const result = await checkForTauriUpdate();
        if (result.available) {
          setUpdateAvailable(true);
          setNewVersion(result.version || null);
          setDismissed(false);
        }
      };
      checkTauri();
      const interval = setInterval(checkTauri, 5 * 60 * 1000);
      return () => clearInterval(interval);
    } else {
      registerPWAUpdate((available) => {
        if (available) {
          setUpdateAvailable(true);
          setNewVersion(null);
          setDismissed(false);
        }
      });
    }
  }, []);

  // Auto-install when update_mode is "auto"
  useEffect(() => {
    if (!updateAvailable || autoInstallTriggered.current) return;

    const checkAutoMode = async () => {
      try {
        const { data } = await supabase
          .from("system_settings")
          .select("value")
          .eq("key", "update_mode")
          .maybeSingle();

        if (data?.value === "auto") {
          autoInstallTriggered.current = true;
          setIsUpdating(true);
          if (isTauri()) {
            await installTauriUpdate();
          } else {
            await installPWAUpdate();
          }
        }
      } catch (err) {
        console.warn("[UpdateProvider] Erro ao verificar modo de atualização:", err);
      }
    };

    checkAutoMode();
  }, [updateAvailable]);

  const installUpdate = useCallback(async () => {
    setIsUpdating(true);
    try {
      if (isTauri()) {
        await installTauriUpdate();
      } else {
        await installPWAUpdate();
      }
    } catch (err) {
      console.error("[UpdateProvider] Falha ao atualizar:", err);
      setIsUpdating(false);
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setDismissed(true);
  }, []);

  return (
    <UpdateContext.Provider
      value={{
        updateAvailable: updateAvailable && !dismissed,
        isUpdating,
        newVersion,
        installUpdate,
        dismissUpdate,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
};
