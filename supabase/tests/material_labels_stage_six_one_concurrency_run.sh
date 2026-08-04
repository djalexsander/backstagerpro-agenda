#!/usr/bin/env bash
set -euo pipefail
root=/mnt/d/backstagerpro-agenda-main
db=stage61_concurrency
sudo -u postgres dropdb --if-exists "$db"
sudo -u postgres createdb -T stage6_clean "$db"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_labels_stage_six_one_concurrency_setup.sql" >/tmp/stage61_setup.log
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_labels_stage_six_one_concurrency_same.sql" >/tmp/stage61_same_a.log & a=$!
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_labels_stage_six_one_concurrency_same.sql" >/tmp/stage61_same_b.log & b=$!
wait "$a"; wait "$b"
same="$(sudo -u postgres psql -At -d "$db" -c "SELECT count(*)||':'||sum(quantidade_materiais)||':'||sum(quantidade_etiquetas) FROM public.etiqueta_solicitacoes WHERE client_uuid='d7000000-0000-4000-8000-000000000001'")"
items="$(sudo -u postgres psql -At -d "$db" -c "SELECT count(*)||':'||string_agg(quantidade::text,',' ORDER BY ordem) FROM public.etiqueta_solicitacao_itens WHERE solicitacao_id=(SELECT id FROM public.etiqueta_solicitacoes WHERE client_uuid='d7000000-0000-4000-8000-000000000001')")"
test "$same" = "1:3:22"; test "$items" = "3:10,4,8"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_labels_stage_six_one_concurrency_distinct_a.sql" >/tmp/stage61_distinct_a.log & c=$!
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_labels_stage_six_one_concurrency_distinct_b.sql" >/tmp/stage61_distinct_b.log & d=$!
wait "$c"; wait "$d"
distinct="$(sudo -u postgres psql -At -d "$db" -c "SELECT count(*)||':'||sum(quantidade_etiquetas) FROM public.etiqueta_solicitacoes WHERE client_uuid IN ('d7000000-0000-4000-8000-000000000002','d7000000-0000-4000-8000-000000000003')")"
test "$distinct" = "2:10"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/material_labels_stage_six_one_atomicity_test.sql" >/tmp/stage61_atomicity.log
printf 'PostgreSQL=%s\nsame_key=%s\nsame_items=%s\ndistinct_batches=%s\natomicity=PASS\n' "$(sudo -u postgres psql -At -d "$db" -c 'SHOW server_version')" "$same" "$items" "$distinct"
