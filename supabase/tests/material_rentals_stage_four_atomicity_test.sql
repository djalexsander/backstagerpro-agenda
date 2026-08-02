\set ON_ERROR_STOP on

CREATE TABLE public.stage4_atomic_ids (name text PRIMARY KEY,id uuid NOT NULL);
SELECT set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',false);

INSERT INTO public.stage4_atomic_ids SELECT 'rental',id FROM public.criar_locacao_material(
  '90000000-0000-4000-8000-000000000001','2031-01-10Z','2031-01-12Z',
  'funcionario','77000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',NULL,NULL,
  '72000000-0000-4000-8000-000000000001'
);
SELECT public.salvar_item_locacao_material(
  (SELECT id FROM public.stage4_atomic_ids WHERE name='rental'),
  '90000000-0000-4000-8000-000000000002',2,'unidade',1,10,0,
  '91000000-0000-4000-8000-000000000002',NULL,NULL,
  '72000000-0000-4000-8000-000000000001'
);
SELECT public.confirmar_reserva_locacao_material(
  (SELECT id FROM public.stage4_atomic_ids WHERE name='rental'),
  '91000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000001'
);

CREATE OR REPLACE FUNCTION public.stage4_force_event_failure()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.tipo::text = current_setting('stage4.fail_event',true) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='forced Stage 4 event failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stage4_force_event_failure
BEFORE INSERT ON public.material_locacao_eventos
FOR EACH ROW EXECUTE FUNCTION public.stage4_force_event_failure();

-- A: failure after Stage 3 checkout must roll stock, custody and rental state back.
SELECT set_config('stage4.fail_event','retirada',false);
DO $$
BEGIN
  PERFORM public.registrar_retirada_locacao_material(
    (SELECT id FROM public.stage4_atomic_ids WHERE name='rental'),
    (SELECT id FROM public.material_locacao_itens WHERE locacao_id=(SELECT id FROM public.stage4_atomic_ids WHERE name='rental')),
    2,'76000000-0000-4000-8000-000000000001','funcionario',
    '77000000-0000-4000-8000-000000000001','bom',
    '91000000-0000-4000-8000-000000000004',NULL,NULL,
    '72000000-0000-4000-8000-000000000001'
  );
  RAISE EXCEPTION 'forced checkout failure did not happen';
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  NULL;
END;
$$;
DO $$
BEGIN
  IF (SELECT quantidade FROM public.estoque_saldos WHERE material_id='90000000-0000-4000-8000-000000000002') <> 10
     OR EXISTS(SELECT 1 FROM public.material_custodias WHERE client_uuid='91000000-0000-4000-8000-000000000004')
     OR (SELECT status FROM public.material_locacoes WHERE id=(SELECT id FROM public.stage4_atomic_ids WHERE name='rental')) <> 'reservada' THEN
    RAISE EXCEPTION 'checkout facade left partial state';
  END IF;
END;
$$;

-- Establish one successful custody for the check-in atomicity scenario.
SELECT set_config('stage4.fail_event','',false);
INSERT INTO public.stage4_atomic_ids SELECT 'custody',id FROM public.registrar_retirada_locacao_material(
  (SELECT id FROM public.stage4_atomic_ids WHERE name='rental'),
  (SELECT id FROM public.material_locacao_itens WHERE locacao_id=(SELECT id FROM public.stage4_atomic_ids WHERE name='rental')),
  2,'76000000-0000-4000-8000-000000000001','funcionario',
  '77000000-0000-4000-8000-000000000001','bom',
  '91000000-0000-4000-8000-000000000005',NULL,NULL,
  '72000000-0000-4000-8000-000000000001'
);

-- B: failure after Stage 3 check-in must roll balance and custody projection back.
SELECT set_config('stage4.fail_event','devolucao',false);
DO $$
BEGIN
  PERFORM public.registrar_devolucao_locacao_material(
    (SELECT id FROM public.stage4_atomic_ids WHERE name='rental'),
    (SELECT id FROM public.stage4_atomic_ids WHERE name='custody'),
    2,'76000000-0000-4000-8000-000000000001','bom',
    '91000000-0000-4000-8000-000000000006',NULL,NULL,NULL,
    '72000000-0000-4000-8000-000000000001'
  );
  RAISE EXCEPTION 'forced check-in failure did not happen';
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  NULL;
END;
$$;
DO $$
BEGIN
  IF (SELECT quantidade FROM public.estoque_saldos WHERE material_id='90000000-0000-4000-8000-000000000002') <> 8
     OR (SELECT quantidade_devolvida FROM public.material_custodias WHERE id=(SELECT id FROM public.stage4_atomic_ids WHERE name='custody')) <> 0 THEN
    RAISE EXCEPTION 'check-in facade left partial state';
  END IF;
END;
$$;

-- C: cancellation event failure must not leave a cancelled header.
SELECT set_config('stage4.fail_event','',false);
INSERT INTO public.stage4_atomic_ids SELECT 'cancel',id FROM public.criar_locacao_material(
  '90000000-0000-4000-8000-000000000001','2031-02-10Z','2031-02-12Z',
  'funcionario','77000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000007',NULL,NULL,
  '72000000-0000-4000-8000-000000000001'
);
SELECT set_config('stage4.fail_event','cancelamento',false);
DO $$
BEGIN
  PERFORM public.cancelar_locacao_material(
    (SELECT id FROM public.stage4_atomic_ids WHERE name='cancel'),
    'forced atomicity','91000000-0000-4000-8000-000000000008',
    '72000000-0000-4000-8000-000000000001'
  );
  RAISE EXCEPTION 'forced cancellation failure did not happen';
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  NULL;
END;
$$;
DO $$
BEGIN
  IF (SELECT status FROM public.material_locacoes WHERE id=(SELECT id FROM public.stage4_atomic_ids WHERE name='cancel')) <> 'rascunho'
     OR EXISTS(SELECT 1 FROM public.material_locacao_eventos WHERE client_uuid='91000000-0000-4000-8000-000000000008') THEN
    RAISE EXCEPTION 'cancellation left partial state';
  END IF;
END;
$$;

DROP TRIGGER stage4_force_event_failure ON public.material_locacao_eventos;
DROP FUNCTION public.stage4_force_event_failure();
SELECT 'stage4 atomicity checkout/checkin/cancellation: PASS' AS result;
