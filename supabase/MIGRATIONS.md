# Segurança das migrations

## Migration destrutiva 20260320160649

A migration `20260320160649_78bfca57-3082-4c13-a43b-cee62f8783e5`
apagava eventos, arquivos, dados financeiros, empresas, pagamentos, perfis e
papéis de usuários.

O arquivo executável com esse timestamp foi substituído por um `NOTICE` seguro.
O SQL destrutivo original permanece preservado em:

```text
supabase/quarantined-migrations/
20260320160649_78bfca57-3082-4c13-a43b-cee62f8783e5.sql
```

SHA-256 do arquivo original antes da quarentena:

```text
B69658D44AF4DE49FF59B8BF820881563C4D2D75FD5E3B29217FF5048D9D56DB
```

Não mova o arquivo original de volta para `supabase/migrations`.

## Verificação remota

Com uma conta que tenha permissão suficiente no projeto:

```sh
npx supabase link --project-ref <project-ref>
npx supabase migration list --linked
```

Verifique se a coluna remota contém a versão `20260320160649`. Não execute
`migration repair`, `db push` ou qualquer SQL destrutivo apenas para realizar
essa consulta.

Antes de qualquer implantação, use também:

```sh
npx supabase db push --linked --dry-run
```

O plano deve mostrar a versão `20260320160649` como já aplicada ou como o no-op
seguro. Os `DELETE` arquivados nunca devem aparecer no plano.

## Ativação de contas

A migration `20260729193000_secure_account_activation.sql` adiciona o consumo
atômico do primeiro acesso. Antes de publicar as Edge Functions relacionadas,
configure `APP_URL` como secret do ambiente das funções, apontando para a origem
HTTPS oficial da aplicação.

Também adicione a URL exata `<APP_URL>/primeiro-acesso` à lista de Redirect URLs
permitidas em Authentication > URL Configuration. O Supabase ignora
silenciosamente um `redirectTo` não permitido e usa a Site URL.

Publique na seguinte ordem:

1. migration `20260729193000_secure_account_activation.sql`;
2. `activate-account` e `request-account-activation`;
3. `create-user` e `create-empresa-user`;
4. frontend.

Os links de convite e recuperação expiram conforme `Email OTP Expiration` no
Supabase Auth (uma hora por padrão). Não aumente esse prazo sem uma avaliação
de risco.

## Auto cadastro

A migration `20260729203000_secure_self_registration.sql` cria os contadores
atômicos usados para limitar o endpoint público `self-register`. Configure o
secret `REGISTRATION_RATE_LIMIT_SECRET` com pelo menos 32 caracteres aleatórios
antes de publicar a função.

Adicione também a URL exata `<APP_URL>/escolher-plano` às Redirect URLs
permitidas do Supabase Auth. O cadastro cria sempre um usuário não confirmado;
o acesso somente é liberado depois que o link de confirmação do Supabase for
consumido.

Publique primeiro a migration e somente depois a nova versão de
`self-register`.

## Escolha de plano e trial

A migration `20260729213000_secure_choose_plan.sql` adiciona o histórico
permanente de consumo do trial, centraliza as transições de plano na função
transacional `choose_company_plan` e bloqueia updates diretos nos campos de
assinatura.

Publique a migration antes da nova versão da Edge Function `choose-plan`.
Depois valide os fluxos de trial inicial, contratação paga inicial, conversão
de trial para pago, envio de comprovante e aprovação pelo master.

## Cobranças Asaas

A migration `20260729223000_secure_asaas_billing.sql` transfere para o banco a
autorização e o cálculo das cobranças. O navegador envia exatamente um
`plano_id` ou `modulo_id`; empresa, tipo, preço, vencimento, descrição e
relacionamentos são derivados pelo fluxo confiável.

A migration também remove a permissão de escrita do administrador da empresa
em `asaas_payments`, reserva a cobrança antes da chamada externa para evitar
duplicidade e protege lotes de módulos Asaas contra alteração pelo cliente.

Antes de publicar o webhook, configure `ASAAS_WEBHOOK_TOKEN` com o mesmo token
aleatório de pelo menos 32 caracteres cadastrado no webhook do Asaas. A função
recusa todas as confirmações quando o secret está ausente ou é curto.

Publique nesta ordem:

1. migration `20260729223000_secure_asaas_billing.sql`;
2. Edge Function `create-asaas-charge`;
3. Edge Function `asaas-webhook`.

Depois valide uma cobrança real de plano e uma de módulo no sandbox do Asaas,
incluindo a confirmação do webhook. A aplicação remota continua usando o fluxo
antigo até que migration e funções sejam publicadas.

### Processamento transacional do webhook

A migration `20260729233000_transactional_asaas_webhook.sql` cria o ledger
`asaas_webhook_events` e centraliza confirmação, ativação, log e notificação na
função transacional `process_asaas_payment_webhook`.

Uma entrega só é registrada como processada depois que toda a ativação termina.
Se qualquer escrita falhar, a transação inteira é revertida e uma nova entrega
do mesmo evento pode retomar o processamento. Eventos concluídos são
identificados pelo ID permanente enviado pelo Asaas e não repetem a ativação.

O webhook aceita o token exclusivamente no header `asaas-access-token`. Tokens
em query string não são aceitos.

Na publicação da etapa do webhook, use esta ordem:

1. migration `20260729223000_secure_asaas_billing.sql`;
2. migration `20260729233000_transactional_asaas_webhook.sql`;
3. Edge Function `create-asaas-charge`;
4. Edge Function `asaas-webhook`.

## Verificação agendada de vencimentos

