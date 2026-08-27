-- ============================================================================
-- SINO: excluir do proprio usuario as notificacoes ja lidas
-- ============================================================================
--
-- Estende o dominio de notificacoes de 20260819090000 com UMA RPC: o usuario
-- limpa do seu proprio sino as notificacoes que ja marcou como lidas.
--
-- Espelha marcar_todas_notificacoes_lidas() (mesma migration de fundacao):
-- sem parametro, SECURITY DEFINER, escopo travado em user_id = auth.uid() no
-- proprio WHERE - nunca alcanca a linha de outro usuario. Diferencas: DELETE
-- em vez de UPDATE, e filtro lida = true em vez de lida = false (notificacao
-- nao lida nunca e apagada).
--
-- Opera SO em notificacoes_destinatarios (a tabela de fan-out, onde vivem
-- lida/lida_em). A linha-mae em notificacoes fica intacta: os demais
-- destinatarios do mesmo evento ainda dependem dela. O ON DELETE CASCADE
-- entre as duas so existe no sentido oposto (apagar a notificacao apagaria os
-- destinatarios), entao nao ha efeito colateral sobre notificacoes aqui.
--
-- "Afeta o usuario, nao o dispositivo": o estado apagado E a propria linha no
-- banco; o sino sempre le de listar_minhas_notificacoes, nunca de storage
-- local - o mesmo usuario logado no desktop e no iPhone deixa de ver as
-- notificacoes excluidas nos dois.
--
-- Linhas orfas em notificacoes (uma notificacao cujos destinatarios foram
-- todos apagados) NAO sao varridas aqui - fora do escopo desta etapa.
--
-- REVOKE/GRANT identico as demais RPCs de sino da migration de fundacao:
-- sem acesso para PUBLIC/anon, EXECUTE so para authenticated.

CREATE OR REPLACE FUNCTION public.excluir_minhas_notificacoes_lidas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.notificacoes_destinatarios
  WHERE user_id = auth.uid() AND lida = true;
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_minhas_notificacoes_lidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_minhas_notificacoes_lidas() TO authenticated;
