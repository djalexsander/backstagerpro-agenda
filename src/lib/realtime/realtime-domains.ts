import { CUSTODY_INVALIDATION_QUERY_KEYS } from "@/lib/checkin-checkout-service";
import { RENTAL_INVALIDATION_QUERY_KEYS } from "@/lib/material-rental-service";

export type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE";

// Domains registered for this first phase (Scanner Remoto + the screens it
// affects). Extending to another area of Backstage Pro (estoque,
// manutencao, financeiro, agenda, notificacoes, ...) means adding one entry
// here - useCompanyRealtime and every screen that calls it stay unchanged.
export type RealtimeDomain =
  | "material_custodias"
  | "material_locacoes"
  | "materiais"
  | "scanner_remoto_sessoes"
  | "scanner_remoto_leituras";

export interface RealtimeDomainConfig {
  /** Physical table name (schema "public") this domain listens to. */
  table: string;
  /**
   * Postgres Changes events to subscribe to. Existing operational tables
   * only need INSERT/UPDATE for the flows this phase covers (none of them
   * hard-delete these rows); the new Scanner Remoto tables also listen for
   * DELETE for completeness since they were created with REPLICA IDENTITY
   * FULL specifically to support it.
   */
  events: readonly RealtimeEvent[];
  /**
   * React Query key prefixes considered stale when this table changes.
   * companyId is appended by the caller (useCompanyRealtime), matching this
   * codebase's `[domain, companyId, ...]` query key convention.
   */
  queryKeyPrefixes: readonly string[];
}

// "Table X changed -> these query keys are stale for this company." Nothing
// here knows about Scanner Remoto specifically or about any UI - it is the
// single map the whole realtime layer is driven by. The custody/rental key
// lists are the exact same arrays useCheckinCheckout/useMaterialRentals use
// after their own local mutations (CUSTODY_INVALIDATION_QUERY_KEYS/
// RENTAL_INVALIDATION_QUERY_KEYS), so a realtime-triggered refetch and a
// local-mutation-triggered refetch can never drift apart.
export const REALTIME_DOMAINS: Record<RealtimeDomain, RealtimeDomainConfig> = {
  material_custodias: {
    table: "material_custodias",
    events: ["INSERT", "UPDATE"],
    queryKeyPrefixes: CUSTODY_INVALIDATION_QUERY_KEYS,
  },
  material_locacoes: {
    table: "material_locacoes",
    events: ["INSERT", "UPDATE"],
    queryKeyPrefixes: RENTAL_INVALIDATION_QUERY_KEYS,
  },
  materiais: {
    table: "materiais",
    events: ["INSERT", "UPDATE"],
    queryKeyPrefixes: ["materials", "stock-materials", "material-custodies"],
  },
  scanner_remoto_sessoes: {
    table: "scanner_remoto_sessoes",
    events: ["INSERT", "UPDATE", "DELETE"],
    queryKeyPrefixes: ["scanner-remoto-sessoes"],
  },
  scanner_remoto_leituras: {
    table: "scanner_remoto_leituras",
    events: ["INSERT", "UPDATE", "DELETE"],
    queryKeyPrefixes: ["scanner-remoto-leituras"],
  },
};
