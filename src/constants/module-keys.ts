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
  /** Agenda compartilhada entre empresas */
  AGENDA_COMPARTILHADA: "agenda_compartilhada",
  /** Equipe e permissões */
  EQUIPE_PERMISSOES: "equipe_permissoes",
  /** Checklist técnico para eventos */
  CHECKLIST_TECNICO: "checklist_tecnico",
  /** Documentos e contratos avançados */
  DOCUMENTOS_AVANCADOS: "documentos_avancados",
  /** Painel operacional */
  PAINEL_OPERACIONAL: "painel_operacional",
  /** Exportações especiais (DOCX, Excel, relatórios PDF customizados) */
  EXPORTACOES_ESPECIAIS: "exportacoes_especiais",
  /** Notificações premium */
  NOTIFICACOES_PREMIUM: "notificacoes_premium",
  /** Pacote extra de usuários */
  EXTRA_USUARIOS: "extra_usuarios",
  /** Pacote extra de eventos */
  EXTRA_EVENTOS: "extra_eventos",
  /** Pacote extra de armazenamento */
  EXTRA_STORAGE: "extra_storage",
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];
