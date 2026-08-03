\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION public.stage5_force_event_failure()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_setting('stage5.force_failure',true)=NEW.tipo::text THEN
    RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='forced stage5 atomicity failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage5_force_event_failure BEFORE INSERT ON public.manutencao_ordem_eventos
FOR EACH ROW EXECUTE FUNCTION public.stage5_force_event_failure();

INSERT INTO public.materiais (id,empresa_id,categoria_id,codigo_interno,nome,tipo_controle,status_operacional,ativo)
VALUES ('a1000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','M-ATOMIC','Atomicidade manutenção','individual','disponivel',true);
INSERT INTO public.estoque_saldos (empresa_id,material_id,localizacao_id,quantidade)
VALUES ('72000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000005','76000000-0000-4000-8000-000000000001',1);

SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated; SET search_path=public,extensions;
SELECT set_config('stage5.force_failure','criacao',false);
DO $$ BEGIN
  PERFORM public.criar_ordem_manutencao('a1000000-0000-4000-8000-000000000005','corretiva','alta','manual','Falha atômica','a4000000-0000-4000-8000-000000000001',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,NULL,NULL,'72000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'creation should have failed';
EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.manutencao_ordens WHERE client_uuid='a4000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'order survived failed history insert'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated; SET search_path=public,extensions;
SELECT set_config('stage5.force_failure','',false);
CREATE TEMP TABLE atomic_order AS SELECT id,updated_at FROM public.criar_ordem_manutencao('a1000000-0000-4000-8000-000000000005','corretiva','alta','manual','Falha atômica','a4000000-0000-4000-8000-000000000002',1,NULL,NULL,NULL,NULL,NULL,'interna',NULL,NULL,NULL,'72000000-0000-4000-8000-000000000001');
UPDATE atomic_order SET updated_at=(SELECT updated_at FROM public.atualizar_ordem_manutencao((SELECT id FROM atomic_order),'a4000000-0000-4000-8000-000000000003',(SELECT updated_at FROM atomic_order),'alta','Diagnóstico','Serviço',NULL,NULL,NULL,'operacional',NULL,'interna',NULL,NULL,20,0,0,'72000000-0000-4000-8000-000000000001'));
UPDATE atomic_order SET updated_at=(SELECT updated_at FROM public.transicionar_ordem_manutencao((SELECT id FROM atomic_order),'em_manutencao','a4000000-0000-4000-8000-000000000004',(SELECT updated_at FROM atomic_order),NULL,NULL,'72000000-0000-4000-8000-000000000001'));
SELECT set_config('stage5.force_failure','conclusao',false);
DO $$ BEGIN
  PERFORM public.transicionar_ordem_manutencao((SELECT id FROM atomic_order),'concluida','a4000000-0000-4000-8000-000000000005',(SELECT updated_at FROM atomic_order),NULL,NULL,'72000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'completion should have failed';
EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM public.manutencao_ordens WHERE id=(SELECT id FROM atomic_order)) <> 'em_manutencao' THEN RAISE EXCEPTION 'status survived failed completion history'; END IF;
  IF EXISTS(SELECT 1 FROM public.manutencao_ordem_eventos WHERE ordem_id=(SELECT id FROM atomic_order) AND tipo='conclusao') THEN RAISE EXCEPTION 'completion history survived forced failure'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated; SET search_path=public,extensions;
SELECT set_config('stage5.force_failure','insumo_adicionado',false);
DO $$ BEGIN
  PERFORM public.salvar_insumo_ordem_manutencao((SELECT id FROM atomic_order),'Peça atômica',1,'un',50,'a4000000-0000-4000-8000-000000000006',NULL,'72000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'supply should have failed';
EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.manutencao_ordem_insumos WHERE ordem_id=(SELECT id FROM atomic_order)) THEN RAISE EXCEPTION 'supply survived failed event'; END IF;
  IF (SELECT custo_pecas FROM public.manutencao_ordens WHERE id=(SELECT id FROM atomic_order)) <> 0 THEN RAISE EXCEPTION 'parts cost survived failed event'; END IF;
END $$;

DROP TRIGGER stage5_force_event_failure ON public.manutencao_ordem_eventos;
DROP FUNCTION public.stage5_force_event_failure();
SELECT 'stage5 atomicity PASS' AS result;
