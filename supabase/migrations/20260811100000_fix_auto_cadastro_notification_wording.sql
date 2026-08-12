-- Fix: the Master panel shows "Nova empresa aguardando confirmação" for
-- self-registered companies even though there is no manual master approval
-- step in this architecture (self-register/index.ts creates the company
-- active - status "ativo" - and only sends the responsible user's own
-- e-mail verification link). That wording implies a master decision is
-- pending, when it is not, and nothing ever updates it once the e-mail is
-- confirmed.
--
-- self-register/index.ts was already fixed to phrase future notifications
-- as a one-time action taken at signup ("link de confirmação enviado ao
-- responsável") instead of an open "aguardando" state. This migration
-- backfills that same wording onto notificacoes_master rows created by
-- previous versions of the function, so the Master panel stops showing the
-- stale, misleading message for companies that already self-registered.
-- Purely a text rewrite: does not touch empresas.status, notificacoes_master
-- read/unread state (lida), or any other column.

UPDATE public.notificacoes_master
SET mensagem = regexp_replace(
  mensagem,
  '^Nova empresa aguardando confirmação: (.*)$',
  'Novo auto-cadastro: \1 — link de confirmação enviado ao responsável.'
)
WHERE tipo = 'auto_cadastro'
  AND mensagem ~ '^Nova empresa aguardando confirmação: ';

UPDATE public.system_logs
SET descricao = regexp_replace(
  descricao,
  '^Auto cadastro aguardando confirmação[^:]*: (.*)$',
  'Auto cadastro criado: \1 - link de confirmação de e-mail enviado ao responsável'
)
WHERE tipo = 'auth'
  AND acao = 'auto_cadastro_pendente'
  AND descricao ~ '^Auto cadastro aguardando confirmação';
