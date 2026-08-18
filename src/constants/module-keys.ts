/**
 * ============================================================================
 * BACKSTAGE PRO — FEATURE KEYS DO CATÁLOGO DE MÓDULOS
 * ============================================================================
 *
 * Constantes centralizadas para as feature_key do module_catalog.
 * Usar SEMPRE estas constantes em vez de strings literais espalhadas.
 *
 * Para adicionar um novo módulo:
 * 1. Insira o registro no module_catalog com a feature_key
 * 2. Adicione a constante aqui
 * 3. Use ModuleGate ou hasModule() nos componentes
 */

export const MODULE_KEYS = {
  /** Financeiro avançado (relatórios detalhados, gráficos) */
  FINANCEIRO_AVANCADO: "financeiro_avancado",
  /** Relatórios e exportações especiais */
  RELATORIOS: "relatorios",
  /** @deprecated Catálogo histórico; não possui feature dedicada vendável. */
  AGENDA_COMPARTILHADA: "agenda_compartilhada",
  /** @deprecated Administração de equipe já é coberta pelo núcleo do produto. */
  EQUIPE_PERMISSOES: "equipe_permissoes",
  /** Checklist técnico para eventos */
  CHECKLIST_TECNICO: "checklist_tecnico",
  /** Documentos e contratos avançados */
  DOCUMENTOS_AVANCADOS: "documentos_avancados",
  /** Painel operacional */
  PAINEL_OPERACIONAL: "painel_operacional",
  /** @deprecated Descontinuado — funcionalidade incorporada ao módulo RELATORIOS */
  EXPORTACOES_ESPECIAIS: "exportacoes_especiais",
  /** @deprecated Catálogo histórico; não possui feature dedicada vendável. */
  NOTIFICACOES_PREMIUM: "notificacoes_premium",
  /** Pacote extra de usuários */
  EXTRA_USUARIOS: "extra_usuarios",
  /** Pacote extra de eventos */
  EXTRA_EVENTOS: "extra_eventos",
  /** Pacote extra de armazenamento */
  EXTRA_STORAGE: "extra_storage",
  /** Cadastro patrimonial de materiais e equipamentos */
  GESTAO_MATERIAIS: "gestao_materiais",
  /** Movimentações e saldos de estoque por localização */
  CONTROLE_ESTOQUE: "controle_estoque",
  /** Retirada, devolução e custódia física de materiais */
  CHECKIN_CHECKOUT: "checkin_checkout",
  /** Locação, reservas por período e integração com custódia */
  LOCACAO_MATERIAIS: "locacao_materiais",
  /** Manutenção preventiva e corretiva (planejado) */
  MANUTENCAO_EQUIPAMENTOS: "manutencao_equipamentos",
  /** Modelos, impressão e histórico de etiquetas físicas (planejado) */
  ETIQUETAS_MATERIAIS: "etiquetas_materiais",
  /** @deprecated Catálogo histórico; relatórios dedicados ainda não implementados. */
  RELATORIOS_MATERIAIS: "relatorios_materiais",
  /** Identificação e conferência em lote de materiais por tags RFID UHF */
  RFID_MATERIAIS: "rfid_materiais",
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];
