import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { REALTIME_DOMAINS, type RealtimeDomain } from "@/lib/realtime/realtime-domains";

export type CompanyRealtimeStatus = "connecting" | "connected" | "disconnected";

// Reusable Realtime layer: "terminals of the same company reflect each
// other's changes without a manual refresh" (desktop, browser, PWA/phone),
// built for Scanner Remoto but deliberately generic - it knows nothing
// about any specific feature, only "table X changed -> these React Query
// keys are stale" via the REALTIME_DOMAINS registry. A screen opts into the
// domains it cares about; it does not get every table in the app.
//
// This hook NEVER reads the Postgres Changes payload to update the UI - the
// handler below only ever calls queryClient.invalidateQueries(), which
// triggers a refetch through the normal RPC path (the actual source of
// authority). That is what guarantees a realtime event can never itself be
// treated as authoritative for a write, and that there is no
// realtime -> refetch -> write loop (there is no write path in this hook).
//
// Isolation is defense in depth, not this hook's own invention: the channel
// filter (`empresa_id=eq.<id>`) scopes which rows Postgres even evaluates
// for this subscription, and every domain table's own RLS SELECT policy
// (already tenant-scoped today, unchanged by this hook) is what actually
// decides whether this authenticated connection may see a given row - a
// mistake in the filter string could make a subscription miss rows, never
// leak another company's.
export function useCompanyRealtime(
  companyId: string | null | undefined,
  domains: readonly RealtimeDomain[],
): { status: CompanyRealtimeStatus } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CompanyRealtimeStatus>("connecting");
  const domainsKey = domains.join(",");

  useEffect(() => {
    if (!companyId || domains.length === 0) {
      setStatus("disconnected");
      return undefined;
    }

    setStatus("connecting");

    const invalidateDomain = (domain: RealtimeDomain) => {
      for (const prefix of REALTIME_DOMAINS[domain].queryKeyPrefixes) {
        void queryClient.invalidateQueries({ queryKey: [prefix, companyId] });
      }
    };

    const channel = supabase.channel(`company-realtime:${companyId}:${domainsKey}`);
    for (const domain of domains) {
      const config = REALTIME_DOMAINS[domain];
      for (const event of config.events) {
        channel.on(
          "postgres_changes",
          { event, schema: "public", table: config.table, filter: `empresa_id=eq.${companyId}` },
          () => invalidateDomain(domain),
        );
      }
    }

    channel.subscribe((subscribeStatus) => {
      if (subscribeStatus === "SUBSCRIBED") {
        setStatus("connected");
        // Postgres Changes does not replay a backlog after a drop, so a
        // reconnect (including this first connection) re-validates every
        // subscribed domain's cache from the real source of truth instead
        // of trusting whatever may have been missed while disconnected.
        domains.forEach(invalidateDomain);
      } else if (
        subscribeStatus === "CHANNEL_ERROR" ||
        subscribeStatus === "TIMED_OUT" ||
        subscribeStatus === "CLOSED"
      ) {
        setStatus("disconnected");
      }
    });

    return () => {
      void supabase.removeChannel(channel);
    };
    // domains is intentionally represented by domainsKey (a stable string)
    // instead of the array reference, since callers typically pass a fresh
    // array literal every render - depending on the reference would tear
    // down and rebuild the channel on every render instead of only when the
    // actual company/domain set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, domainsKey, queryClient]);

  return { status };
}
