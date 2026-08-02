-- Stage 2.5: close the legacy location write path and improve the explicit
-- stock-reconciliation diagnostic. No legacy value is converted or removed.

REVOKE UPDATE (localizacao) ON public.materiais FROM authenticated;

CREATE OR REPLACE FUNCTION public.protect_material_stock_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.quantidade := 0;
    NEW.quantidade_legada_etapa1 := NULL;
    IF auth.uid() IS NOT NULL THEN
      NEW.localizacao := NULL;
    END IF;
  ELSIF NEW.quantidade IS DISTINCT FROM OLD.quantidade
        AND COALESCE(current_setting('backstage.stock_projection_write', true), '') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'ST018',
      MESSAGE = 'O saldo só pode ser alterado por uma movimentação de estoque.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.quantidade_legada_etapa1 IS DISTINCT FROM OLD.quantidade_legada_etapa1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ST018',
      MESSAGE = 'A referência de quantidade legada é protegida.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND auth.uid() IS NOT NULL
     AND NEW.localizacao IS DISTINCT FROM OLD.localizacao THEN
    RAISE EXCEPTION USING ERRCODE = 'ST018',
      MESSAGE = 'A localização legada é somente leitura; use as localizações oficiais do estoque.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW public.estoque_reconciliacao_legado
WITH (security_invoker = true)
AS
SELECT
  material.empresa_id,
  material.id AS material_id,
  material.codigo_interno,
  material.nome,
  material.tipo_controle,
  material.quantidade_legada_etapa1,
  material.quantidade AS saldo_atual,
  NOT EXISTS (
    SELECT 1 FROM public.estoque_movimentacoes movement
    WHERE movement.empresa_id = material.empresa_id
      AND movement.material_id = material.id
      AND movement.tipo_movimentacao = 'saldo_inicial'
  ) AS saldo_inicial_pendente,
  material.localizacao AS localizacao_legada,
  EXISTS (
    SELECT 1 FROM public.estoque_movimentacoes movement
    WHERE movement.empresa_id = material.empresa_id
      AND movement.material_id = material.id
  ) AS tem_movimentacoes,
  CASE
    WHEN material.quantidade_legada_etapa1 = 0
         AND material.quantidade = 0 THEN
      'sem_saldo_legado'
    WHEN material.quantidade_legada_etapa1 = material.quantidade THEN
      'saldo_equivalente'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.estoque_movimentacoes movement
      WHERE movement.empresa_id = material.empresa_id
        AND movement.material_id = material.id
    ) THEN
      'decisao_humana_pendente'
    ELSE
      'revisao_historica_pendente'
  END AS status_reconciliacao
FROM public.materiais material
WHERE material.quantidade_legada_etapa1 IS NOT NULL;

REVOKE ALL ON public.estoque_reconciliacao_legado
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.materiais.localizacao IS
  'Deprecated read-only compatibility text. Official locations are estoque_localizacoes/estoque_saldos.';
COMMENT ON VIEW public.estoque_reconciliacao_legado IS
  'Administrative classification for explicit legacy reconciliation; never creates balances or movements.';

REVOKE ALL ON FUNCTION public.protect_material_stock_projection()
  FROM PUBLIC, anon, authenticated, service_role;
