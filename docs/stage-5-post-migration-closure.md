# ETAPA 5 — VALIDAÇÃO PÓS-MIGRATION E FECHAMENTO

## Resultado executivo

A migration `20260802230000_equipment_maintenance_stage_five.sql` foi aplicada
com sucesso ao projeto Supabase vinculado. O histórico local e remoto está
sincronizado, o dry-run posterior está vazio, o schema remoto corresponde aos
objetos validados localmente e a regressão da aplicação foi aprovada.

**Conclusão:** a Etapa 5 pode ser declarada tecnicamente concluída.

## 1. Migration aplicada

- Arquivo: `supabase/migrations/20260802230000_equipment_maintenance_stage_five.sql`.
- Aplicação: `supabase db push --linked --yes`.
- Resultado do CLI: somente a migration `20260802230000` foi aplicada.
- Não houve reaplicação de migrations antigas, alteração manual de dados,
  correção direta no banco ou criação de registros fictícios permanentes.

## 2. Data e hora

- Aplicação iniciada em **2026-08-03 00:10:27 -03:00**.
- Fuso de referência: America/Sao_Paulo.

## 3. SHA-256

- SHA-256 da migration aplicada:
  `78150576AADB94DAED4872B650EFBEB5FCC43F724AFE13A197FF7A53E69325B5`.
- O hash foi calculado antes do dry-run, reconfirmado imediatamente antes do
  deploy e corresponde ao arquivo submetido aos testes locais finais.

## 4. Sincronização local/remoto

- Antes do deploy, `migration list --linked` mostrou todas as versões até
  `20260802200000` sincronizadas e somente `20260802230000` pendente.
- O dry-run prévio listou exclusivamente
  `20260802230000_equipment_maintenance_stage_five.sql`.
- Depois do deploy, a versão `20260802230000` aparece nos lados local e remoto.
- O dry-run final retornou `upToDate: true` e lista de migrations vazia.

## 5. Backup e pré-validação

- Branch pré-deploy: `main`.
- HEAD pré-deploy confirmado:
  `93a1a163f5a6122d627a3507f7e86f7fd54c8b23`.
- Estado pré-deploy: três commits à frente de `origin/main` e alterações
  restritas à Etapa 5.
- `git diff --check`: aprovado.
- Migrations antigas rastreadas: nenhuma modificação.
- Varredura de secrets: somente referências literais a roles nos `REVOKE` e na
  documentação; nenhum secret, token, senha, URL autenticada ou chave privada.
- Arquivos temporários: nenhum artefato da auditoria foi mantido no worktree.
- Backup físico gerenciado mais recente disponível: status `COMPLETED`, ID
  `1271065254`, criado em `2026-08-02T09:39:36.054Z`.
- PITR: não habilitado no projeto.
- O dump adicional por `supabase db dump` foi tentado, mas não pôde ser gerado
  porque o Docker Desktop não estava ativo. A proteção disponível foi o backup
  físico gerenciado, somada à atomicidade transacional e à cadeia integral de
  migrations. Essa limitação permanece registrada como risco operacional.

## 6. Schema remoto

A auditoria somente leitura dos catálogos confirmou:

- quatro tabelas canônicas com RLS:
  `manutencao_ordens`, `manutencao_ordem_eventos`,
  `manutencao_ordem_insumos` e `manutencao_equipamento_numeradores`;
- seis enums de tipo, status, prioridade, origem, modalidade de execução e tipo
  de evento;
- 17 índices, incluindo unicidade parcial de manutenção ativa individual;
- 38 constraints no domínio auditado, incluindo FKs multiempresa, checks de
  custos, quantidade, origem e datas/status;
- quatro triggers da Etapa 5;
- 22 funções novas ou canonicamente substituídas auditadas;
- 11 RPCs públicas de manutenção com grants válidos.

## 7. RLS e grants

- RLS está habilitado nas quatro tabelas.
- As três projeções consultáveis possuem policy `SELECT` para `authenticated`
  baseada em `can_read_company_module`.
- A tabela interna de numeração não concede `SELECT` a `authenticated`.
- `authenticated` não possui `INSERT`, `UPDATE` ou `DELETE` direto nas
  projeções; as mutações passam pelas RPCs.
- As 11 RPCs públicas concedem `EXECUTE` somente a `authenticated`, sem acesso
  para `anon` ou `service_role`.
- Nenhum helper interno auditado possui `EXECUTE` para `anon`, `authenticated`
  ou `service_role`.
