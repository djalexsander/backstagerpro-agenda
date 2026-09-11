-- P1-15: public.financials has no integrity guard against negative monetary
-- values (cache, transport, food, lodging, other_costs) - a direct
-- PostgREST write from the client (Financeiro.tsx/EventosFinanceiroPanel.tsx
-- update these columns straight, no RPC) could store e.g. cache = -500 and
-- every downstream total (Dashboard, Financeiro, PDFs) would silently sum a
-- negative number into "recebido"/"despesas". Scope is the five direct
-- numeric columns only, matching the audit's own suggested shape - the
-- jsonb detail columns (cache_detail/transport_detail/lodging_detail/
-- extra_costs/funcionarios_cache) are already defensively coerced with
-- asNumber() at the read layer (src/lib/event-financials.ts) and are out of
-- scope here; a jsonb-array CHECK would need a helper function and is a
-- larger, separate change.
--
-- Remote zupcxxtnaglcappazciu.financials has 0 rows today (verified via
-- `supabase db query --linked` before writing this), so there is no
-- existing-data migration risk. Kept idempotent (DROP IF EXISTS + ADD)
-- matching empresas_document_shape (20260818160000) in case this is ever
-- re-run.
ALTER TABLE public.financials
  DROP CONSTRAINT IF EXISTS financials_amounts_non_negative;
ALTER TABLE public.financials
  ADD CONSTRAINT financials_amounts_non_negative CHECK (
    (cache IS NULL OR cache >= 0)
    AND (transport IS NULL OR transport >= 0)
    AND (food IS NULL OR food >= 0)
    AND (lodging IS NULL OR lodging >= 0)
    AND (other_costs IS NULL OR other_costs >= 0)
  );

COMMENT ON CONSTRAINT financials_amounts_non_negative ON public.financials IS
  'P1-15: cache/transport/food/lodging/other_costs may be NULL (not entered) but never negative.';
