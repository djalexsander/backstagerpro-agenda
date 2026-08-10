-- ============================================================================
-- INTEGRAÇÃO LOCAÇÕES × FINANCEIRO
-- ============================================================================
--
-- Achado da auditoria original: NÃO existia uma tabela canônica de receitas
-- ou contas a receber. `public.financials` é orçamento de CUSTOS por evento;
-- `public.pagamentos` é cobrança da ASSINATURA do SaaS. Nenhuma das duas tem
-- relação com receita de cliente. `material_locacoes.financeiro_lancamento_id`
-- é um placeholder nunca usado (mantido, mas ignorado por este desenho, que
-- resolve o lançamento via origem_tipo/origem_id, igual ao resto do app).
--
-- Segunda rodada (auditoria de aprovação): o desenho inicial faltava
-- condição de pagamento (vencimento nunca era gravado), parcelamento e
-- estorno. Esta versão fecha as três lacunas, seguindo o modelo já
-- aprovado:
--   financeiro_lancamentos = obrigação principal (valor contratado)
--   financeiro_parcelas    = divisão dessa obrigação (opcional)
--   financeiro_recebimentos = movimentações efetivas (recebimento/estorno)
--
-- O padrão de estorno é inspirado em estoque_movimentacoes (coluna
-- auto-referenciada + tipo 'estorno' + proibição de estornar um estorno),
-- adaptado para permitir estorno PARCIAL de um recebimento (o estoque não
-- precisa disso; dinheiro sim) - o limite é validado em runtime pela soma
-- dos estornos já aplicados àquele recebimento, não por um índice único de
-- 1:1 como no estoque.
--
-- Situação física (status operacional da locação) e situação financeira
-- (status do lançamento) continuam independentes por desenho.

-- ============================================================================
-- 1. TABELAS
-- ============================================================================

CREATE TABLE public.financeiro_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  origem_tipo text NOT NULL,
  origem_id uuid NOT NULL,
  cliente_id uuid REFERENCES public.clientes(id),
  tipo text NOT NULL DEFAULT 'receita' CHECK (tipo IN ('receita', 'despesa')),
  descricao text,
  forma_cobranca text NOT NULL DEFAULT 'avista' CHECK (forma_cobranca IN ('avista', 'parcelado')),
  valor_original numeric(12, 2) NOT NULL CHECK (valor_original >= 0),
  valor_recebido numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor_recebido >= 0),
  valor_estornado numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor_estornado >= 0),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'parcial', 'recebido', 'cancelado', 'cancelado_pendente_regularizacao', 'estornado')),
  -- Só usado quando forma_cobranca = 'avista'. Quando 'parcelado', os
  -- vencimentos reais vivem em financeiro_parcelas e este campo fica nulo -
  -- nunca é derivado automaticamente da data de devolução do equipamento.
  vencimento date,
  forma_pagamento text,
  observacoes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financeiro_lancamentos_empresa_id_id_unique UNIQUE (empresa_id, id),
  CONSTRAINT financeiro_lancamentos_valor_recebido_le_original
    CHECK (valor_recebido <= valor_original),
  -- Idempotência estrutural: uma origem só pode ter um lançamento por
  -- empresa. Repetir a sincronização (ou o backfill) da mesma locação nunca
  -- duplica.
  CONSTRAINT financeiro_lancamentos_origem_unica
    UNIQUE (empresa_id, origem_tipo, origem_id)
);

CREATE INDEX financeiro_lancamentos_empresa_status_idx
  ON public.financeiro_lancamentos (empresa_id, status);
CREATE INDEX financeiro_lancamentos_empresa_cliente_idx
  ON public.financeiro_lancamentos (empresa_id, cliente_id);
CREATE INDEX financeiro_lancamentos_vencimento_idx
  ON public.financeiro_lancamentos (empresa_id, vencimento)
  WHERE status IN ('pendente', 'parcial');

CREATE TABLE public.financeiro_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  lancamento_id uuid NOT NULL,
  numero integer NOT NULL CHECK (numero > 0),
  valor numeric(12, 2) NOT NULL CHECK (valor > 0),
  valor_recebido numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor_recebido >= 0),
  valor_estornado numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor_estornado >= 0),
  vencimento date NOT NULL,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'parcial', 'recebido', 'cancelado', 'cancelado_pendente_regularizacao', 'estornado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financeiro_parcelas_empresa_id_id_unique UNIQUE (empresa_id, id),
  -- Existe só para servir de alvo à FK composta de financeiro_recebimentos
  -- abaixo (recebimento -> parcela, amarrado ao mesmo lancamento_id).
  -- Trivialmente única (id já é PK), não introduz uma segunda noção de
  -- unicidade - só expõe (lancamento_id, id) como par referenciável.
  CONSTRAINT financeiro_parcelas_lancamento_id_id_unique UNIQUE (lancamento_id, id),
  CONSTRAINT financeiro_parcelas_empresa_lancamento_numero_unique
    UNIQUE (empresa_id, lancamento_id, numero),
  CONSTRAINT financeiro_parcelas_empresa_lancamento_fkey
    FOREIGN KEY (empresa_id, lancamento_id)
    REFERENCES public.financeiro_lancamentos (empresa_id, id),
  CONSTRAINT financeiro_parcelas_valor_recebido_le_valor
    CHECK (valor_recebido <= valor)
);

CREATE INDEX financeiro_parcelas_lancamento_idx ON public.financeiro_parcelas (lancamento_id);
CREATE INDEX financeiro_parcelas_empresa_vencimento_idx
  ON public.financeiro_parcelas (empresa_id, vencimento)
  WHERE status IN ('pendente', 'parcial');