- Todas as 22 funções `SECURITY DEFINER` auditadas têm
  `search_path = pg_catalog, public`; nenhuma configuração insegura foi
  encontrada.

## 8. Multiempresa e perfis de acesso

- Todas as quatro tabelas possuem `empresa_id`.
- Material, ordem, insumo e evento de Check-in usam FKs compostas com
  `empresa_id`, bloqueando referências cruzadas entre empresas.
- O resolver canônico usa `is_master_admin`, `get_user_empresa_id`,
  `company_has_active_module`, `company_has_operational_access`,
  `can_read_company_module` e `can_write_company_module`.
- O pgTAP local validou usuário comum, administrador, Master, empresa somente
  leitura, empresa inativa, módulo desativado, ausência de entitlement e licença
  Vitalícia.
- Smoke remoto sem identidade: `auth.uid()` nulo e zero linhas visíveis nas
  três projeções públicas por RLS.
- E2E manual autenticado remoto: **pendente**.

## 9. Máquina de estados

Estados remotos confirmados: `aberta`, `aguardando_analise`, `em_manutencao`,
`aguardando_peca`, `concluida` e `cancelada`.

As transições são validadas por
`equipment_maintenance_transition_allowed` e executadas por
`transicionar_ordem_manutencao`; atualizações diretas são bloqueadas. Estados
terminais não aceitam novas transições, e as constraints mantêm coerência entre
status e datas de início, conclusão e cancelamento.

## 10. Manutenção preventiva

- Preventiva é baseada em data.
- A ordem aceita `intervalo_preventivo_dias` entre 1 e 3650 dias.
- `proxima_preventiva_em` é persistida e indexada para ordens concluídas.
- Não foram criadas horas, ciclos, telemetria ou medidores inexistentes.

## 11. Integração com Materiais

- A ordem referencia exclusivamente `materiais` por FK composta multiempresa.
- O detalhe do material consulta resumo de manutenção ativa, histórico, próxima
  preventiva e custo acumulado.
- Não existe cadastro paralelo de equipamentos nem duplicação de
  `status_operacional` como fonte da manutenção ativa.
- Dependência obrigatória confirmada no remoto:
  `manutencao_equipamentos → gestao_materiais`.
- O módulo possui exatamente uma dependência obrigatória.

## 12. Integração com Check-in / Check-out

- `controle_estoque` e `checkin_checkout` permanecem integrações opcionais;
  nenhuma dependência obrigatória artificial foi criada.
- Origem `checkin` exige `custodia_evento_origem_id` e FK composta para o evento
  da mesma empresa.
- A interface apresenta a ação explícita `Abrir ordem de manutenção` após
  condição compatível, pré-preenchendo material, condição, observação e evento.
- Não existe criação automática silenciosa.
- Custódia, evento físico e histórico de Check-in não são duplicados.
- O trigger `material_custody_maintenance_guard` bloqueia Check-out incompatível
  e usa o lock operacional compartilhado.

## 13. Integração com Locação

- A Etapa 4 continua usando `material_rental_availability` como motor canônico.
- A função foi estendida para descontar
  `equipment_active_maintenance_quantity`.
- `buscar_materiais_disponiveis_locacao` consome essa mesma função.
- A decisão permanece no backend; não há tabela paralela de reservas, segundo
  motor de disponibilidade ou regra exclusiva no frontend.

## 14. Disponibilidade operacional

- Status ativos: `aberta`, `aguardando_analise`, `em_manutencao` e
  `aguardando_peca`.
- Equipamento individual ativo fica indisponível para nova locação conflitante e
  novo Check-out.
- Conclusão ou cancelamento remove a ordem do conjunto ativo e libera a
  disponibilidade.
- A unicidade parcial impede duas manutenções ativas para o mesmo material
  individual.
- Para material quantitativo, a disponibilidade de locação desconta somente a
  soma de `quantidade_afetada`.
- No Check-out quantitativo, o movimento de saída e o trigger ocorrem na mesma
  transação; a operação é revertida se o saldo restante ficar abaixo da
  quantidade em manutenção.
- Não foi criada serialização artificial de materiais quantitativos.

## 15. Integração com Estoque

- Manutenção não escreve em `estoque_saldos` nem em
  `estoque_movimentacoes`.
- `estoque_saldos` continua sendo a fonte oficial do saldo.
- `estoque_movimentacoes` continua sendo o ledger oficial.
- `materiais.quantidade` continua sendo somente projeção.
- Abertura de manutenção representa indisponibilidade operacional, não saída
  física automática.
- Não existe saldo ou ledger paralelo de manutenção.

