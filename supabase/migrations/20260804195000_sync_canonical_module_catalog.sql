-- Sync the canonical module catalog so the Master catalog exposes all commercial modules
-- (legacy core modules + the materials modules) without duplicates and with the expected
-- feature keys and dependencies.

INSERT INTO public.module_catalog (
  nome,
  descricao,
  valor,
  periodicidade,
  ativo,
  ordem,
  tipo_modulo,
  feature_key,
  metadata,
  is_capacity_module,
  categoria,
  texto_venda
)
VALUES
  (
    'Financeiro Avançado',
    'Relatórios financeiros, gráficos e ferramentas de gestão financeira.',
    0,
    'mensal',
    true,
    1,
    'addon',
    'financeiro_avancado',
    '{"area":"core"}'::jsonb,
    false,
    'financeiro',
    'Agilidade financeira para a operação.'
  ),
  (
    'Relatórios',
    'Relatórios e exportações especiais para a operação.',
    0,
    'mensal',
    true,
    2,
    'addon',
    'relatorios',
    '{"area":"core"}'::jsonb,
    false,
    'gestao',
    'Visão prática da operação.'
  ),
  (
    'Agenda Compartilhada',
    'Agenda compartilhada entre equipes e empresas.',
    0,
    'mensal',
    true,
    3,
    'addon',
    'agenda_compartilhada',
    '{"area":"core"}'::jsonb,
    false,
    'operacional',
    'Mais alinhamento para toda a equipe.'
  ),
  (
    'Equipe e Permissões',
    'Gerenciamento de usuários, papéis e permissões.',
    0,
    'mensal',
    true,
    4,
    'addon',
    'equipe_permissoes',
    '{"area":"core"}'::jsonb,
    false,
    'gestao',
    'Controle de acesso e organização.'
  ),
  (
    'Checklist Técnico',
    'Checklist e procedimentos técnicos para eventos.',
    0,
    'mensal',
    true,
    5,
    'addon',
    'checklist_tecnico',
    '{"area":"core"}'::jsonb,
    false,
    'operacional',
    'Padronize o trabalho em campo.'
  ),
  (
    'Documentos Avançados',
    'Documentos e contratos avançados.',
    0,
    'mensal',
    true,
    6,
    'addon',
    'documentos_avancados',
    '{"area":"core"}'::jsonb,
    false,
    'gestao',
    'Centralize documentos e contratos.'
  ),
  (
    'Painel Operacional',
    'Painel operacional com visão completa da operação.',
    0,
    'mensal',
    true,
    7,
    'addon',
    'painel_operacional',
    '{"area":"core"}'::jsonb,
    false,
    'operacional',
    'Visão completa para o dia a dia.'
  ),
  (
    'Notificações Premium',
    'Notificações premium e comunicação avançada.',
    0,
    'mensal',
    true,
    8,
    'addon',
    'notificacoes_premium',
    '{"area":"core"}'::jsonb,
    false,
    'premium',
    'Comunicação mais forte com a equipe.'
  ),
  (
    'Extra Usuários',
    'Capacidade extra de usuários.',
    0,
    'mensal',
    true,
    9,
    'capacidade',
    'extra_usuarios',
    '{"area":"capacidade"}'::jsonb,
    true,
    'capacidade',
    'Aumente o limite de usuários.'
  ),
  (
    'Extra Eventos',
    'Capacidade extra de eventos.',
    0,
    'mensal',
    true,
    10,
    'capacidade',
    'extra_eventos',
    '{"area":"capacidade"}'::jsonb,
    true,
    'capacidade',
    'Amplie a capacidade operacional.'
  ),
  (
    'Extra Storage',
    'Capacidade extra de armazenamento.',
    0,
    'mensal',
    true,
    11,
    'capacidade',
    'extra_storage',
    '{"area":"capacidade"}'::jsonb,
    true,
    'capacidade',
    'Mais espaço para arquivos e documentos.'
  ),
  (
    'Gestão de Materiais',
    'Cadastro patrimonial de categorias, materiais, equipamentos, fotos e identificação técnica.',
    0,
    'mensal',
    true,
    40,
    'addon',
    'gestao_materiais',
    '{"area":"materiais","base_module":true}'::jsonb,
    false,
    'operacional',
    'Organize materiais, equipamentos, fotos e identificadores técnicos.'
  ),
  (
    'Controle de Estoque',
    'Entradas, saídas, ajustes e inventários.',
    0,
    'mensal',
    true,
    41,
    'addon',
    'controle_estoque',
    '{"area":"materiais"}'::jsonb,
    false,
    'operacional',
    'Controle preciso do estoque e dos saldos.'
  ),
  (
    'Check-in / Check-out',
    'Retirada, conferência e devolução de materiais.',
    0,
    'mensal',
    true,
    42,
    'addon',
    'checkin_checkout',
    '{"area":"materiais"}'::jsonb,
    false,
    'operacional',
    'Gestão física de entradas e saídas.'
  ),
  (
    'Locação de Materiais',
    'Reservas, locações e controle de disponibilidade.',
    0,
    'mensal',
    true,
    43,
    'addon',
    'locacao_materiais',
    '{"area":"materiais"}'::jsonb,
    false,
    'operacional',
    'Gerencie locações com organização e rastreio.'
  ),
  (
    'Manutenção de Equipamentos',
    'Planejamento, execução e histórico das manutenções.',
    0,
    'mensal',
    true,
    44,
    'addon',
    'manutencao_equipamentos',
    '{"area":"materiais"}'::jsonb,
    false,
    'operacional',
    'Mantenha equipamentos com confiabilidade.'
  ),
  (
    'Etiquetas de Materiais',
    'Modelos, impressão e histórico de etiquetas físicas.',
    0,
    'mensal',
    true,
    45,
    'addon',
    'etiquetas_materiais',
    '{"area":"materiais"}'::jsonb,
    false,
    'operacional',
    'Etiquetas personalizadas e rastreáveis.'
  ),
  (
    'Relatórios de Materiais',
    'Indicadores operacionais e comerciais da área de materiais.',
    0,
    'mensal',
    true,
    46,
    'addon',
    'relatorios_materiais',
    '{"area":"materiais"}'::jsonb,
    false,
    'gestao',
    'Leia a operação com mais clareza.'
  )