CREATE TABLE public.financeiro_recebimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  lancamento_id uuid NOT NULL,
  parcela_id uuid,
  tipo text NOT NULL DEFAULT 'recebimento' CHECK (tipo IN ('recebimento', 'estorno')),
  -- Auto-referência: aponta para o recebimento original que este estorno
  -- reverte. Mesmo padrão de estoque_movimentacoes.movimentacao_estornada_id,
  -- exceto que aqui múltiplos estornos PARCIAIS podem apontar para o mesmo
  -- recebimento original (o teto é o saldo estornável, validado em runtime
  -- pela RPC - ver estornar_recebimento_locacao).
  recebimento_estornado_id uuid REFERENCES public.financeiro_recebimentos(id),
  valor numeric(12, 2) NOT NULL CHECK (valor > 0),
  forma_pagamento text,
  data_recebimento timestamptz NOT NULL DEFAULT now(),
  observacao text,
  executado_por uuid,
  client_uuid uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financeiro_recebimentos_client_uuid_unico
    UNIQUE (empresa_id, client_uuid),
  CONSTRAINT financeiro_recebimentos_estorno_shape CHECK (
    (tipo = 'estorno' AND recebimento_estornado_id IS NOT NULL)
    OR (tipo = 'recebimento' AND recebimento_estornado_id IS NULL)
  ),
  -- Endurecimento pedido na auditoria: eleva "recebimento pertence ao mesmo
  -- lançamento/empresa da parcela" de garantia só de RPC para garantia de
  -- schema. Duas FKs compostas, cada uma amarrada por lancamento_id:
  --   (empresa_id, lancamento_id) -> financeiro_lancamentos(empresa_id, id)
  --     garante que empresa_id não pode ser diferente da empresa real do
  --     lançamento (hoje isso só era verdade porque a RPC sempre usava o
  --     mesmo v_company_id nos dois lugares - agora é impossível de outro
  --     jeito, mesmo por INSERT direto).
  --   (lancamento_id, parcela_id) -> financeiro_parcelas(lancamento_id, id)
  --     garante que a parcela referenciada pertence ao MESMO lancamento_id
  --     do recebimento - "recebimento do lançamento A apontando para
  --     parcela do lançamento B" deixa de ser apenas rejeitado pela RPC
  --     (FN020) e passa a ser estruturalmente impossível de persistir.
  --     MATCH SIMPLE (o padrão do Postgres) não exige a checagem quando
  --     parcela_id é NULL, então recebimento à vista continua válido.
  --   Não foi necessário incluir empresa_id na segunda FK: lancamento_id já
  --   identifica uma única empresa (financeiro_lancamentos.id é PK de uma
  --   linha só), e a primeira FK já amarra o empresa_id do recebimento a
  --   esse mesmo lancamento_id - a consistência de empresa entre as três
  --   tabelas já fica garantida por transitividade, sem precisar de uma FK
  --   de 3 colunas.
  CONSTRAINT financeiro_recebimentos_empresa_lancamento_fkey
    FOREIGN KEY (empresa_id, lancamento_id)
    REFERENCES public.financeiro_lancamentos (empresa_id, id),
  CONSTRAINT financeiro_recebimentos_lancamento_parcela_fkey
    FOREIGN KEY (lancamento_id, parcela_id)
    REFERENCES public.financeiro_parcelas (lancamento_id, id)
);

CREATE INDEX financeiro_recebimentos_lancamento_idx
  ON public.financeiro_recebimentos (lancamento_id);
CREATE INDEX financeiro_recebimentos_parcela_idx
  ON public.financeiro_recebimentos (parcela_id) WHERE parcela_id IS NOT NULL;
CREATE INDEX financeiro_recebimentos_estornado_idx
  ON public.financeiro_recebimentos (recebimento_estornado_id) WHERE recebimento_estornado_id IS NOT NULL;

-- Histórico é imutável (mesmo padrão de material_locacao_eventos): nunca
-- apagar ou editar um recebimento OU um estorno já gravado. Reverter é
-- sempre uma linha nova.
CREATE OR REPLACE FUNCTION public.protect_financeiro_recebimentos_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'FN001',
    MESSAGE = 'O histórico de recebimentos é imutável.';
END;
$function$;

CREATE TRIGGER protect_financeiro_recebimentos
BEFORE UPDATE OR DELETE ON public.financeiro_recebimentos
FOR EACH ROW EXECUTE FUNCTION public.protect_financeiro_recebimentos_history();

ALTER TABLE public.financeiro_lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro_parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro_recebimentos ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. RLS - somente leitura direta para authenticated; toda escrita passa
--    pelas RPCs abaixo (mesmo padrão de public.clientes). Gate de leitura
--    espelha a policy já existente em public.financials: master_admin, ou
--    admin_empresa da própria empresa com o módulo financeiro_avancado
--    ativo. "usuario" não acessa este módulo (já era admin-only antes desta
--    migration).
-- ============================================================================

CREATE POLICY "Licensed tenant administrators read financeiro_lancamentos"
ON public.financeiro_lancamentos FOR SELECT TO authenticated
USING (
  is_master_admin(auth.uid())
  OR (has_role(auth.uid(), 'admin_empresa'::app_role)
      AND can_read_company_module(empresa_id, 'financeiro_avancado'))
);

CREATE POLICY "Licensed tenant administrators read financeiro_parcelas"
ON public.financeiro_parcelas FOR SELECT TO authenticated
USING (
  is_master_admin(auth.uid())
  OR (has_role(auth.uid(), 'admin_empresa'::app_role)
      AND can_read_company_module(empresa_id, 'financeiro_avancado'))
);

CREATE POLICY "Licensed tenant administrators read financeiro_recebimentos"
ON public.financeiro_recebimentos FOR SELECT TO authenticated
USING (
  is_master_admin(auth.uid())
  OR (has_role(auth.uid(), 'admin_empresa'::app_role)
      AND can_read_company_module(empresa_id, 'financeiro_avancado'))
);

