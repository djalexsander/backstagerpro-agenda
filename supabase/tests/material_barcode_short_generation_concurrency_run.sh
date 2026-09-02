#!/usr/bin/env bash
set -euo pipefail

db="${BARCODE_TEST_DB:-material_barcode_short_concurrency}"
root="/mnt/d/backstagerpro-agenda-main"

if [[ "${BARCODE_TEST_REUSE_DB:-0}" != "1" ]]; then
  sudo -u postgres dropdb --if-exists "$db"
  sudo -u postgres createdb -T template0 "$db"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/local_supabase_postgres_bootstrap.sql" >/tmp/material_barcode_bootstrap.log

  for migration in "$root"/supabase/migrations/*.sql; do
    case "$migration" in
      *20260404160835_5380c92d-a5a2-49e8-a9db-834d8e40df1a.sql) continue ;;
    esac
    sudo -u postgres psql -v ON_ERROR_STOP=1 -1 -d "$db" -f "$migration" >/tmp/material_barcode_last_migration.log
  done
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_barcode_short_generation_concurrency_setup.sql" >/tmp/material_barcode_concurrency_setup.log
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_barcode_short_generation_concurrency_a.sql" >/tmp/material_barcode_concurrency_a.log 2>&1 &
first_pid=$!
sleep 0.3
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_barcode_short_generation_concurrency_b.sql" >/tmp/material_barcode_concurrency_b.log 2>&1
wait "$first_pid"

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
DO $$
DECLARE
  v_codes text[];
  v_counter integer;
BEGIN
  SELECT array_agg(codigo_barras ORDER BY codigo_barras), count(DISTINCT codigo_barras)
  INTO v_codes, v_counter
  FROM public.materiais
  WHERE id IN (
    '67500000-0000-4000-8000-000000000001',
    '67500000-0000-4000-8000-000000000002'
  );

  IF v_codes <> ARRAY['0000000018','0000000026']::text[] OR v_counter <> 2 THEN
    RAISE EXCEPTION 'Concurrent generation produced invalid codes: %', v_codes;
  END IF;

  SELECT ultima_sequencia INTO v_counter
  FROM public.material_barcode_counters
  WHERE empresa_id = '67200000-0000-4000-8000-000000000001';

  IF v_counter <> 2 THEN
    RAISE EXCEPTION 'Concurrent counter expected 2, got %', v_counter;
  END IF;
END;
$$;
SQL

printf 'material barcode concurrency: ok\n'
