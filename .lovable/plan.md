

# Backstage Pro – Sistema de Gestão de Eventos

## Visão Geral
Sistema completo de gestão de eventos para produtora de shows, com dois perfis de acesso (Admin e Usuário), seguindo o design industrial-chic definido no brief.

## Autenticação & Perfis
- Tela de login com email/senha, usando Supabase Auth
- Tabela `user_roles` com enum `admin` / `user` para controle de acesso seguro
- Tabela `profiles` (nome, email, avatar) vinculada a `auth.users`
- Redirecionamento pós-login baseado no perfil

## Estrutura de Navegação
- **Sidebar esquerda persistente** com logo e links:
  - Dashboard, Agenda, Financeiro (só Admin), Usuários (só Admin)
  - Botão de colapsar sidebar
- Links de Financeiro e Usuários ocultos para perfil Usuário

## Páginas

### 1. Dashboard
- Card hero "Próximo Evento" com countdown e dados principais
- Lista "Eventos da Semana" em cards horizontais
- Indicadores rápidos: total de eventos, eventos confirmados, pendentes

### 2. Agenda
- Tabela densa com colunas: Data, Status (badges coloridos: Confirmado/Pendente/Cancelado), Evento, Artista, Cidade, Local
- Filtros por artista, cidade, data e status
- Botão "Exportar Agenda em PDF" visível no topo
- Click na linha abre detalhe do evento

### 3. Criar/Editar Evento (Admin)
- Formulário em duas colunas:
  - **Coluna 1 – Info Principal:** data, status, nome, artista, cidade, local, horário do show
  - **Coluna 2 – Logística:** saída logística (data/hora), observações, lista de material
- Seção de upload de PDFs: rider técnico do artista + rider técnico do evento
- Validação com Zod + React Hook Form

### 4. Detalhe do Evento
- Todas as informações organizadas em cards
- Botões visíveis no topo: Baixar Rider Artista (PDF), Baixar Rider Evento (PDF), Exportar Evento em PDF
- Admin vê botões de Editar e Excluir

### 5. Financeiro (Admin only)
- Tabela com colunas: Evento, Cachê, Transporte, Alimentação, Hospedagem, Outros Custos, Lucro/Prejuízo
- Indicadores vermelho/verde para lucro e prejuízo
- Rodapé sticky com "Bottom Line" (totais gerais)
- Admin pode adicionar/editar dados financeiros por evento

### 6. Gerenciamento de Usuários (Admin only)
- Lista de usuários com nome, email e perfil
- Criar novo usuário, editar perfil, desativar conta

## Backend (Lovable Cloud / Supabase)

### Tabelas
- `profiles` (id, user_id FK, full_name, avatar_url)
- `user_roles` (id, user_id FK, role enum)
- `events` (id, date, status, name, artist, city, venue, show_time, logistics_departure, observations, material_list, created_by)
- `event_files` (id, event_id FK, file_type enum [artist_rider, event_rider], file_path)
- `financials` (id, event_id FK, cache, transport, food, lodging, other_costs, profit_loss)

### Storage
- Bucket `event-files` para PDFs dos riders

### RLS
- Todos podem ler eventos e arquivos
- Apenas admins podem criar/editar/excluir eventos e dados financeiros
- Função `has_role()` com SECURITY DEFINER para verificação segura

## Design
- Paleta: Rose #E11D48, Slate #F8FAFC, Navy #0F172A, Emerald #10B981
- Fontes: Montserrat (títulos) + Inter (corpo)
- Badges coloridos para status, transições rápidas (150ms), layout responsivo
- Cantos levemente arredondados, sem elementos "fofinhos"

## Geração de PDF
- Exportar agenda e eventos individuais em PDF usando biblioteca client-side (jsPDF)

