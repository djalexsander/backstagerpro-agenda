\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION public.stage61_force_log_failure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW.tipo='etiquetas' AND NEW.acao='lote_impressao_solicitado' THEN RAISE EXCEPTION USING ERRCODE='ZX611',MESSAGE='forced stage 6.1 audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER stage61_force_log_failure BEFORE INSERT ON public.system_logs FOR EACH ROW EXECUTE FUNCTION public.stage61_force_log_failure();
SELECT set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000001',false); SET ROLE authenticated; SET search_path=public,extensions;
DO $$ BEGIN
  PERFORM public.registrar_solicitacao_impressao_lote_etiquetas((SELECT id FROM public.stage61_concurrency_ids WHERE name='model'),'[{"material_id":"d5000000-0000-4000-8000-000000000001","quantidade":6},{"material_id":"d5000000-0000-4000-8000-000000000002","quantidade":7}]','d7000000-0000-4000-8000-000000000099',NULL,NULL,'d2000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'forced failure was not raised';
EXCEPTION WHEN SQLSTATE 'ZX611' THEN NULL; END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.etiqueta_solicitacoes WHERE client_uuid='d7000000-0000-4000-8000-000000000099') THEN RAISE EXCEPTION 'header survived failed transaction'; END IF;
 IF EXISTS(SELECT 1 FROM public.etiqueta_solicitacao_itens item JOIN public.etiqueta_solicitacoes request ON request.id=item.solicitacao_id WHERE request.client_uuid='d7000000-0000-4000-8000-000000000099') THEN RAISE EXCEPTION 'items survived failed transaction'; END IF;
END $$;
DROP TRIGGER stage61_force_log_failure ON public.system_logs; DROP FUNCTION public.stage61_force_log_failure();
SELECT 'stage 6.1 atomicity PASS' AS result;