ON CONFLICT (feature_key) DO UPDATE
SET nome = EXCLUDED.nome,
    descricao = EXCLUDED.descricao,
    valor = EXCLUDED.valor,
    periodicidade = EXCLUDED.periodicidade,
    ativo = EXCLUDED.ativo,
    ordem = EXCLUDED.ordem,
    tipo_modulo = EXCLUDED.tipo_modulo,
    metadata = COALESCE(public.module_catalog.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    is_capacity_module = EXCLUDED.is_capacity_module,
    categoria = EXCLUDED.categoria,
    texto_venda = EXCLUDED.texto_venda,
    updated_at = clock_timestamp();

INSERT INTO public.module_dependencies (module_id, required_module_id)
SELECT child.id, parent.id
FROM public.module_catalog AS child
CROSS JOIN public.module_catalog AS parent
WHERE parent.feature_key = 'gestao_materiais'
  AND child.feature_key IN (
    'controle_estoque',
    'checkin_checkout',
    'locacao_materiais',
    'manutencao_equipamentos',
    'etiquetas_materiais',
    'relatorios_materiais'
  )
ON CONFLICT (module_id, required_module_id) DO NOTHING;

INSERT INTO public.module_dependencies (module_id, required_module_id)
SELECT child.id, parent.id
FROM public.module_catalog AS child
CROSS JOIN public.module_catalog AS parent
WHERE child.feature_key = 'checkin_checkout'
  AND parent.feature_key = 'controle_estoque'
ON CONFLICT (module_id, required_module_id) DO NOTHING;

INSERT INTO public.module_dependencies (module_id, required_module_id)
SELECT child.id, parent.id
FROM public.module_catalog AS child
CROSS JOIN public.module_catalog AS parent
WHERE child.feature_key = 'locacao_materiais'
  AND parent.feature_key IN ('checkin_checkout', 'controle_estoque')
ON CONFLICT (module_id, required_module_id) DO NOTHING;
