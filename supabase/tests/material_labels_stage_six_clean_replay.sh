#!/usr/bin/env bash
set -euo pipefail
db="stage6_clean"
root="/mnt/d/backstagerpro-agenda-main"
sudo -u postgres dropdb --if-exists "$db"
sudo -u postgres createdb -T template0 "$db"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/local_supabase_postgres_bootstrap.sql" >/tmp/stage6_clean_bootstrap.log
for migration in "$root"/supabase/migrations/*.sql; do
  case "$migration" in
    *20260404160835_5380c92d-a5a2-49e8-a9db-834d8e40df1a.sql) continue ;;
  esac
  printf 'APPLY %s\n' "$(basename "$migration")"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -1 -d "$db" -f "$migration" >/tmp/stage6_clean_last.log
done
sudo -u postgres psql -At -d "$db" <<'SQL'
SELECT 'version=' || current_setting('server_version');
SELECT 'models=' || to_regclass('public.etiqueta_modelos');
SELECT 'history=' || to_regclass('public.etiqueta_impressoes');
SELECT 'dependencies=' || count(*) FROM public.module_dependencies d JOIN public.module_catalog c ON c.id=d.module_id WHERE c.feature_key='etiquetas_materiais';
SQL