-- ============================================================================
-- 3. STATUS - fonte única de verdade, usada por toda RPC que muda valores,
--    para nunca deixar o status divergir do valor real (persistido, mas
--    sempre recalculado na mesma transação da escrita que o afeta).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.financeiro_status_from_valores(
  _cancelado boolean,
  _valor_original numeric,
  _valor_recebido numeric,
  _valor_estornado numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _cancelado AND _valor_recebido > 0 THEN 'cancelado_pendente_regularizacao'
    WHEN _cancelado AND _valor_estornado > 0 THEN 'estornado'
    WHEN _cancelado THEN 'cancelado'
    WHEN _valor_recebido <= 0 THEN 'pendente'
    WHEN _valor_recebido < _valor_original THEN 'parcial'
    ELSE 'recebido'
  END;
$function$;

-- ============================================================================
-- 4. SINCRONIZAÇÃO LOCAÇÃO -> LANÇAMENTO (best-effort, idempotente)
-- ============================================================================
--
-- Chamada por confirmar_reserva_locacao_material (cria o lançamento na
-- primeira vez que a locação sai de rascunho, já com a condição de
-- pagamento definida no mesmo fluxo) e por cancelar_locacao_material
-- (marca cancelamento, com ou sem pendência de regularização). Também
-- chamada diretamente pelo backfill para locações que já existiam antes
-- desta migration.
--
-- "Best-effort": se a empresa não tiver o módulo financeiro_avancado
-- ativo, a função apenas retorna sem fazer nada - reservar/cancelar uma
-- locação NUNCA pode falhar por causa do financeiro.
--
-- Validação de forma de pagamento (vencimento obrigatório à vista, soma de
-- parcelas obrigatoriamente igual ao total) é feita AQUI, na criação, não
-- em confirmar_reserva_locacao_material, porque só aqui o valor real da
-- locação (v_rental.valor_total) já está disponível. confirmar_reserva
-- ainda valida o que dá para validar sem esse valor (forma reconhecida,
-- vencimento presente, parcelas não vazias) para falhar cedo.
CREATE OR REPLACE FUNCTION public.sync_material_rental_financial_entry(
  _company_id uuid,
  _locacao_id uuid,
  _forma_cobranca text DEFAULT 'avista',
  _vencimento date DEFAULT NULL,
  _parcelas jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rental public.material_locacoes%ROWTYPE;
  v_existing public.financeiro_lancamentos%ROWTYPE;
  v_lancamento_id uuid;
  v_new_status text;
  v_parcela jsonb;
  v_parcelas_sum numeric(12,2);
BEGIN
  IF NOT public.company_has_active_module(_company_id, 'financeiro_avancado') THEN
    RETURN;
  END IF;

  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = _company_id AND id = _locacao_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM public.financeiro_lancamentos
  WHERE empresa_id = _company_id
    AND origem_tipo = 'locacao_material'
    AND origem_id = _locacao_id
  FOR UPDATE;

  IF v_rental.status = 'cancelada' THEN
    IF FOUND AND v_existing.status NOT IN ('cancelado', 'cancelado_pendente_regularizacao', 'estornado') THEN
      v_new_status := public.financeiro_status_from_valores(
        true, v_existing.valor_original, v_existing.valor_recebido, v_existing.valor_estornado
      );
      UPDATE public.financeiro_lancamentos
      SET status = v_new_status, updated_at = clock_timestamp()
      WHERE id = v_existing.id;
      -- Cascateia para parcelas que ainda não estão em estado terminal:
      -- cada parcela vira 'cancelado' (nada recebido) ou
      -- 'cancelado_pendente_regularizacao' (tinha valor recebido) conforme
      -- o próprio saldo dela, não o do lançamento inteiro.
      UPDATE public.financeiro_parcelas
      SET status = public.financeiro_status_from_valores(true, valor, valor_recebido, valor_estornado),
          updated_at = clock_timestamp()
      WHERE lancamento_id = v_existing.id
        AND status NOT IN ('cancelado', 'cancelado_pendente_regularizacao', 'estornado');
    END IF;
    RETURN;
  END IF;

  IF v_rental.status = 'rascunho' THEN
    RETURN;
  END IF;

  IF NOT FOUND THEN
    IF _forma_cobranca NOT IN ('avista', 'parcelado') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN010', MESSAGE = 'Condição de pagamento inválida.';
    END IF;

    INSERT INTO public.financeiro_lancamentos (
      empresa_id, origem_tipo, origem_id, cliente_id, tipo,
      descricao, forma_cobranca, valor_original, vencimento, status, created_by, updated_by
    ) VALUES (
      _company_id, 'locacao_material', _locacao_id, v_rental.cliente_id, 'receita',
      'Locação ' || v_rental.numero, _forma_cobranca, v_rental.valor_total,
      CASE WHEN _forma_cobranca = 'avista' THEN _vencimento ELSE NULL END,
      'pendente', auth.uid(), auth.uid()
    ) RETURNING id INTO v_lancamento_id;

    IF _forma_cobranca = 'parcelado' THEN
      IF _parcelas IS NULL OR jsonb_array_length(_parcelas) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'FN011', MESSAGE = 'Informe ao menos uma parcela.';
      END IF;
      SELECT COALESCE(sum((p->>'valor')::numeric), 0) INTO v_parcelas_sum
      FROM jsonb_array_elements(_parcelas) AS p;
      IF v_parcelas_sum <> v_rental.valor_total THEN
        RAISE EXCEPTION USING ERRCODE = 'FN012',
          MESSAGE = format('A soma das parcelas (%s) deve ser igual ao valor da locação (%s).', v_parcelas_sum, v_rental.valor_total);
      END IF;
      FOR v_parcela IN SELECT * FROM jsonb_array_elements(_parcelas) LOOP
        IF (v_parcela->>'valor')::numeric <= 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'FN013', MESSAGE = 'Cada parcela deve ter valor positivo.';
        END IF;
        IF (v_parcela->>'vencimento') IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'FN014', MESSAGE = 'Cada parcela deve ter vencimento.';
        END IF;
        INSERT INTO public.financeiro_parcelas (
          empresa_id, lancamento_id, numero, valor, vencimento, status
        ) VALUES (
          _company_id, v_lancamento_id, (v_parcela->>'numero')::integer,
          (v_parcela->>'valor')::numeric, (v_parcela->>'vencimento')::date, 'pendente'
        );
      END LOOP;
    END IF;
  ELSIF v_existing.status NOT IN ('cancelado', 'cancelado_pendente_regularizacao', 'estornado')
        AND v_existing.valor_original <> v_rental.valor_total THEN
    -- Hoje, nenhuma rotina exposta altera valor_total depois que a locação
    -- sai do rascunho (itens ficam congelados - ver item 2 do relatório).
    -- Este ramo é defensivo, para qualquer rotina interna futura: nunca
    -- reduz o contratado abaixo do que já foi recebido, com mensagem de
    -- domínio clara em vez de estourar o CHECK cru.
    IF v_rental.valor_total < v_existing.valor_recebido THEN
      RAISE EXCEPTION USING ERRCODE = 'FN009',
        MESSAGE = format('Não é possível reduzir o valor da locação (%s) abaixo do valor já recebido (%s).', v_rental.valor_total, v_existing.valor_recebido);
    END IF;
    UPDATE public.financeiro_lancamentos
    SET valor_original = v_rental.valor_total,
        cliente_id = v_rental.cliente_id,
        updated_by = auth.uid(),
        updated_at = clock_timestamp()
    WHERE id = v_existing.id;
  END IF;
END;
$function$;

-- confirmar_reserva_locacao_material ganhou 3 parâmetros novos (condição de
-- pagamento) - troca de assinatura, não apenas de corpo, então a versão de
-- 3 argumentos (a que está live hoje, do stage four) precisa ser removida
-- explicitamente antes do CREATE OR REPLACE, senão as duas coexistem como
-- overloads e uma chamada antiga poderia resolver para a versão errada.
DROP FUNCTION IF EXISTS public.confirmar_reserva_locacao_material(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.confirmar_reserva_locacao_material(
  _locacao_id uuid,
  _client_uuid uuid,
  _empresa_id uuid DEFAULT NULL::uuid,
  _forma_cobranca text DEFAULT 'avista',
  _vencimento date DEFAULT NULL,
  _parcelas jsonb DEFAULT NULL
)
 RETURNS material_locacoes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_item public.material_locacao_itens%ROWTYPE;
  v_availability record;
  v_hash text;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);

  -- Condição de pagamento é definida NESTE fluxo (não depois) - só exigida
  -- quando o financeiro está de fato ativo para a empresa, para não pedir
  -- vencimento de quem não usa o módulo (o sync abaixo é best-effort e
  -- ignoraria os parâmetros de qualquer forma nesse caso).
  IF public.company_has_active_module(v_company_id, 'financeiro_avancado') THEN
    IF _forma_cobranca NOT IN ('avista', 'parcelado') THEN
      RAISE EXCEPTION USING ERRCODE = 'FN010', MESSAGE = 'Condição de pagamento inválida.';
    END IF;
    IF _forma_cobranca = 'avista' AND _vencimento IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'FN015', MESSAGE = 'Informe o vencimento da cobrança à vista.';
    END IF;
    IF _forma_cobranca = 'parcelado' AND (_parcelas IS NULL OR jsonb_array_length(_parcelas) = 0) THEN
      RAISE EXCEPTION USING ERRCODE = 'FN011', MESSAGE = 'Informe ao menos uma parcela.';
    END IF;
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'acao', 'reservar',
    'forma_cobranca', _forma_cobranca, 'vencimento', _vencimento, 'parcelas', _parcelas
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.locacao_id <> _locacao_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_rental FROM public.material_locacoes WHERE empresa_id = v_company_id AND id = _locacao_id;
    RETURN v_rental;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.'; END IF;
  IF v_rental.status <> 'rascunho' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'Somente rascunhos podem ser reservados.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.material_locacao_itens WHERE empresa_id = v_company_id AND locacao_id = _locacao_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Adicione ao menos um material antes de reservar.';
  END IF;

  FOR v_item IN
    SELECT * FROM public.material_locacao_itens
    WHERE empresa_id = v_company_id AND locacao_id = _locacao_id
    ORDER BY material_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-material:' || v_item.material_id::text, 0));
    SELECT * INTO v_availability FROM public.material_rental_availability(
      v_company_id, v_item.material_id, v_rental.retirada_prevista_em,
      v_rental.devolucao_prevista_em, v_rental.id
    );
    IF v_item.quantidade_contratada > v_availability.disponivel THEN
      RAISE EXCEPTION USING ERRCODE = 'LR012',
        MESSAGE = format('Disponibilidade insuficiente para o material %s. Disponível: %s.', v_item.material_id, v_availability.disponivel);
    END IF;
  END LOOP;
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = 'reservada', updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id
  RETURNING * INTO v_rental;
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, tipo, descricao, executado_por, client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, 'reserva', 'Reserva confirmada para o período',
    auth.uid(), _client_uuid, v_hash,
    jsonb_build_object('retirada_prevista_em', v_rental.retirada_prevista_em, 'devolucao_prevista_em', v_rental.devolucao_prevista_em)
  );
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_reservada', 'Reserva de materiais confirmada', auth.uid(),
    v_company_id, jsonb_build_object('locacao_id', _locacao_id, 'numero', v_rental.numero));

  -- Ponto único de geração do lançamento financeiro, já com a condição de
  -- pagamento definida neste mesmo fluxo: a reserva confirmada é a
  -- primeira obrigação comercial real da locação (rascunho ainda não é).
  PERFORM public.sync_material_rental_financial_entry(v_company_id, _locacao_id, _forma_cobranca, _vencimento, _parcelas);

  RETURN v_rental;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_locacao_material(_locacao_id uuid, _justificativa text, _client_uuid uuid, _empresa_id uuid DEFAULT NULL::uuid)
 RETURNS material_locacoes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_rental public.material_locacoes%ROWTYPE;
  v_existing_event public.material_locacao_eventos%ROWTYPE;
  v_hash text;
