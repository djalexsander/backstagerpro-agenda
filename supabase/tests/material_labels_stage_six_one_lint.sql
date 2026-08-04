\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS plpgsql_check;
SELECT functionid::regprocedure AS function_name, lineno, sqlstate, message
FROM plpgsql_check_function_tb('public.registrar_solicitacao_impressao_lote_etiquetas(uuid,jsonb,uuid,timestamptz,uuid,uuid)'::regprocedure)
WHERE level IN ('error','warning');
SELECT functionid::regprocedure AS function_name, lineno, sqlstate, message
FROM plpgsql_check_function_tb('public.registrar_solicitacao_impressao_etiqueta(uuid,uuid,integer,uuid,uuid,uuid)'::regprocedure)
WHERE level IN ('error','warning');
SELECT functionid::regprocedure AS function_name, lineno, sqlstate, message
FROM plpgsql_check_function_tb('public.validate_material_label_batch_completeness()'::regprocedure,relid:='public.etiqueta_solicitacoes'::regclass)
WHERE level IN ('error','warning');
SELECT functionid::regprocedure AS function_name, lineno, sqlstate, message
FROM plpgsql_check_function_tb('public.validate_material_label_batch_item_completeness()'::regprocedure,relid:='public.etiqueta_solicitacao_itens'::regclass)
WHERE level IN ('error','warning');
SELECT functionid::regprocedure AS function_name, lineno, sqlstate, message
FROM plpgsql_check_function_tb('public.salvar_modelo_etiqueta_v2(text,numeric,numeric,text,jsonb,integer,boolean,numeric,numeric,text,boolean,uuid,timestamptz,uuid)'::regprocedure)
WHERE level IN ('error','warning');
