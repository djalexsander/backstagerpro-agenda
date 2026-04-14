/**
 * ============================================================================
 * BACKSTAGE PRO — MAPEAMENTO DA ARQUITETURA DE PLANOS (v1.1.2)
 * ============================================================================
 *
 * Este arquivo é uma documentação técnica viva. NÃO é importado em produção.
 * Serve como referência para a futura migração:
 *   MODELO ATUAL  → plano único por empresa
 *   MODELO FUTURO → plano base + módulos adicionais
 *
 * ============================================================================
 * 1. TABELAS ENVOLVIDAS
 * ============================================================================
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ TABELA: planos                                                     │
 * │ Campos-chave: nome, valor, periodicidade (mensal/anual/vitalicio), │
 * │   max_usuarios, max_eventos, storage_limit, trial_days, ativo      │
 * │ Observação: hoje define limites globais do plano inteiro.           │
 * │ FUTURO: esta tabela se torna "plano_base". Limites adicionais      │
 * │   virão de uma tabela "modulos" vinculada via "plano_modulos".     │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ TABELA: empresas                                                   │
 * │ Campos de plano: plano (text label), plano_id (FK → planos),       │
 * │   plano_bloqueado, status, status_pagamento, vencimento,           │
 * │   trial_expires_at, precisa_escolher_plano, data_contrato          │
 * │ FUTURO: adicionar campo ou tabela relacional "empresa_modulos"     │
 * │   para módulos contratados por empresa.                            │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ TABELA: pagamentos                                                 │
 * │ Campos: empresa_id, plano_id, valor, status, metodo,               │
 * │   comprovante_path, descricao                                      │
 * │ FUTURO: pode receber campo "modulo_id" para pagamentos de módulos. │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ TABELA: notificacoes_master                                        │
 * │ Usada para: auto_cadastro, upgrade_plano, comprovante_enviado,     │
 * │   pagamento_pendente, vencimento_proximo, trial_expirando etc.     │
 * │ FUTURO: sem mudança estrutural necessária. Os tipos de notificação │
 * │   já cobrem extensões de módulos.                                  │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ============================================================================
 * 2. HOOKS E LÓGICA DE LIMITES
 * ============================================================================
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ HOOK: usePlanLimits (src/hooks/usePlanLimits.ts)                   │
 * │ Consulta: empresas.plano_id → planos.max_usuarios/max_eventos      │
 * │ Contagem: events (count), empresa_usuarios (count)                 │
 * │ Master admin: bypassa todos os limites                             │
 * │ FUTURO: estender para somar limites de módulos adicionais ao       │
 * │   limite base do plano. Criar interface PlanCapabilities.          │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ============================================================================
 * 3. TRIGGERS SQL DE LIMITES
 * ============================================================================
 *
 * • check_event_limit() — valida max_eventos antes de INSERT em events
 * • check_user_limit()  — valida max_usuarios antes de INSERT em empresa_usuarios
 * • Ambos consultam planos.max_X diretamente via empresa.plano_id
 * • FUTURO: alterar para somar limites de módulos ou usar função auxiliar
 *   que consolida plano_base + módulos.
 *
 * ============================================================================
 * 4. EDGE FUNCTIONS
 * ============================================================================
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ self-register     — cria empresa + usuário admin_empresa            │
 * │                     seta precisa_escolher_plano = true              │
 * │ choose-plan       — ativa trial (7d) ou marca plano pago pendente  │
 * │ check-vencimentos — verifica expiração e cria notificações         │
 * │ FUTURO: choose-plan pode receber array de módulos selecionados.    │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ============================================================================
 * 5. TELAS DE ASSINATURA / PLANO
 * ============================================================================
 *
 * • EscolherPlano.tsx   — tela pós-cadastro; lista planos + botão free trial
 * • PagamentoPlano.tsx  — PIX + upload comprovante para plano pago
 * • PlanoAssinatura.tsx — painel interno da empresa (plano atual, pagar, upgrade, histórico)
 * • master/Planos.tsx   — CRUD de planos pelo master admin
 * • FUTURO: EscolherPlano e PlanoAssinatura precisarão mostrar módulos
 *   opcionais abaixo do plano base. master/Planos.tsx ganha aba de módulos.
 *
 * ============================================================================
 * 6. CONTEXTO DE AUTH E BLOQUEIO
 * ============================================================================
 *
 * • AuthContext.tsx      — fetchUserData carrega empresa.plano_bloqueado,
 *                          trial_expires_at, vencimento, status, precisa_escolher_plano
 * • ProtectedRoute.tsx   — redireciona para /escolher-plano se precisa_escolher_plano
 *                          bloqueia rotas se empresaBloqueada (modo leitura)
 * • PlanoBloqueado.tsx   — banner read-only
 * • FUTURO: sem mudança estrutural; bloqueio continua baseado em empresa.
 *
 * ============================================================================
 * 7. PONTOS DE EXTENSÃO PARA MÓDULOS (FUTURA ETAPA)
 * ============================================================================
 *
 * A. Novas tabelas:
 *    - modulos (id, nome, descricao, valor, tipo_limite, limite_valor, ativo)
 *    - plano_modulos (plano_id, modulo_id, incluido) — módulos inclusos no plano base
 *    - empresa_modulos (empresa_id, modulo_id, ativo, vencimento) — módulos contratados
 *
 * B. Alterar triggers check_event_limit e check_user_limit para consultar
 *    função consolidada que soma plano base + módulos.
 *
 * C. Alterar usePlanLimits para incluir dados de empresa_modulos.
 *
 * D. Alterar telas de plano para exibir módulos opcionais.
 *
 * E. Alterar choose-plan para aceitar módulos selecionados.
 *
 * ============================================================================
 */

// Exportação vazia para manter o arquivo como módulo TS válido
export {};