## 16. Custos

- Custos de mão de obra, peças e outros são não negativos.
- `custo_total` é coluna gerada pela soma dos componentes.
- Insumos permitem descrição, quantidade, unidade, custo unitário e material
  canônico opcional.
- Registrar insumo não cria movimentação artificial de estoque.
- Não há escrita financeira, conta a pagar ou lançamento automático.

## 17. Histórico

- Eventos cobrem criação, edição, mudança de status, diagnóstico, início,
  conclusão, cancelamento e inclusão/remoção lógica de insumos.
- `manutencao_eventos_history_guard` bloqueia `UPDATE` e `DELETE`.
- As projeções também são protegidas contra mutação fora das operações
  canônicas.
- Cancelamento preserva a ordem e o histórico; não apaga dados.

## 18. Concorrência e idempotência

Evidência local em PostgreSQL 16.14 preservada:

1. duas sessões abrindo manutenção ativa para o mesmo equipamento;
2. abertura concorrente com reserva;
3. abertura concorrente com Check-out;
4. conclusão e cancelamento simultâneos.

Todos os cenários mantiveram consistência. O remoto foi validado estaticamente,
sem repetir testes destrutivos: índice único parcial, `client_uuid` único,
`payload_hash`, locks de material para locação/operação, locks de ordem e
transições condicionais correspondem à migration testada localmente.

## 19. Testes e regressão

- PostgreSQL 16.14 local: replay limpo aprovado.
- Rollback: aprovado.
- Atomicidade forçada: aprovada.
- pgTAP: **65/65** testes aprovados.
- Concorrência real: quatro cenários aprovados.
- Vitest: **43/43 arquivos**, **296/296 testes**.
- `npx tsc --noEmit`: aprovado após regeneração dos tipos.
- `npm run build`: aprovado.
- ESLint direcionado aos arquivos da Etapa 5 e tipos gerados: aprovado.
- `git diff --check`: aprovado.
- Supabase lint remoto com `--fail-on error`: aprovado, sem erros.
- O lint reporta avisos `STABLE/VOLATILE` no backlog existente e em RPCs de
  leitura que chamam resolvers canônicos; não houve erro de schema. A
  classificação de volatilidade fica documentada e não foi corrigida
  diretamente no banco após a aplicação.
- Build mantém avisos não bloqueantes já conhecidos de tamanho de chunk,
  externalização de `buffer` e importação estática/dinâmica de PDF.

## 20. Tipos Supabase

- `src/integrations/supabase/types.ts` foi regenerado oficialmente pelo CLI com
  `supabase gen types --linked --lang typescript --schema public`.
- O arquivo inclui tabelas, enums e RPCs da Etapa 5 e também atualiza a defasagem
  acumulada do schema remoto das etapas anteriores.
- Diferença contra o arquivo anterior: 730 linhas adicionadas e uma removida.
- SHA-256 do arquivo gerado:
  `0083A543E12ABF7C93FBBCA6C34831AF1306AD723FF095DC04F8BDA715907A68`.
- Não houve edição manual do conteúdo gerado.

## 21. Limitações

- E2E manual autenticado remoto permanece pendente.
- Preventiva trabalha apenas com datas; não há horas, ciclos ou telemetria.
- Fornecedor externo permanece como campo textual extensível porque não há
  domínio canônico apropriado para reutilizar.
- Insumos cadastrados não movimentam estoque automaticamente nesta etapa.
- Integração financeira permanece futura.
- RBAC granular de funcionários não faz parte da Etapa 5.

## 22. Riscos

- PITR não está habilitado e o backup físico gerenciado disponível antecede o
  deploy; o dump adicional não foi produzido por ausência do Docker Desktop.
- Avisos de volatilidade do Supabase lint permanecem não bloqueantes e devem ser
  tratados em manutenção técnica dedicada, sem reescrever migration aplicada.
- O smoke remoto validou catálogos, grants e RLS sem identidade, mas não substitui
  uma sessão E2E autenticada real.
- A disponibilidade quantitativa é agregada por material, coerente com a
  arquitetura atual; não identifica unidades inexistentes.

## 23. Dívidas restantes

- E2E manual autenticado remoto.
- Reconciliação nominal de estoque legado.
- Backlog de warnings `STABLE/VOLATILE`.
- Erros globais de lint preexistentes fora do escopo.
- RBAC granular de funcionários.

Nenhuma dessas dívidas foi misturada ao fechamento da Etapa 5. Não houve push,
tag, release nem início da Etapa 6.