`check-vencimentos` exige o secret interno `CHECK_VENCIMENTOS_SECRET`, com no
mínimo 32 caracteres, enviado exclusivamente no header `x-internal-secret`.
Chamadas públicas, métodos diferentes de `POST` e segredo ausente ou incorreto
são rejeitados antes do acesso com service role.

O `supabase/config.toml` declara `verify_jwt = false` somente para essa função.
A autenticação efetiva é feita no handler com o segredo dedicado, permitindo
que `pg_cron` e `pg_net` executem a tarefa sem armazenar uma service-role key.

Não existe cron job criado automaticamente pelas migrations. Configure secret,
Vault, horário, validações e monitoramento conforme
`supabase/CHECK_VENCIMENTOS.md`, depois publique `check-vencimentos`.

## Remoção segura de usuários

A migration `20260730003000_safe_company_user_removal.sql` separa a identidade
global do vínculo empresarial:

- `empresa_usuarios` passa a representar o conjunto de vínculos;
- `profiles.empresa_id` continua selecionando o tenant ativo e só pode apontar
  para um vínculo existente;
- remover o tenant ativo seleciona outro vínculo antes da exclusão da linha;
- `user_company_removal_audit` preserva ator, usuário, empresa, decisão e
  resultado da exclusão no Auth;
- `events.created_by` usa `ON DELETE SET NULL`, preservando eventos históricos
  quando a última identidade Auth é removida.

A Edge Function chama primeiro `detach_company_user`. Somente quando a
transação retorna zero vínculos restantes ela chama Supabase Auth. O resultado
externo é persistido por `finalize_user_auth_deletion`; falhas ficam retomáveis
como `failed`.

Alterações de vínculo e a decisão de excluir o Auth usam o mesmo bloqueio
transacional por usuário. Enquanto uma exclusão Auth estiver `pending` ou
`failed`, nenhum novo vínculo empresarial pode ser criado para aquela
identidade. Isso impede que uma inclusão concorrente apareça depois da
contagem de zero vínculos.

Esta migration sucede a consolidação de tenant
`20260729180000_consolidate_canonical_user_company.sql`. A consolidação anterior
foi ajustada localmente para não apagar vínculos adicionais nem criar
unicidade global por `user_id`. A nova migration reforça essa regra sem
permitir que o usuário altere diretamente o tenant ativo.

Antes do deploy, consulte o histórico remoto:

- se `20260729180000` ainda não foi aplicada, publique a versão local corrigida
  e depois `20260730003000`;
- se a versão antiga de `20260729180000` já foi aplicada, audite
  `empresa_usuarios` e restaure de backup quaisquer vínculos adicionais
  apagados antes de liberar exclusões;
- somente depois publique a nova versão de `delete-user` e o frontend.

## Backups administrativos

A migration `20260730013000_secure_backup_rls.sql` remove todas as policies
anteriores de `backups` e cria uma única regra administrativa:

- `admin_empresa` acessa somente backups do tenant ativo;
- `master_admin` mantém acesso administrativo global;
- `usuario`, `anon` e papéis desconhecidos não podem ler, criar, alterar ou
  excluir backups;
- `UPDATE` não é concedido ao cliente porque o fluxo só cria ou exclui
  registros imutáveis.

O campo `backups.payload` contém `financials`, portanto a migration deve ser
publicada antes do frontend desta etapa. A interface mantém a rota protegida,
valida novamente o papel antes de criar, exportar, importar, restaurar ou
excluir e limita arquivos importados a JSON de até 25 MB. As tabelas restauradas
continuam protegidas pelas respectivas policies administrativas.

## Storage privado dos eventos

A migration `20260730023000_secure_event_file_storage.sql` corrige a diferença
entre os comentários e as regras efetivas do bucket `event-files`:

- `usuario` pode gerar URL assinada somente para arquivos registrados em
  `event_files` e pertencentes ao tenant ativo;
- `admin_empresa` pode enviar, substituir e excluir somente arquivos de eventos
  da própria empresa ativa;
- `master_admin` mantém acesso administrativo global;
- objetos órfãos sem metadado em `event_files` não podem ser lidos;
- o bucket permanece privado e aceita somente PDF de até 20 MB;
- paths possuem exatamente a pasta UUID do evento e um nome PDF normalizado;
- a policy de `UPDATE` valida tanto o objeto atual quanto o estado novo.

Publique a migration antes do frontend. Depois teste leitura com `usuario`,
leitura e escrita com `admin_empresa`, acesso global com `master_admin` e
tentativas de upload, substituição e exclusão usando um evento de outro tenant.

## Logos de empresa por tenant

A migration `20260730033000_secure_company_logo_storage.sql` mantém o bucket
`logos` público para exibição de branding, mas restringe toda escrita:

- `admin_empresa` só pode escrever, substituir ou excluir
  `<empresa_ativa>/logo.<ext>`;
- `master_admin` pode gerenciar logos de empresas e os objetos
  `platform-logo-*`;
- `usuario` e `anon` não recebem permissão de escrita;
- `UPDATE` valida o path antigo e o novo, bloqueando movimentação para a pasta
  de outra empresa;
- novos uploads aceitam somente PNG, JPEG ou WebP de até 2 MB;
- SVG legado continua removível por um administrador, mas novos SVGs são
  recusados pelo bucket.

O cadastro de empresa cria primeiro a linha em `empresas` e só então envia o
logo para a pasta formada pelo ID retornado pelo banco. O autocadastro público
não recebe escrita anônima no Storage; um administrador confirmado poderá
enviar o logo da própria empresa depois de autenticado.
