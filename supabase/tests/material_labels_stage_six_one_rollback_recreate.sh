#!/usr/bin/env bash
set -euo pipefail
root=/mnt/d/backstagerpro-agenda-main
db=stage61_rollback
sudo -u postgres dropdb --if-exists "$db"
sudo -u postgres createdb -T template0 "$db"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/local_supabase_postgres_bootstrap.sql" >/tmp/stage61_rollback_bootstrap.log
for migration in "$root"/supabase/migrations/*.sql; do
  case "$migration" in
    *20260404160835_5380c92d-a5a2-49e8-a9db-834d8e40df1a.sql|*20260804120000_material_labels_stage_six_multi_material_fix.sql) continue ;;
  esac
  sudo -u postgres psql -v ON_ERROR_STOP=1 -1 -d "$db" -f "$migration" >/tmp/stage61_rollback_last.log
done
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_labels_stage_six_atomicity_test.sql" >/tmp/stage61_rollback_stage6_seed.log
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_labels_stage_six_one_compatibility_seed.sql" >/tmp/stage61_rollback_legacy.log
legacy="$(sudo -u postgres psql -At -d "$db" -c "SELECT id||':'||quantidade FROM public.etiqueta_impressoes WHERE client_uuid='b7000000-0000-4000-8000-000000000061'")"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_labels_stage_six_one_rollback_wrapper.sql" >/tmp/stage61_rollback_transaction.log
test "$(sudo -u postgres psql -At -d "$db" -c "SELECT to_regclass('public.etiqueta_solicitacoes') IS NULL")" = "t"
test "$(sudo -u postgres psql -At -d "$db" -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='etiqueta_modelos' AND column_name='margem_interna_mm'")" = "0"
sudo -u postgres psql -v ON_ERROR_STOP=1 -1 -d "$db" -f "$root/supabase/migrations/20260804120000_material_labels_stage_six_multi_material_fix.sql" >/tmp/stage61_recreate.log
backfill="$(sudo -u postgres psql -At -d "$db" -c "SELECT request.id||':'||request.quantidade_materiais||':'||request.quantidade_etiquetas||':'||item.quantidade FROM public.etiqueta_solicitacoes request JOIN public.etiqueta_solicitacao_itens item ON item.solicitacao_id=request.id WHERE request.client_uuid='b7000000-0000-4000-8000-000000000061'")"
test "${legacy%%:*}:1:3:3" = "$backfill"
printf 'rollback=PASS\nrecreate=PASS\nlegacy=%s\nbackfill=%s\n' "$legacy" "$backfill"
