BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(6);

-- Guards the fix in 20260806080000_fix_rental_status_sync_on_generic_checkin.sql:
-- registrar_checkin_material must keep material_locacoes.status in sync with
-- the real custody state even when the physical check-in happens through the
-- generic Check-in/Check-out screen, not through the rental's own
-- "Receber materiais" flow (registrar_devolucao_locacao_material).

SELECT has_function(
  'public', 'sync_material_rental_status', ARRAY['uuid', 'uuid'],
  'shared rental status sync function exists'
);

SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'registrar_checkin_material' AND pronamespace = 'public'::regnamespace)
  ILIKE '%sync_material_rental_status%',
  'registrar_checkin_material calls the shared status sync when checking in a rental custody'
);

-- The sync function must never mark a rental concluded/partially returned
-- unless every quantity accounted for actually passed through a completed
-- checkin (quantidade_devolvida on an open/partial custody, never a bare
-- "commercial return" action) - this is enforced by
-- material_rental_item_operational_totals being the only data source, which
-- this migration does not touch.
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'sync_material_rental_status' AND pronamespace = 'public'::regnamespace)
  ILIKE '%material_rental_item_operational_totals%',
  'status sync derives quantities from the canonical custody totals, not a duplicated source'
);

-- A rental must never be recomputed into 'concluida' while there is still
-- pending custody (com_cliente > 0) for any of its items.
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'sync_material_rental_status' AND pronamespace = 'public'::regnamespace)
  ILIKE '%v_pending = 0 AND v_all_delivered%',
  'status only becomes concluida when nothing is pending and everything was delivered'
);

-- The sync must respect the write-guard trigger contract already used by
-- every other rental-mutating RPC in this module (protect_material_rental_history).
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'sync_material_rental_status' AND pronamespace = 'public'::regnamespace)
  ILIKE '%backstage.material_rental_write%',
  'status sync sets the same write-guard flag as the other rental RPCs'
);

-- registrar_devolucao_locacao_material and concluir_locacao_material must
-- remain untouched by this migration (minimal, surgical fix).
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'concluir_locacao_material' AND pronamespace = 'public'::regnamespace)
  ILIKE '%LR017%',
  'concluir_locacao_material keeps blocking conclusion while custody is pending (LR017)'
);

SELECT * FROM finish();

ROLLBACK;
