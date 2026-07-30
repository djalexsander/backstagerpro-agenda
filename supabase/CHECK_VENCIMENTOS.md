# Execução agendada de check-vencimentos

`check-vencimentos` é uma tarefa interna. Ela aceita apenas `POST` com o header
`x-internal-secret` igual ao secret `CHECK_VENCIMENTOS_SECRET` configurado na
Edge Function. O segredo deve ter no mínimo 32 caracteres e não deve ser
reutilizado em outras integrações.

O `verify_jwt = false` em `supabase/config.toml` é intencional: ele permite que
`pg_net` alcance o handler sem armazenar uma service-role key. Isso não torna a
função pública, pois o handler rejeita a chamada antes de criar o cliente
administrativo do Supabase.

## 1. Configurar o segredo da Edge Function

Gere um valor aleatório com um gerenciador de segredos ou, em um ambiente com
OpenSSL:

```sh
openssl rand -hex 32
```

Configure o valor em Edge Functions > Secrets com o nome:

```text
CHECK_VENCIMENTOS_SECRET
```

Não use prefixo `VITE_`, não grave o valor no `.env` versionado e não coloque o
segredo em URL ou query string.

## 2. Configurar o Vault

No Supabase Dashboard, abra Database > Vault e crie:

| Nome | Valor |
| --- | --- |
| `project_url` | `https://<project-ref>.supabase.co` |
| `check_vencimentos_secret` | o mesmo valor de `CHECK_VENCIMENTOS_SECRET` |

O Vault mantém o valor criptografado em repouso. Prefira a interface do Vault
para que o segredo não fique no histórico do SQL Editor.

## 3. Criar o cron job

As extensões `pg_cron` e `pg_net` já são habilitadas pela migration
`20260404160835_5380c92d-a5a2-49e8-a9db-834d8e40df1a.sql`.

Depois de publicar a função, execute no SQL Editor:

```sql
SELECT cron.schedule(
  'check-vencimentos-daily',
  '0 9 * * *',
  $job$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
    ) || '/functions/v1/check-vencimentos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'check_vencimentos_secret'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $job$
);
```

O exemplo executa diariamente às `09:00 UTC`, atualmente `06:00` no horário de
Brasília. Ajuste a expressão se outro horário operacional for necessário.

Não inclua `CHECK_VENCIMENTOS_SECRET` diretamente no comando do cron. O job
deve ler o valor do Vault em cada execução para permitir rotação.

## 4. Validar e monitorar

Confirme que o job existe:

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'check-vencimentos-daily';
```

Consulte as execuções recentes:

```sql
SELECT jobid, status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE jobid = (
  SELECT jobid
  FROM cron.job
  WHERE jobname = 'check-vencimentos-daily'
)
ORDER BY start_time DESC
LIMIT 20;
```

Confira também os logs da Edge Function. `pg_net` é assíncrono: um cron job
concluído confirma que a requisição foi enfileirada, não necessariamente que a
função terminou com sucesso.

Validações mínimas após o deploy:

1. `POST` sem header retorna `401`;
2. `POST` com segredo incorreto retorna `401`;
3. segredo em query string continua retornando `401`;
4. `GET` e `OPTIONS` retornam `405`;
5. `POST` com o header correto retorna `200`;
6. duas execuções no mesmo dia não duplicam notificações já existentes.

## Rotação e remoção

Na rotação, atualize primeiro o secret da Edge Function e imediatamente depois
o valor `check_vencimentos_secret` no Vault. Valide uma chamada e o próximo job.

Para remover o agendamento:

```sql
SELECT cron.unschedule('check-vencimentos-daily');
```
