#!/usr/bin/env bash
set +e
db="stage5_concurrency"
root="/mnt/d/backstagerpro-agenda-main/supabase/tests"

run_pair() {
  local name="$1"
  local first="$2"
  local second="$3"
  sudo -u postgres psql -d "$db" -f "$root/$first" >"/tmp/stage5_${name}_a.out" 2>&1 &
  local first_pid=$!
  sleep 0.3
  sudo -u postgres psql -d "$db" -f "$root/$second" >"/tmp/stage5_${name}_b.out" 2>&1
  local second_status=$?
  wait "$first_pid"
  local first_status=$?
  printf '%s_A=%s %s_B=%s\n' "$name" "$first_status" "$name" "$second_status"
  sed -n '/ERROR:/,$p' "/tmp/stage5_${name}_a.out"
  sed -n '/ERROR:/,$p' "/tmp/stage5_${name}_b.out"
}

run_pair OPEN equipment_maintenance_stage_five_concurrency_open_a.sql equipment_maintenance_stage_five_concurrency_open_b.sql
run_pair RENTAL equipment_maintenance_stage_five_concurrency_rental_a.sql equipment_maintenance_stage_five_concurrency_rental_b.sql
run_pair CHECKOUT equipment_maintenance_stage_five_concurrency_checkout_a.sql equipment_maintenance_stage_five_concurrency_checkout_b.sql
run_pair CLOSE equipment_maintenance_stage_five_concurrency_close_a.sql equipment_maintenance_stage_five_concurrency_close_b.sql

sudo -u postgres psql -At -d "$db" <<'SQL'
SELECT 'open_active=' || count(*) FROM public.manutencao_ordens WHERE material_id='a1000000-0000-4000-8000-000000000001' AND status IN ('aberta','aguardando_analise','em_manutencao','aguardando_peca');
SELECT 'rental_status=' || status FROM public.material_locacoes WHERE id=(SELECT id FROM public.stage5_concurrency_ids WHERE name='rental');
SELECT 'checkout_balance=' || quantidade FROM public.estoque_saldos WHERE material_id='a1000000-0000-4000-8000-000000000003';
SELECT 'checkout_rows=' || count(*) FROM public.material_custodias WHERE material_id='a1000000-0000-4000-8000-000000000003';
SELECT 'closing_status=' || status FROM public.manutencao_ordens WHERE id=(SELECT id FROM public.stage5_concurrency_ids WHERE name='closing');
SELECT 'closing_terminal_events=' || count(*) FROM public.manutencao_ordem_eventos WHERE ordem_id=(SELECT id FROM public.stage5_concurrency_ids WHERE name='closing') AND tipo IN ('conclusao','cancelamento');
SQL
