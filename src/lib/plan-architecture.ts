/**
 * ============================================================================
 * BACKSTAGE PRO — ARQUITETURA DE PLANOS (v2.0)
 * ============================================================================
 *
 * Modelo atual: PLANO BASE + MÓDULOS ADICIONAIS
 *
 * ============================================================================
 * 1. TABELAS
 * ============================================================================
 *
 * planos           — Plano base (nome, valor, periodicidade, limites)
 * empresas         — Vínculo com plano via plano_id, vencimento, trial
 * module_catalog   — Catálogo de módulos disponíveis (feature_key, valor, capacidade)
 * empresa_modules  — Módulos contratados por empresa (status, trial_granted, origem)
 * module_dependencies — Dependências reutilizáveis entre módulos
 * module_requests  — Solicitações de módulos pelas empresas
 * module_payments  — Pagamentos de módulos
 * pagamentos       — Pagamentos do plano base
 *
 * ============================================================================
 * 2. HOOKS
 * ============================================================================
 *
 * useCompanyModules    — Módulos da empresa com catálogo enriquecido
 * useSubscriptionSummary — Resumo consolidado (plano + módulos + valores)
 * usePlanLimits        — Limites consolidados (base + módulos de capacidade)
 *
 * ============================================================================
 * 3. CONTROLE DE ACESSO
 * ============================================================================
 *
 * ModuleGate        — Componente de gate por feature_key (hide/lock/custom)
 * useModuleAccess   — Hook inline para verificação de acesso
 * MODULE_KEYS       — Constantes centralizadas de feature_key
 *
 * ============================================================================
 * 4. TRIGGERS SQL
 * ============================================================================
 *
 * check_event_limit  — Valida max_eventos (base + módulos de capacidade)
 * check_user_limit   — Valida max_usuarios (base + módulos de capacidade)
 * deactivate_trial_modules — Desativa módulos trial quando trial expira
 * company_has_active_module — Valida entitlement, expiração e dependências
 *
 * ============================================================================
 * 5. FLUXOS
 * ============================================================================
 *
 * Empresa solicita módulo → module_requests (pending)
 * Master aprova → empresa_modules (active) + log
 * Master rejeita → module_requests (rejected) + log
 * Pagamento de módulo → module_payments → aprovação → ativação
 * Ativação manual → empresa_modules com granted_by_admin + origem
 * Trial → módulos com trial_granted=true → desativados automaticamente
 * Dependente ativo → exige todos os módulos-base ativos
 * Desativação de módulo-base → bloqueada enquanto houver dependentes ativos
 *
 * ============================================================================
 */

export {};
