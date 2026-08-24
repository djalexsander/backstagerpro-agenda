-- Corrige dois problemas em listar_custodias_materiais causados pela
-- mesma origem (20260823090000 trocou a assinatura sem o cuidado que
-- troca de assinatura exige neste projeto): o overload de assinatura que
-- quebra a aba "Por Evento", e os REVOKE/GRANT que nunca foram emitidos
-- para a assinatura nova. Nenhum dos dois altera o corpo/comportamento da
-- função.
--
-- 20260823090000_custody_by_event_reference_filter.sql ampliou
-- listar_custodias_materiais de 12 para 14 parâmetros (inserindo
-- _referencia_tipo text DEFAULT NULL, _referencia_id uuid DEFAULT NULL
-- antes de _empresa_id) via CREATE OR REPLACE FUNCTION, mas sem o DROP
-- FUNCTION IF EXISTS que troca de assinatura exige neste projeto (mesmo
-- cuidado já documentado em 20260824090000_scanner_remoto_quantity_
-- confirmation.sql para registrar_leitura_scanner_remoto, citando
-- confirmar_reserva_locacao_material como precedente). Sem o DROP, a
-- assinatura antiga de 12 argumentos (definida em
-- 20260802160000_material_checkin_checkout_stage_three.sql, corpo
-- redefinido com a MESMA assinatura por 20260817270000_close_lost_
-- damaged_material_custody.sql) nunca foi removida - as duas convivem
-- como overloads distintos até hoje, o que pode causar "function is not
-- unique"/PGRST203 para chamadas que ambas atendem (ex.: listCustodyOperations,
-- a lista geral "Operações em aberto"), ou PGRST202 "function not found"
-- se apenas uma das duas estiver de fato aplicada/em cache no PostgREST -
-- e é exatamente essa segunda hipótese que explica a aba "Por Evento"
-- (EventCustodyPanel.tsx, via listCustodyOperationsByReference) falhar
-- com erro de operação de custódia ao selecionar um evento: ela é a única
-- chamada que sempre envia _referencia_tipo/_referencia_id nomeados,
-- parâmetros que só a assinatura de 14 argumentos tem.
--
-- Correção mínima: só remove a assinatura antiga de 12 argumentos. A
-- assinatura canônica de 14 argumentos já existe (criada por
-- 20260823090000), com o corpo e o comportamento que já tem hoje - nada
-- aqui a recria. Dropar a assinatura de 12 argumentos não afeta os grants
-- da de 14 (grants são por assinatura), então esse DROP sozinho não muda
-- nenhuma permissão.
DROP FUNCTION IF EXISTS public.listar_custodias_materiais(
  integer, integer, text, text, text, text, uuid, uuid, date, date, boolean, uuid
);

-- 20260823090000 nunca emitiu REVOKE/GRANT próprios para a assinatura de
-- 14 argumentos que criou - ela ficou sem o REVOKE ALL ... FROM PUBLIC,
-- anon, service_role / GRANT EXECUTE ... TO authenticated que toda outra
-- RPC de leitura deste módulo já tem (mesmo bloco, mesmas 3 roles
-- revogadas, confirmado abaixo para as 5 RPCs irmãs, todas de
-- 20260802160000_material_checkin_checkout_stage_three.sql linhas
-- 1300-1334): buscar_materiais_custodia, listar_custodias_materiais (a
-- própria, na sua antiga assinatura de 12 argumentos, removida acima),
-- obter_indicadores_custodia, listar_responsaveis_custodia,
-- listar_eventos_custodia. Sem REVOKE explícito, a função depende do
-- default do Postgres (EXECUTE concedido a PUBLIC em CREATE FUNCTION,
-- já que este projeto não usa ALTER DEFAULT PRIVILEGES para travar isso
-- globalmente) - mais aberta do que o padrão já estabelecido no resto do
-- módulo. Reaplica exatamente o mesmo padrão, agora para a assinatura de
-- 14 argumentos - corpo/comportamento da função continuam intocados.
REVOKE ALL ON FUNCTION public.listar_custodias_materiais(
  integer, integer, text, text, text, text, uuid, uuid, date, date, boolean,
  text, uuid, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.listar_custodias_materiais(
  integer, integer, text, text, text, text, uuid, uuid, date, date, boolean,
  text, uuid, uuid
) TO authenticated;
