-- A company is the ownership root for all tenant-scoped operational data.
-- Keep global identities/audit rows (`profiles`, `system_logs`) with their
-- existing ON DELETE SET NULL semantics, and cascade every direct FK whose
-- row exists exclusively inside one company.

ALTER TABLE public.clientes
  DROP CONSTRAINT clientes_empresa_id_fkey,
  ADD CONSTRAINT clientes_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.empresa_bobina_perfis
  DROP CONSTRAINT empresa_bobina_perfis_empresa_id_fkey,
  ADD CONSTRAINT empresa_bobina_perfis_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.empresa_impressora_config
  DROP CONSTRAINT empresa_impressora_config_empresa_id_fkey,
  ADD CONSTRAINT empresa_impressora_config_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.estoque_movimentacoes
  DROP CONSTRAINT estoque_movimentacoes_empresa_id_fkey,
  ADD CONSTRAINT estoque_movimentacoes_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.event_days
  DROP CONSTRAINT event_days_empresa_id_fkey,
  ADD CONSTRAINT event_days_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.financeiro_lancamentos
  DROP CONSTRAINT financeiro_lancamentos_empresa_id_fkey,
  ADD CONSTRAINT financeiro_lancamentos_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.financeiro_parcelas
  DROP CONSTRAINT financeiro_parcelas_empresa_id_fkey,
  ADD CONSTRAINT financeiro_parcelas_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.financeiro_recebimentos
  DROP CONSTRAINT financeiro_recebimentos_empresa_id_fkey,
  ADD CONSTRAINT financeiro_recebimentos_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.manutencao_equipamento_numeradores
  DROP CONSTRAINT manutencao_equipamento_numeradores_empresa_id_fkey,
  ADD CONSTRAINT manutencao_equipamento_numeradores_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.manutencao_ordem_eventos
  DROP CONSTRAINT manutencao_ordem_eventos_empresa_id_fkey,
  ADD CONSTRAINT manutencao_ordem_eventos_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.manutencao_ordem_insumos
  DROP CONSTRAINT manutencao_ordem_insumos_empresa_id_fkey,
  ADD CONSTRAINT manutencao_ordem_insumos_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.manutencao_ordens
  DROP CONSTRAINT manutencao_ordens_empresa_id_fkey,
  ADD CONSTRAINT manutencao_ordens_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.material_custodia_eventos
  DROP CONSTRAINT material_custodia_eventos_empresa_id_fkey,
  ADD CONSTRAINT material_custodia_eventos_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.material_custodias
  DROP CONSTRAINT material_custodias_empresa_id_fkey,
  ADD CONSTRAINT material_custodias_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.material_locacao_eventos
  DROP CONSTRAINT material_locacao_eventos_empresa_id_fkey,
  ADD CONSTRAINT material_locacao_eventos_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.material_locacao_itens
  DROP CONSTRAINT material_locacao_itens_empresa_id_fkey,
  ADD CONSTRAINT material_locacao_itens_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.material_locacao_numeradores
  DROP CONSTRAINT material_locacao_numeradores_empresa_id_fkey,
  ADD CONSTRAINT material_locacao_numeradores_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.material_locacoes
  DROP CONSTRAINT material_locacoes_empresa_id_fkey,
  ADD CONSTRAINT material_locacoes_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

ALTER TABLE public.user_module_permissions
  DROP CONSTRAINT user_module_permissions_empresa_id_fkey,
  ADD CONSTRAINT user_module_permissions_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;

