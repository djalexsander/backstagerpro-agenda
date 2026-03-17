import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_AUTO_BACKUPS = 10;

export function useAutoBackup() {
  const { empresaId, isAdmin } = useAuth();

  useEffect(() => {
    if (!empresaId || !isAdmin) return;

    async function checkAndCreateAutoBackup() {
      try {
        // Check last auto backup
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

        if (Date.now() - lastTime < AUTO_BACKUP_INTERVAL_MS) return;

        // Gather data
        const { data: eventos } = await supabase
          .from("events")
          .select("*")
          .eq("empresa_id", empresaId!);

        const eventIds = (eventos || []).map((e: any) => e.id);
        let eventDays: any[] = [];
        let eventFiles: any[] = [];
        let financials: any[] = [];

        if (eventIds.length > 0) {
          const [d, f, fin] = await Promise.all([
            supabase.from("event_days").select("*").in("event_id", eventIds),
            supabase.from("event_files").select("*").in("event_id", eventIds),
            supabase.from("financials").select("*").in("event_id", eventIds),
          ]);
          eventDays = d.data || [];
          eventFiles = f.data || [];
          financials = fin.data || [];
        }

        // Only create if there's data
        if (!eventos?.length) return;

        const now = new Date();
        const nome = `Backup Auto ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

        await supabase.from("backups").insert({
          empresa_id: empresaId,
          nome,
          tipo: "auto",
          payload: {
            empresa_id: empresaId,
            data_backup: now.toISOString(),
            eventos: eventos || [],
            event_days: eventDays,
            event_files: eventFiles,
            financials: financials,
          },
        } as any);

        // Cleanup old auto backups
        const { data: allAuto } = await supabase
          .from("backups")
          .select("id")
          .eq("empresa_id", empresaId!)
          .eq("tipo", "auto")
          .order("created_at", { ascending: false });

        if (allAuto && allAuto.length > MAX_AUTO_BACKUPS) {
          const toDelete = allAuto.slice(MAX_AUTO_BACKUPS).map((b: any) => b.id);
          await supabase.from("backups").delete().in("id", toDelete);
        }

        console.log("[AutoBackup] Backup automático criado.");
      } catch (err) {
        console.error("[AutoBackup] Erro:", err);
      }
    }

    checkAndCreateAutoBackup();
  }, [empresaId, isAdmin]);
}
