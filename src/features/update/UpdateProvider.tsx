import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import {
  isTauri,
  registerPWAUpdate,
  installPWAUpdate,
  checkForTauriUpdate,
  installTauriUpdate,
  UpdateInstallError,
} from "./UpdateService";
import { supabase } from "@/integrations/supabase/client";

interface UpdateContextType {
  updateAvailable: boolean;
  isUpdating: boolean;
  newVersion: string | null;
  updateError: string | null;
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
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const autoInstallTriggered = useRef(false);

  useEffect(() => {
    if (isTauri()) {
      const checkTauri = async () => {
        const result = await checkForTauriUpdate();
        if (result.available) {
          setUpdateAvailable(true);
          setNewVersion(result.version || null);
          setUpdateError(null);
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
          setUpdateError(null);
          setDismissed(false);
        }
      });
    }
  }, []);

  // Single install path for both the manual "Atualizar agora" button and
  // the automatic mode below - keeps isUpdating/updateError handling in one
  // place instead of duplicating (and previously drifting: the old
  // auto-install branch never reset isUpdating on failure, leaving the
  // banner stuck on "Atualizando..." forever).
  const installUpdate = useCallback(async () => {
    setIsUpdating(true);
    setUpdateError(null);
    try {
      if (isTauri()) {
        await installTauriUpdate();
      } else {
        await installPWAUpdate();
      }
    } catch (err) {
      console.error("[UpdateProvider] Falha ao atualizar:", err);
      setUpdateError(
        err instanceof UpdateInstallError
          ? err.message
          : "Não foi possível concluir a atualização. Tente novamente mais tarde.",
      );
      setIsUpdating(false);
    }
  }, []);

  // Auto-install when update_mode is "auto". Only the system_settings read
  // is guarded by its own try/catch here (a missing/unreadable row just
  // means "stay manual", logged quietly) - actually performing the install
  // always goes through installUpdate() above, so a real install failure
  // gets the same user-visible handling as a manual click, not silently
  // swallowed as if it were a mode-check problem.
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
          await installUpdate();
        }
      } catch (err) {
        console.warn("[UpdateProvider] Erro ao verificar modo de atualização:", err);
      }
    };

    checkAutoMode();
  }, [updateAvailable, installUpdate]);

  const dismissUpdate = useCallback(() => {
    setDismissed(true);
  }, []);

  return (
    <UpdateContext.Provider
      value={{
        updateAvailable: updateAvailable && !dismissed,
        isUpdating,
        newVersion,
        updateError,
        installUpdate,
        dismissUpdate,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
};
