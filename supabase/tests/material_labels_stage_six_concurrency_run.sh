#!/usr/bin/env bash
set -euo pipefail
db="stage6_validation"
root="/mnt/d/backstagerpro-agenda-main/supabase/tests"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/material_labels_stage_six_concurrency_a.sql" >/tmp/stage6_concurrency_a.out 2>&1 &
first_pid=$!
sleep 0.3
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/material_labels_stage_six_concurrency_b.sql" >/tmp/stage6_concurrency_b.out 2>&1
wait "$first_pid"
sudo -u postgres psql -At -d "$db" <<'SQL'
SELECT 'same_request_rows=' || count(*) FROM public.etiqueta_impressoes WHERE client_uuid='b7000000-0000-4000-8000-000000000002';
SELECT 'same_request_quantity=' || sum(quantidade) FROM public.etiqueta_impressoes WHERE client_uuid='b7000000-0000-4000-8000-000000000002';
SQL