-- Several operational tables are direct children of empresas and also refer
-- to one another. PostgreSQL executes FK actions through triggers and does not
-- topologically order multiple cascade paths. Keep those domain relationships
-- restrictive for ordinary deletes, but defer their NO ACTION checks until the
-- transaction ends so the company-root cascade can finish atomically.
ALTER TABLE public.materiais
  DROP CONSTRAINT materiais_categoria_id_fkey,
  ADD CONSTRAINT materiais_categoria_id_fkey
    FOREIGN KEY (categoria_id) REFERENCES public.categorias_materiais(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.estoque_localizacoes
  DROP CONSTRAINT estoque_localizacoes_parent_fkey,
  ADD CONSTRAINT estoque_localizacoes_parent_fkey
    FOREIGN KEY (empresa_id, localizacao_pai_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.estoque_saldos
  DROP CONSTRAINT estoque_saldos_empresa_material_fkey,
  ADD CONSTRAINT estoque_saldos_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT estoque_saldos_empresa_localizacao_fkey,
  ADD CONSTRAINT estoque_saldos_empresa_localizacao_fkey
    FOREIGN KEY (empresa_id, localizacao_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.estoque_movimentacoes
  DROP CONSTRAINT estoque_movimentacoes_empresa_material_fkey,
  ADD CONSTRAINT estoque_movimentacoes_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT estoque_movimentacoes_empresa_origem_fkey,
  ADD CONSTRAINT estoque_movimentacoes_empresa_origem_fkey
    FOREIGN KEY (empresa_id, localizacao_origem_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT estoque_movimentacoes_empresa_destino_fkey,
  ADD CONSTRAINT estoque_movimentacoes_empresa_destino_fkey
    FOREIGN KEY (empresa_id, localizacao_destino_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT estoque_movimentacoes_estornada_fkey,
  ADD CONSTRAINT estoque_movimentacoes_estornada_fkey
    FOREIGN KEY (empresa_id, material_id, movimentacao_estornada_id)
    REFERENCES public.estoque_movimentacoes (empresa_id, material_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.material_custodias
  DROP CONSTRAINT material_custodias_empresa_material_fkey,
  ADD CONSTRAINT material_custodias_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT material_custodias_empresa_origem_fkey,
  ADD CONSTRAINT material_custodias_empresa_origem_fkey
    FOREIGN KEY (empresa_id, localizacao_origem_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT material_custodias_empresa_movimento_saida_fkey,
  ADD CONSTRAINT material_custodias_empresa_movimento_saida_fkey
    FOREIGN KEY (empresa_id, material_id, movimento_saida_id)
    REFERENCES public.estoque_movimentacoes (empresa_id, material_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.material_custodia_eventos
  DROP CONSTRAINT material_custodia_eventos_empresa_custodia_fkey,
  ADD CONSTRAINT material_custodia_eventos_empresa_custodia_fkey
    FOREIGN KEY (empresa_id, custodia_id)
    REFERENCES public.material_custodias (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT material_custodia_eventos_empresa_material_fkey,
  ADD CONSTRAINT material_custodia_eventos_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT material_custodia_eventos_empresa_origem_fkey,
  ADD CONSTRAINT material_custodia_eventos_empresa_origem_fkey
    FOREIGN KEY (empresa_id, localizacao_origem_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT material_custodia_eventos_empresa_destino_fkey,
  ADD CONSTRAINT material_custodia_eventos_empresa_destino_fkey
    FOREIGN KEY (empresa_id, localizacao_destino_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT material_custodia_eventos_empresa_movimento_fkey,
  ADD CONSTRAINT material_custodia_eventos_empresa_movimento_fkey
    FOREIGN KEY (empresa_id, material_id, movimento_estoque_id)
    REFERENCES public.estoque_movimentacoes (empresa_id, material_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.material_locacoes
  DROP CONSTRAINT material_locacoes_empresa_cliente_fkey,
  ADD CONSTRAINT material_locacoes_empresa_cliente_fkey
    FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES public.clientes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.material_locacao_itens
  DROP CONSTRAINT material_locacao_itens_empresa_locacao_fkey,
  ADD CONSTRAINT material_locacao_itens_empresa_locacao_fkey
    FOREIGN KEY (empresa_id, locacao_id)
    REFERENCES public.material_locacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT material_locacao_itens_empresa_material_fkey,
  ADD CONSTRAINT material_locacao_itens_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.material_locacao_eventos
  DROP CONSTRAINT material_locacao_eventos_empresa_locacao_fkey,
  ADD CONSTRAINT material_locacao_eventos_empresa_locacao_fkey
    FOREIGN KEY (empresa_id, locacao_id)
    REFERENCES public.material_locacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT material_locacao_eventos_empresa_item_fkey,
  ADD CONSTRAINT material_locacao_eventos_empresa_item_fkey
    FOREIGN KEY (empresa_id, item_id)
    REFERENCES public.material_locacao_itens (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT material_locacao_eventos_empresa_custodia_fkey,
  ADD CONSTRAINT material_locacao_eventos_empresa_custodia_fkey
    FOREIGN KEY (empresa_id, custodia_id)
    REFERENCES public.material_custodias (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.manutencao_ordens
  DROP CONSTRAINT manutencao_ordens_empresa_material_fkey,
  ADD CONSTRAINT manutencao_ordens_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT manutencao_ordens_empresa_checkin_event_fkey,
  ADD CONSTRAINT manutencao_ordens_empresa_checkin_event_fkey
    FOREIGN KEY (empresa_id, custodia_evento_origem_id)
    REFERENCES public.material_custodia_eventos (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.manutencao_ordem_insumos
  DROP CONSTRAINT manutencao_insumos_empresa_ordem_fkey,
  ADD CONSTRAINT manutencao_insumos_empresa_ordem_fkey
    FOREIGN KEY (empresa_id, ordem_id)
    REFERENCES public.manutencao_ordens (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT manutencao_insumos_empresa_material_fkey,
  ADD CONSTRAINT manutencao_insumos_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.manutencao_ordem_eventos
  DROP CONSTRAINT manutencao_eventos_empresa_ordem_fkey,
  ADD CONSTRAINT manutencao_eventos_empresa_ordem_fkey
    FOREIGN KEY (empresa_id, ordem_id)
    REFERENCES public.manutencao_ordens (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.etiqueta_impressoes
  DROP CONSTRAINT etiqueta_impressoes_material_company_fk,
  ADD CONSTRAINT etiqueta_impressoes_material_company_fk
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT etiqueta_impressoes_reprint_company_fk,
  ADD CONSTRAINT etiqueta_impressoes_reprint_company_fk
    FOREIGN KEY (empresa_id, reimpressao_de_id)
    REFERENCES public.etiqueta_impressoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT etiqueta_impressoes_modelo_company_fk,
  ADD CONSTRAINT etiqueta_impressoes_modelo_company_fk
    FOREIGN KEY (empresa_id, modelo_id)
    REFERENCES public.etiqueta_modelos (empresa_id, id)
    ON DELETE SET NULL (modelo_id);

ALTER TABLE public.etiqueta_solicitacoes
  DROP CONSTRAINT etiqueta_solicitacoes_reprint_company_fk,
  ADD CONSTRAINT etiqueta_solicitacoes_reprint_company_fk
    FOREIGN KEY (empresa_id, reimpressao_de_id)
    REFERENCES public.etiqueta_solicitacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT etiqueta_solicitacoes_modelo_company_fk,
  ADD CONSTRAINT etiqueta_solicitacoes_modelo_company_fk
    FOREIGN KEY (empresa_id, modelo_id)
    REFERENCES public.etiqueta_modelos (empresa_id, id)
    ON DELETE SET NULL (modelo_id);

ALTER TABLE public.etiqueta_solicitacao_itens
  DROP CONSTRAINT etiqueta_solicitacao_itens_material_company_fk,
  ADD CONSTRAINT etiqueta_solicitacao_itens_material_company_fk
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.rfid_tags
  DROP CONSTRAINT rfid_tags_material_id_fkey,
  ADD CONSTRAINT rfid_tags_material_id_fkey
    FOREIGN KEY (material_id) REFERENCES public.materiais(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.scanner_remoto_sessoes
  DROP CONSTRAINT scanner_remoto_sessoes_empresa_origem_fkey,
  ADD CONSTRAINT scanner_remoto_sessoes_empresa_origem_fkey
    FOREIGN KEY (empresa_id, localizacao_origem_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT scanner_remoto_sessoes_empresa_destino_fkey,
  ADD CONSTRAINT scanner_remoto_sessoes_empresa_destino_fkey
    FOREIGN KEY (empresa_id, localizacao_destino_id)
    REFERENCES public.estoque_localizacoes (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.scanner_remoto_leituras
  DROP CONSTRAINT scanner_remoto_leituras_empresa_material_fkey,
  ADD CONSTRAINT scanner_remoto_leituras_empresa_material_fkey
    FOREIGN KEY (empresa_id, material_id)
    REFERENCES public.materiais (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT scanner_remoto_leituras_empresa_custodia_fkey,
  ADD CONSTRAINT scanner_remoto_leituras_empresa_custodia_fkey
    FOREIGN KEY (empresa_id, custodia_id)
    REFERENCES public.material_custodias (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.financeiro_lancamentos
  DROP CONSTRAINT financeiro_lancamentos_cliente_id_fkey,
  ADD CONSTRAINT financeiro_lancamentos_cliente_id_fkey
    FOREIGN KEY (cliente_id) REFERENCES public.clientes(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.financeiro_parcelas
  DROP CONSTRAINT financeiro_parcelas_empresa_lancamento_fkey,
  ADD CONSTRAINT financeiro_parcelas_empresa_lancamento_fkey
    FOREIGN KEY (empresa_id, lancamento_id)
    REFERENCES public.financeiro_lancamentos (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.financeiro_recebimentos
  DROP CONSTRAINT financeiro_recebimentos_recebimento_estornado_id_fkey,
  ADD CONSTRAINT financeiro_recebimentos_recebimento_estornado_id_fkey
    FOREIGN KEY (recebimento_estornado_id)
    REFERENCES public.financeiro_recebimentos(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT financeiro_recebimentos_empresa_lancamento_fkey,
  ADD CONSTRAINT financeiro_recebimentos_empresa_lancamento_fkey
    FOREIGN KEY (empresa_id, lancamento_id)
    REFERENCES public.financeiro_lancamentos (empresa_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT financeiro_recebimentos_lancamento_parcela_fkey,
  ADD CONSTRAINT financeiro_recebimentos_lancamento_parcela_fkey
    FOREIGN KEY (lancamento_id, parcela_id)
    REFERENCES public.financeiro_parcelas (lancamento_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.asaas_payments
  DROP CONSTRAINT asaas_payments_related_batch_request_id_fkey,
  ADD CONSTRAINT asaas_payments_related_batch_request_id_fkey
    FOREIGN KEY (related_batch_request_id)
    REFERENCES public.module_batch_requests(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

-- Cascaded deletes still execute application triggers. Preserve every normal
-- immutability/usage guard and bypass it only after its owning company row has
-- disappeared as part of the same root DELETE.
CREATE OR REPLACE FUNCTION public.protect_used_material_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.materiais WHERE categoria_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Categoria em uso não pode ser excluída; inative-a';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_used_stock_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (SELECT 1 FROM public.estoque_localizacoes WHERE localizacao_pai_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.estoque_saldos WHERE localizacao_id = OLD.id)
     OR EXISTS (
       SELECT 1 FROM public.estoque_movimentacoes
       WHERE localizacao_origem_id = OLD.id OR localizacao_destino_id = OLD.id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ST017',
      MESSAGE = 'Localização em uso não pode ser excluída; inative-a.';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_material_stock_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_company_id uuid := COALESCE(NEW.empresa_id, OLD.empresa_id);
  v_material_id uuid := COALESCE(NEW.material_id, OLD.material_id);
  v_total integer;
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(sum(quantidade), 0)::integer INTO v_total
  FROM public.estoque_saldos
  WHERE empresa_id = v_company_id
    AND material_id = v_material_id;
  PERFORM set_config('backstage.stock_projection_write', 'on', true);
  UPDATE public.materiais
  SET quantidade = v_total
  WHERE empresa_id = v_company_id
    AND id = v_material_id;
  PERFORM set_config('backstage.stock_projection_write', 'off', true);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_stock_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'ST019',
    MESSAGE = 'O histórico de estoque é imutável.';
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_material_custody_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'material_custodia_eventos' THEN
    RAISE EXCEPTION USING ERRCODE = 'CI019',
      MESSAGE = 'O histórico de custódia é imutável.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'CI019',
      MESSAGE = 'Operações de custódia não podem ser excluídas.';
  END IF;
  IF COALESCE(current_setting('backstage.custody_projection_write', true), '') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'CI019',
      MESSAGE = 'Use as operações explícitas de check-in ou cancelamento.';
  END IF;
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.material_id IS DISTINCT FROM OLD.material_id
     OR NEW.tipo_controle IS DISTINCT FROM OLD.tipo_controle
     OR NEW.quantidade_retirada IS DISTINCT FROM OLD.quantidade_retirada
     OR NEW.localizacao_origem_id IS DISTINCT FROM OLD.localizacao_origem_id
     OR NEW.retirada_em IS DISTINCT FROM OLD.retirada_em
     OR NEW.executado_por IS DISTINCT FROM OLD.executado_por
     OR NEW.responsavel_tipo IS DISTINCT FROM OLD.responsavel_tipo
     OR NEW.responsavel_usuario_id IS DISTINCT FROM OLD.responsavel_usuario_id
     OR NEW.responsavel_funcionario_id IS DISTINCT FROM OLD.responsavel_funcionario_id
     OR NEW.responsavel_nome IS DISTINCT FROM OLD.responsavel_nome
     OR NEW.finalidade IS DISTINCT FROM OLD.finalidade
     OR NEW.referencia_tipo IS DISTINCT FROM OLD.referencia_tipo
     OR NEW.referencia_id IS DISTINCT FROM OLD.referencia_id
     OR NEW.observacao_saida IS DISTINCT FROM OLD.observacao_saida
     OR NEW.condicao_saida IS DISTINCT FROM OLD.condicao_saida
     OR NEW.movimento_saida_id IS DISTINCT FROM OLD.movimento_saida_id
     OR NEW.client_uuid IS DISTINCT FROM OLD.client_uuid
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = 'CI019',
      MESSAGE = 'Os dados históricos do check-out são imutáveis.';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_material_rental_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'material_locacao_eventos' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR019',
      MESSAGE = 'O histórico da locação é imutável.';
  END IF;
  IF COALESCE(current_setting('backstage.material_rental_write', true), '') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR019',
      MESSAGE = 'Use as operações explícitas do módulo de locações.';
  END IF;
  IF TG_TABLE_NAME = 'material_locacoes' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'LR019', MESSAGE = 'Locações não podem ser excluídas.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_equipment_maintenance_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  IF COALESCE(current_setting('backstage.equipment_maintenance_write', true), '') <> 'on' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Use as operações canônicas de manutenção.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_equipment_maintenance_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'O histórico de manutenção é imutável.';
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_material_label_projection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF current_setting('backstage.material_labels_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Use as operacoes oficiais de etiquetas.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_material_label_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'LB014', MESSAGE = 'O historico de impressoes e imutavel.';
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_material_label_batch_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT'
     AND current_setting('backstage.material_label_batch_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'LB014', MESSAGE = 'O historico de impressoes e imutavel.';
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_rfid_tag_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_material_empresa_id uuid;
  v_material_control public.material_control_type;
BEGIN
  -- Deleting one tag may SET NULL another tag's replacement pointer before
  -- both rows are removed by the company cascade.
  IF TG_OP = 'UPDATE'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN NEW;
  END IF;

  NEW.epc := upper(btrim(NEW.epc));
  NEW.motivo_desativacao := nullif(btrim(NEW.motivo_desativacao), '');
  NEW.updated_at := clock_timestamp();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);

  SELECT material.empresa_id, material.tipo_controle
  INTO v_material_empresa_id, v_material_control
  FROM public.materiais AS material
  WHERE material.id = NEW.material_id;

  IF v_material_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Material da tag não foi encontrado';
  END IF;

  IF v_material_empresa_id <> NEW.empresa_id THEN
    RAISE EXCEPTION 'Material deve pertencer à mesma empresa da tag';
  END IF;

  IF v_material_control <> 'individual' THEN
    RAISE EXCEPTION
      'Somente materiais de controle individual podem receber tag RFID';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  ELSE
    IF NEW.epc IS DISTINCT FROM OLD.epc THEN
      RAISE EXCEPTION
        'EPC de uma tag é imutável; para trocar, desative e vincule uma nova';
    END IF;
    IF NEW.material_id IS DISTINCT FROM OLD.material_id THEN
      RAISE EXCEPTION 'Vínculo de material de uma tag é imutável';
    END IF;
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
      RAISE EXCEPTION 'Empresa de uma tag é imutável';
    END IF;
    IF OLD.status <> 'ativa' AND NEW.status = 'ativa' THEN
      RAISE EXCEPTION
        'Uma tag desativada não pode ser reativada; crie um novo vínculo';
    END IF;
    NEW.vinculada_em := OLD.vinculada_em;
    NEW.created_by := OLD.created_by;
  END IF;

  IF NEW.status <> 'ativa' AND NEW.desativada_em IS NULL THEN
    NEW.desativada_em := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_financeiro_recebimentos_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'FN001',
    MESSAGE = 'O histórico de recebimentos é imutável.';
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_material_photo_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
    RETURN OLD;
  END IF;

  IF OLD.foto_principal THEN
    UPDATE public.materiais_fotos
    SET foto_principal = true
    WHERE id = (
      SELECT id
      FROM public.materiais_fotos
      WHERE material_id = OLD.material_id
      ORDER BY created_at, id
      LIMIT 1
    );
  END IF;

  RETURN OLD;
END;
$$;

-- Direct membership deletion must still require switching the active company.
-- During a company-root cascade, however, the parent no longer exists and the
-- membership must be allowed to disappear without deleting the Auth identity.
CREATE OR REPLACE FUNCTION public.guard_empresa_usuario_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END::text,
      0
    )
  );

  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id
    ) THEN
      RETURN OLD;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE user_id = OLD.user_id
        AND empresa_id = OLD.empresa_id
    ) THEN
      RAISE EXCEPTION
        'The active company membership must be switched before it is removed';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'A company membership requires an existing profile';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_company_removal_audit
    WHERE target_user_id = NEW.user_id
      AND auth_deletion_status IN ('pending', 'failed')
  ) THEN
    RAISE EXCEPTION
      'The Auth identity has a pending deletion and cannot receive new memberships';
  END IF;

  NEW.perfil := public.get_canonical_empresa_perfil(NEW.user_id);
  RETURN NEW;
END;
$$;
