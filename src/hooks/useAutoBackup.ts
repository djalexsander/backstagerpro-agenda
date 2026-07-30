import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createBackup } from "@/lib/backup-service";
import {
  AUTO_BACKUP_INTERVAL_MS,
  getLastLocalBackupTime,
  setLastLocalBackupTime,
} from "@/lib/backup-utils";
import { supabase } from "@/integrations/supabase/client";

export function useAutoBackup() {
  const { empresaId, isAdmin, role } = useAuth();

  useEffect(() => {
    if (!empresaId || !isAdmin) return;

    async function checkAndCreateAutoBackup() {
      try {
        // Check localStorage first (fast, avoids DB query)
        const localLast = getLastLocalBackupTime(empresaId!);
        if (Date.now() - localLast < AUTO_BACKUP_INTERVAL_MS) return;

        // Double-check against DB
        const { data: lastBackup } = await supabase
          .from("backups")
          .select("created_at")
          .eq("empresa_id", empresaId!)
          .eq("tipo", "auto")
          .order("created_at", { ascending: false })
          .limit(1);

        const lastTime = lastBackup?.[0]?.created_at
          ? new Date(lastBackup[0].created_at).getTime()
          : 0;

        if (Date.now() - lastTime < AUTO_BACKUP_INTERVAL_MS) {
          // Sync localStorage
          setLastLocalBackupTime(empresaId!);
          return;
        }

        await createBackup(empresaId!, "auto", role);
        console.log("[AutoBackup] Backup automático criado.");
      } catch (err) {
        console.error("[AutoBackup] Erro:", err);
      }
    }

    checkAndCreateAutoBackup();
  }, [empresaId, isAdmin, role]);
}