BEGIN
  v_company_id := public.resolve_material_rental_company(_empresa_id, true);
  IF nullif(btrim(_justificativa), '') IS NULL OR _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'LR004', MESSAGE = 'Justificativa e identificador são obrigatórios.';
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'locacao', _locacao_id, 'justificativa', btrim(_justificativa)
  )::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':rental-event:' || _client_uuid::text, 0));
  SELECT * INTO v_existing_event FROM public.material_locacao_eventos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> v_hash OR v_existing_event.locacao_id <> _locacao_id THEN
      RAISE EXCEPTION USING ERRCODE = 'LR013', MESSAGE = 'Operação idempotente reutilizada com dados diferentes.';
    END IF;
    SELECT * INTO v_rental FROM public.material_locacoes WHERE empresa_id = v_company_id AND id = _locacao_id;
    RETURN v_rental;
  END IF;
  SELECT * INTO v_rental FROM public.material_locacoes
  WHERE empresa_id = v_company_id AND id = _locacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'LR005', MESSAGE = 'Locação não encontrada.'; END IF;
  IF v_rental.status NOT IN ('rascunho', 'reservada', 'pronta_retirada') THEN
    RAISE EXCEPTION USING ERRCODE = 'LR014', MESSAGE = 'A locação não pode ser cancelada neste estado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.material_custodias AS custody
    JOIN public.material_locacao_itens AS item ON item.id = custody.referencia_id
    WHERE item.empresa_id = v_company_id AND item.locacao_id = _locacao_id
      AND custody.referencia_tipo = 'locacao_item'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'LR016',
      MESSAGE = 'Locação com retirada registrada não pode ser cancelada administrativamente.';
  END IF;
  PERFORM set_config('backstage.material_rental_write', 'on', true);
  UPDATE public.material_locacoes
  SET status = 'cancelada', encerrada_em = clock_timestamp(),
      updated_by = auth.uid(), updated_at = clock_timestamp()
  WHERE empresa_id = v_company_id AND id = _locacao_id
  RETURNING * INTO v_rental;
  INSERT INTO public.material_locacao_eventos (
    empresa_id, locacao_id, tipo, descricao, executado_por,
    client_uuid, payload_hash, dados
  ) VALUES (
    v_company_id, _locacao_id, 'cancelamento', 'Locação cancelada e reservas liberadas',
    auth.uid(), _client_uuid, v_hash, jsonb_build_object('justificativa', btrim(_justificativa))
  );
  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('locacao', 'locacao_cancelada', 'Locação cancelada sem apagar histórico',
    auth.uid(), v_company_id,
    jsonb_build_object('locacao_id', _locacao_id, 'numero', v_rental.numero, 'justificativa', btrim(_justificativa)));

  -- Marca o título como cancelado (ou cancelado_pendente_regularizacao, se
  -- já havia valor recebido) - nunca estorna automaticamente, nunca apaga
  -- o que já foi recebido. O estorno, se necessário, é uma decisão
  -- separada e explícita do administrador via estornar_recebimento_locacao.
  PERFORM public.sync_material_rental_financial_entry(v_company_id, _locacao_id);

  RETURN v_rental;
END;
$function$;

-- ============================================================================
-- 5. RESOLUÇÃO DE EMPRESA PARA OPERAÇÕES FINANCEIRAS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_financial_company(
  _requested_company_id uuid,
  _write boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticação obrigatória.';
  END IF;
  IF public.is_master_admin(auth.uid()) THEN
    IF _requested_company_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'FN002', MESSAGE = 'Selecione a empresa para operar o financeiro.';
    END IF;
    v_company_id := _requested_company_id;
  ELSE
    IF NOT public.has_role(auth.uid(), 'admin_empresa'::app_role) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores da empresa acessam o financeiro.';
    END IF;
    v_company_id := public.get_user_empresa_id(auth.uid());
    IF v_company_id IS NULL
       OR (_requested_company_id IS NOT NULL AND _requested_company_id <> v_company_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Empresa inválida.';
    END IF;
  END IF;
  IF NOT public.company_has_active_module(v_company_id, 'financeiro_avancado') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN003', MESSAGE = 'O módulo Financeiro não está ativo para esta empresa.';
  END IF;
  IF _write AND NOT public.company_has_operational_access(v_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'FN004', MESSAGE = 'A empresa está em modo somente leitura.';
  END IF;
  IF (_write AND NOT public.can_write_company_module(v_company_id, 'financeiro_avancado'))
     OR (NOT _write AND NOT public.can_read_company_module(v_company_id, 'financeiro_avancado')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Você não tem permissão para esta operação.';
  END IF;
  RETURN v_company_id;
END;
$function$;

-- ============================================================================
-- 6. REGISTRAR RECEBIMENTO (público, exige módulo + admin_empresa)
-- ============================================================================
--
-- _parcela_id é obrigatório quando o lançamento é parcelado e proibido
-- quando é à vista - um recebimento nunca é distribuído automaticamente
-- entre parcelas (operação não suportada nesta versão; ver relatório).
CREATE OR REPLACE FUNCTION public.registrar_recebimento_locacao(
  _locacao_id uuid,
  _valor numeric,
  _forma_pagamento text,
  _client_uuid uuid,
  _data_recebimento timestamptz DEFAULT NULL::timestamptz,
  _observacao text DEFAULT NULL::text,
  _empresa_id uuid DEFAULT NULL::uuid,
  _parcela_id uuid DEFAULT NULL::uuid
)
RETURNS public.financeiro_lancamentos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_lancamento public.financeiro_lancamentos%ROWTYPE;
  v_parcela public.financeiro_parcelas%ROWTYPE;
  v_existing public.financeiro_recebimentos%ROWTYPE;
  v_pendente numeric;
  v_new_recebido numeric;
BEGIN
  v_company_id := public.resolve_financial_company(_empresa_id, true);
  IF _client_uuid IS NULL OR COALESCE(_valor, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'FN005', MESSAGE = 'Valor e identificador são obrigatórios.';
  END IF;

  SELECT * INTO v_existing FROM public.financeiro_recebimentos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    SELECT * INTO v_lancamento FROM public.financeiro_lancamentos WHERE id = v_existing.lancamento_id;
    RETURN v_lancamento;
  END IF;

  SELECT fl.* INTO v_lancamento
  FROM public.financeiro_lancamentos fl
  JOIN public.material_locacoes ml
    ON ml.empresa_id = fl.empresa_id AND ml.id = fl.origem_id AND fl.origem_tipo = 'locacao_material'
  WHERE fl.empresa_id = v_company_id AND ml.id = _locacao_id
  FOR UPDATE OF fl;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'FN006', MESSAGE = 'Lançamento financeiro da locação não encontrado.';
  END IF;
  IF v_lancamento.status IN ('cancelado', 'cancelado_pendente_regularizacao') THEN
    RAISE EXCEPTION USING ERRCODE = 'FN007', MESSAGE = 'Não é possível registrar recebimento em um título cancelado.';
  END IF;

  IF v_lancamento.forma_cobranca = 'parcelado' AND _parcela_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'FN021', MESSAGE = 'Informe a parcela para este lançamento parcelado.';
  END IF;
  IF v_lancamento.forma_cobranca = 'avista' AND _parcela_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'FN022', MESSAGE = 'Este lançamento é à vista; não informe parcela.';
  END IF;

  IF _parcela_id IS NOT NULL THEN
    SELECT * INTO v_parcela FROM public.financeiro_parcelas
    WHERE empresa_id = v_company_id AND id = _parcela_id AND lancamento_id = v_lancamento.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'FN020', MESSAGE = 'Parcela não encontrada para esta locação.';
    END IF;
    v_pendente := v_parcela.valor - v_parcela.valor_recebido;
  ELSE
    v_pendente := v_lancamento.valor_original - v_lancamento.valor_recebido;
  END IF;

  IF _valor > v_pendente THEN
    RAISE EXCEPTION USING ERRCODE = 'FN008',
      MESSAGE = format('O valor recebido (%s) excede o saldo pendente (%s).', _valor, v_pendente);
  END IF;

  INSERT INTO public.financeiro_recebimentos (
    empresa_id, lancamento_id, parcela_id, tipo, valor, forma_pagamento, data_recebimento,
    observacao, executado_por, client_uuid
  ) VALUES (
    v_company_id, v_lancamento.id, _parcela_id, 'recebimento', _valor, nullif(btrim(_forma_pagamento), ''),
    COALESCE(_data_recebimento, clock_timestamp()), nullif(btrim(_observacao), ''),
    auth.uid(), _client_uuid
  );

  IF _parcela_id IS NOT NULL THEN
    UPDATE public.financeiro_parcelas
    SET valor_recebido = valor_recebido + _valor,
        status = public.financeiro_status_from_valores(false, valor, valor_recebido + _valor, valor_estornado),
        updated_at = clock_timestamp()
    WHERE id = v_parcela.id;
  END IF;

  v_new_recebido := v_lancamento.valor_recebido + _valor;

  UPDATE public.financeiro_lancamentos
  SET valor_recebido = v_new_recebido,
      status = public.financeiro_status_from_valores(false, valor_original, v_new_recebido, valor_estornado),
      forma_pagamento = COALESCE(nullif(btrim(_forma_pagamento), ''), forma_pagamento),
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  WHERE id = v_lancamento.id
  RETURNING * INTO v_lancamento;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('financeiro', 'recebimento_registrado', 'Recebimento registrado para locação',
    auth.uid(), v_company_id,
    jsonb_build_object('lancamento_id', v_lancamento.id, 'locacao_id', _locacao_id, 'parcela_id', _parcela_id, 'valor', _valor, 'status', v_lancamento.status));

  RETURN v_lancamento;
END;
$function$;

-- ============================================================================
-- 7. ESTORNAR RECEBIMENTO (público, exige módulo + admin_empresa)
-- ============================================================================
--
-- Nunca apaga nem edita o recebimento original (o trigger de imutabilidade
-- já impede fisicamente). Um estorno é sempre uma nova linha, com
-- recebimento_estornado_id apontando para o original. Suporta estorno
-- parcial: _valor pode ser menor que o recebimento original, e múltiplos
-- estornos parciais podem se acumular contra o mesmo recebimento, até o
-- limite do saldo estornável (recebido - já estornado daquele recebimento
-- específico). Um estorno nunca pode ser alvo de outro estorno.
CREATE OR REPLACE FUNCTION public.estornar_recebimento_locacao(
  _recebimento_id uuid,
  _justificativa text,
  _client_uuid uuid,
  _valor numeric DEFAULT NULL::numeric,
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS public.financeiro_lancamentos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_original public.financeiro_recebimentos%ROWTYPE;
  v_existing_estorno public.financeiro_recebimentos%ROWTYPE;
  v_lancamento public.financeiro_lancamentos%ROWTYPE;
  v_parcela public.financeiro_parcelas%ROWTYPE;
  v_ja_estornado numeric;
  v_saldo_estornavel numeric;
  v_valor numeric;
  v_cancelado boolean;
BEGIN
  v_company_id := public.resolve_financial_company(_empresa_id, true);
  IF _client_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'FN005', MESSAGE = 'Identificador é obrigatório.';
  END IF;
  IF nullif(btrim(_justificativa), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'FN016', MESSAGE = 'Informe a justificativa do estorno.';
  END IF;

  SELECT * INTO v_existing_estorno FROM public.financeiro_recebimentos
  WHERE empresa_id = v_company_id AND client_uuid = _client_uuid;
  IF FOUND THEN
    SELECT * INTO v_lancamento FROM public.financeiro_lancamentos WHERE id = v_existing_estorno.lancamento_id;
    RETURN v_lancamento;
  END IF;

  SELECT * INTO v_original FROM public.financeiro_recebimentos
  WHERE empresa_id = v_company_id AND id = _recebimento_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'FN019', MESSAGE = 'Recebimento não encontrado.';
  END IF;
  IF v_original.tipo = 'estorno' THEN
    RAISE EXCEPTION USING ERRCODE = 'FN017', MESSAGE = 'Um estorno não pode ser estornado.';
  END IF;

  SELECT COALESCE(sum(valor), 0) INTO v_ja_estornado
  FROM public.financeiro_recebimentos
  WHERE recebimento_estornado_id = v_original.id;
  v_saldo_estornavel := v_original.valor - v_ja_estornado;

  v_valor := COALESCE(_valor, v_saldo_estornavel);
  IF v_valor <= 0 OR v_valor > v_saldo_estornavel THEN
    RAISE EXCEPTION USING ERRCODE = 'FN018',
      MESSAGE = format('O valor do estorno (%s) excede o saldo estornável deste recebimento (%s).', v_valor, v_saldo_estornavel);
  END IF;

  SELECT * INTO v_lancamento FROM public.financeiro_lancamentos
  WHERE id = v_original.lancamento_id FOR UPDATE;
  v_cancelado := v_lancamento.status IN ('cancelado', 'cancelado_pendente_regularizacao', 'estornado');

  INSERT INTO public.financeiro_recebimentos (
    empresa_id, lancamento_id, parcela_id, tipo, recebimento_estornado_id,
    valor, forma_pagamento, observacao, executado_por, client_uuid
  ) VALUES (
    v_company_id, v_original.lancamento_id, v_original.parcela_id, 'estorno', v_original.id,
    v_valor, v_original.forma_pagamento, btrim(_justificativa), auth.uid(), _client_uuid
  );

  IF v_original.parcela_id IS NOT NULL THEN
    SELECT * INTO v_parcela FROM public.financeiro_parcelas WHERE id = v_original.parcela_id FOR UPDATE;
    UPDATE public.financeiro_parcelas
    SET valor_recebido = valor_recebido - v_valor,
        valor_estornado = valor_estornado + v_valor,
        status = public.financeiro_status_from_valores(v_cancelado, valor, valor_recebido - v_valor, valor_estornado + v_valor),
        updated_at = clock_timestamp()
    WHERE id = v_parcela.id;
  END IF;

  UPDATE public.financeiro_lancamentos
  SET valor_recebido = v_lancamento.valor_recebido - v_valor,
      valor_estornado = v_lancamento.valor_estornado + v_valor,
      status = public.financeiro_status_from_valores(
        v_cancelado, v_lancamento.valor_original, v_lancamento.valor_recebido - v_valor, v_lancamento.valor_estornado + v_valor
      ),
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  WHERE id = v_lancamento.id
  RETURNING * INTO v_lancamento;

  INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
  VALUES ('financeiro', 'recebimento_estornado', 'Estorno registrado para locação',
    auth.uid(), v_company_id,
    jsonb_build_object('lancamento_id', v_lancamento.id, 'recebimento_id', v_original.id, 'valor', v_valor, 'justificativa', btrim(_justificativa)));

  RETURN v_lancamento;
END;
$function$;

-- ============================================================================
-- 8. BACKFILL - manutenção, NÃO exposta ao app (sem GRANT para authenticated)
-- ============================================================================
--
-- Reaproveita o mesmo sync_material_rental_financial_entry do fluxo normal,
-- então herda a mesma proteção de idempotência (UNIQUE empresa_id +
-- origem_tipo + origem_id): rodar 1x, 2x ou 10x produz exatamente o mesmo
-- conjunto de lançamentos, sem mecanismo extra. Locações em rascunho nunca
-- passam por aqui (nunca constituíram obrigação); locações canceladas sem
-- lançamento prévio continuam sem lançamento (sync não cria lançamento
-- para status='cancelada' quando não existe um para atualizar - mesma
-- regra do fluxo normal).
--
-- Cria com forma_cobranca='avista' e vencimento NULL deliberadamente: para
-- dados históricos não há como saber a condição de pagamento real
-- combinada na época, e inventar uma data de vencimento plausível seria
-- pior do que deixar em aberto para o administrador revisar - o mesmo
-- espírito de "não assumir automaticamente" do fluxo novo.
CREATE OR REPLACE FUNCTION public.backfill_financeiro_locacoes(
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(locacao_id uuid, numero text, empresa_id uuid, resultado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rental record;
  v_before public.financeiro_lancamentos%ROWTYPE;
  v_after public.financeiro_lancamentos%ROWTYPE;
  v_count integer := 0;
BEGIN
  FOR v_rental IN
    SELECT * FROM public.material_locacoes ml
    WHERE ml.status <> 'rascunho'
      AND (_empresa_id IS NULL OR ml.empresa_id = _empresa_id)
    ORDER BY ml.created_at
  LOOP
    SELECT fl.* INTO v_before FROM public.financeiro_lancamentos fl
    WHERE fl.empresa_id = v_rental.empresa_id AND fl.origem_tipo = 'locacao_material' AND fl.origem_id = v_rental.id;

    PERFORM public.sync_material_rental_financial_entry(
      v_rental.empresa_id, v_rental.id, 'avista', NULL, NULL
    );

    SELECT fl.* INTO v_after FROM public.financeiro_lancamentos fl
    WHERE fl.empresa_id = v_rental.empresa_id AND fl.origem_tipo = 'locacao_material' AND fl.origem_id = v_rental.id;

    IF v_before.id IS NULL AND v_after.id IS NOT NULL THEN
      v_count := v_count + 1;
      RETURN QUERY SELECT v_rental.id, v_rental.numero, v_rental.empresa_id, 'lancamento_criado'::text;
    ELSIF v_before.id IS NOT NULL THEN
      RETURN QUERY SELECT v_rental.id, v_rental.numero, v_rental.empresa_id, 'ja_existia'::text;
    ELSE
      RETURN QUERY SELECT v_rental.id, v_rental.numero, v_rental.empresa_id, 'sem_obrigacao'::text;
    END IF;
  END LOOP;

  IF _empresa_id IS NOT NULL THEN
    INSERT INTO public.system_logs (tipo, acao, descricao, user_id, empresa_id, dados)
    VALUES ('financeiro', 'backfill_executado', 'Backfill de lançamentos financeiros de locações executado',
      auth.uid(), _empresa_id, jsonb_build_object('lancamentos_criados', v_count));
  END IF;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.backfill_financeiro_locacoes(uuid) FROM PUBLIC;

-- ============================================================================
-- 9. LEITURA - contas a receber, clientes a receber, financeiro da locação,
--    resumo agregado (fonte única para Dashboard e Financeiro)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.listar_contas_receber(
  _status text DEFAULT NULL::text,
  _busca text DEFAULT NULL::text,
  _somente_vencidos boolean DEFAULT false,
  _pagina integer DEFAULT 1,
  _por_pagina integer DEFAULT 20,
  _empresa_id uuid DEFAULT NULL::uuid,
  _somente_revisao boolean DEFAULT false
)
RETURNS TABLE(item jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_page integer := greatest(COALESCE(_pagina, 1), 1);
  v_per_page integer := greatest(1, least(COALESCE(_por_pagina, 20), 100));
BEGIN
  v_company_id := public.resolve_financial_company(_empresa_id, false);
  RETURN QUERY
  WITH base AS (
    SELECT
      fl.*,
      customer.nome AS cliente_nome,
      customer.nome_fantasia AS cliente_nome_fantasia,
      (fl.forma_cobranca = 'avista' AND fl.vencimento IS NOT NULL AND fl.vencimento < current_date
        AND fl.status IN ('pendente', 'parcial')) AS vencido,
      -- Título de backfill/histórico sem condição de pagamento conhecida:
      -- à vista, nunca recebeu vencimento (o fluxo normal via
      -- confirmar_reserva_locacao_material exige vencimento obrigatório -
      -- FN015 - então nulo só acontece por backfill). Não é "vencido"
      -- (não inventamos uma data para comparar com hoje) - é "precisa de
      -- revisão humana da condição de pagamento".
      (fl.forma_cobranca = 'avista' AND fl.vencimento IS NULL
        AND fl.status IN ('pendente', 'parcial')) AS requer_revisao_vencimento
    FROM public.financeiro_lancamentos fl
    LEFT JOIN public.clientes customer
      ON customer.empresa_id = fl.empresa_id AND customer.id = fl.cliente_id
    WHERE fl.empresa_id = v_company_id
      AND fl.tipo = 'receita'
      AND (nullif(btrim(_status), '') IS NULL OR fl.status = btrim(_status))
      AND (
        nullif(btrim(_busca), '') IS NULL
        OR fl.descricao ILIKE '%' || btrim(_busca) || '%'
        OR COALESCE(customer.nome, '') ILIKE '%' || btrim(_busca) || '%'
        OR COALESCE(customer.nome_fantasia, '') ILIKE '%' || btrim(_busca) || '%'
      )
  )
  SELECT to_jsonb(base), count(*) OVER ()
  FROM base
  WHERE (NOT _somente_vencidos OR base.vencido)
    AND (NOT _somente_revisao OR base.requer_revisao_vencimento)
  ORDER BY base.vencimento ASC NULLS LAST, base.created_at DESC
  LIMIT v_per_page OFFSET (v_page - 1) * v_per_page;
END;
$function$;

CREATE OR REPLACE FUNCTION public.listar_clientes_a_receber(
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  cliente_id uuid,
  cliente_nome text,
  cliente_nome_fantasia text,
  quantidade_titulos bigint,
  total_devido numeric,
  total_vencido numeric,
  total_pendente_regularizacao numeric,
  proximo_vencimento date
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_financial_company(_empresa_id, false);
  RETURN QUERY
  WITH lancamentos AS (
    SELECT fl.*
    FROM public.financeiro_lancamentos fl
    WHERE fl.empresa_id = v_company_id AND fl.tipo = 'receita' AND fl.cliente_id IS NOT NULL
  ), vencido_parcela AS (
    SELECT l.cliente_id, sum(p.valor - p.valor_recebido) AS total
    FROM public.financeiro_parcelas p
    JOIN lancamentos l ON l.id = p.lancamento_id
    WHERE p.status IN ('pendente', 'parcial') AND p.vencimento < current_date
    GROUP BY l.cliente_id
  )
  SELECT
    customer.id,
    customer.nome,
    customer.nome_fantasia,
    count(l.id) FILTER (WHERE l.status IN ('pendente', 'parcial'))::bigint,
    COALESCE(sum(l.valor_original - l.valor_recebido) FILTER (WHERE l.status IN ('pendente', 'parcial')), 0)::numeric,
    (
      COALESCE(sum(l.valor_original - l.valor_recebido) FILTER (
        WHERE l.status IN ('pendente', 'parcial') AND l.forma_cobranca = 'avista'
          AND l.vencimento IS NOT NULL AND l.vencimento < current_date
      ), 0)
      + COALESCE(max(vp.total), 0)
    )::numeric,
    COALESCE(sum(l.valor_recebido) FILTER (WHERE l.status = 'cancelado_pendente_regularizacao'), 0)::numeric,
    min(l.vencimento) FILTER (WHERE l.status IN ('pendente', 'parcial'))
  FROM lancamentos l
  JOIN public.clientes customer ON customer.empresa_id = l.empresa_id AND customer.id = l.cliente_id
  LEFT JOIN vencido_parcela vp ON vp.cliente_id = l.cliente_id
  WHERE l.status IN ('pendente', 'parcial', 'cancelado_pendente_regularizacao')
  GROUP BY customer.id, customer.nome, customer.nome_fantasia
  -- ORDER BY posicional (5 = total_devido): o nome da coluna colide com o
  -- parâmetro de saída da função (RETURNS TABLE), então uma referência por
  -- nome aqui é ambígua para o Postgres.
  ORDER BY 5 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.obter_financeiro_locacao(
  _locacao_id uuid,
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_result jsonb;
BEGIN
  v_company_id := public.resolve_financial_company(_empresa_id, false);
  SELECT to_jsonb(fl) || jsonb_build_object(
    -- Mesma regra de listar_contas_receber: nulo só acontece via backfill
    -- (o fluxo normal exige vencimento - FN015). Nunca tratado como vencido.
    'requer_revisao_vencimento', (
      fl.forma_cobranca = 'avista' AND fl.vencimento IS NULL
      AND fl.status IN ('pendente', 'parcial')
    ),
    'recebimentos', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.data_recebimento)
      FROM public.financeiro_recebimentos r
      WHERE r.lancamento_id = fl.id AND r.parcela_id IS NULL
    ), '[]'::jsonb),
    'parcelas', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
          'recebimentos', COALESCE((
            SELECT jsonb_agg(to_jsonb(r2) ORDER BY r2.data_recebimento)
            FROM public.financeiro_recebimentos r2
            WHERE r2.parcela_id = p.id
          ), '[]'::jsonb)
        )
        ORDER BY p.numero
      )
      FROM public.financeiro_parcelas p
      WHERE p.lancamento_id = fl.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.financeiro_lancamentos fl
  WHERE fl.empresa_id = v_company_id
    AND fl.origem_tipo = 'locacao_material'
    AND fl.origem_id = _locacao_id;
  RETURN v_result;
END;
$function$;

-- Fonte única de agregados de locação, usada tanto pelo card novo do
-- Dashboard quanto pelos cards do painel de Locações no Financeiro - os
-- dois nunca calculam o total de formas diferentes.
CREATE OR REPLACE FUNCTION public.obter_resumo_financeiro_locacoes(
  _empresa_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  valor_contratado numeric,
  valor_recebido numeric,
  valor_a_receber numeric,
  valor_vencido numeric,
  valor_pendente_regularizacao numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := public.resolve_financial_company(_empresa_id, false);
  RETURN QUERY
  -- Toda referência de coluna abaixo é qualificada com o alias da CTE/tabela,
  -- mesmo quando só há uma fonte no escopo: nomes como valor_recebido,
  -- status, vencimento também são parâmetros de saída desta função
  -- (RETURNS TABLE), então uma referência solta é ambígua para o Postgres.
  WITH lancamentos AS (
    SELECT fl.* FROM public.financeiro_lancamentos fl
    WHERE fl.empresa_id = v_company_id AND fl.origem_tipo = 'locacao_material' AND fl.tipo = 'receita'
  ), vencido_avista AS (
    SELECT COALESCE(sum(lc.valor_original - lc.valor_recebido), 0) AS total
    FROM lancamentos lc
    WHERE lc.forma_cobranca = 'avista' AND lc.status IN ('pendente', 'parcial')
      AND lc.vencimento IS NOT NULL AND lc.vencimento < current_date
  ), vencido_parcelado AS (
    SELECT COALESCE(sum(p.valor - p.valor_recebido), 0) AS total
    FROM public.financeiro_parcelas p
    JOIN lancamentos l ON l.id = p.lancamento_id
    WHERE p.status IN ('pendente', 'parcial') AND p.vencimento < current_date
  )
  SELECT
    COALESCE(sum(l.valor_original) FILTER (WHERE l.status NOT IN ('cancelado', 'cancelado_pendente_regularizacao', 'estornado')), 0)::numeric,
    COALESCE(sum(l.valor_recebido) FILTER (WHERE l.status NOT IN ('cancelado', 'cancelado_pendente_regularizacao', 'estornado')), 0)::numeric,
    COALESCE(sum(l.valor_original - l.valor_recebido) FILTER (WHERE l.status IN ('pendente', 'parcial')), 0)::numeric,
    ((SELECT total FROM vencido_avista) + (SELECT total FROM vencido_parcelado))::numeric,
    COALESCE(sum(l.valor_recebido) FILTER (WHERE l.status = 'cancelado_pendente_regularizacao'), 0)::numeric
  FROM lancamentos l;
END;
$function$;

-- ============================================================================
-- 10. GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.confirmar_reserva_locacao_material(uuid, uuid, uuid, text, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_recebimento_locacao(uuid, numeric, text, uuid, timestamptz, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_recebimento_locacao(uuid, text, uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_contas_receber(text, text, boolean, integer, integer, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_clientes_a_receber(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_financeiro_locacao(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_resumo_financeiro_locacoes(uuid) TO authenticated;
-- backfill_financeiro_locacoes propositalmente SEM grant para authenticated
-- (ver seção 8) - só executável via conexão com privilégio de owner/service
-- role, o mesmo canal usado para aplicar migrations.
