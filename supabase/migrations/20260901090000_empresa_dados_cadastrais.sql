-- ============================================================================
-- CONFIGURAÇÕES → EMPRESA: dados cadastrais da empresa (fonte única)
-- ============================================================================
--
-- A tela "Configurações → Empresa" passa a ser a fonte única dos dados
-- cadastrais da empresa atual, e a área de Documentos lê esses dados
-- diretamente (sem duplicar endereço/telefone/CNPJ em configs de Documentos,
-- sem snapshot histórico).
--
-- `public.empresas` já tem `nome_empresa`, `email`, `telefone`, `cpf_cnpj`
-- (CHECK 11/14 dígitos + índice único GLOBAL, ver 20260818160000) e
-- `logo_url`. Faltam apenas os campos de razão social / contato / endereço.
-- Esta migration é ADITIVA: só ADD COLUMN IF NOT EXISTS. Nada é removido ou
-- renomeado.
--
-- Sem tabela nova, sem policy nova, sem RPC:
--   * A RLS de `public.empresas` já permite `admin_empresa` atualizar a
--     PRÓPRIA empresa ("Admin empresa update own empresa", 20260414153855,
--     escopo `id = get_user_empresa_id(auth.uid())`).
--   * O trigger `protect_company_subscription_fields` (20260729213000) já
--     bloqueia o cliente comum de mexer nos campos de assinatura
--     (plano*/trial*/vencimento/status/status_pagamento/precisa_escolher_plano/
--     data_contrato). As colunas abaixo são cadastrais e NÃO entram nessa
--     lista de campos sensíveis, então o admin edita só elas.
--
-- Sem CHECK novo: segue a convenção das colunas `email`/`telefone` (sem
-- constraint); a normalização leve (dígitos em cep, UF em maiúsculo) é feita
-- no cliente. `nome_empresa` continua sendo o "Nome da empresa / Nome
-- fantasia" usado em todo o app; só `razao_social` é adicionado como nome
-- (não se cria `nome_fantasia`).

ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS razao_social text;
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS cep text;
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS endereco text;
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS numero text;
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS complemento text;
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS bairro text;
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS cidade text;
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS estado text;

COMMENT ON COLUMN public.empresas.razao_social IS
  'Razão social da empresa (opcional). Nome fantasia / nome de exibição continua em nome_empresa.';
COMMENT ON COLUMN public.empresas.whatsapp IS
  'WhatsApp de contato da empresa (opcional, texto livre).';
COMMENT ON COLUMN public.empresas.cep IS
  'CEP do endereço da empresa (opcional). Armazenado só com dígitos pelo cliente.';
COMMENT ON COLUMN public.empresas.endereco IS
  'Logradouro do endereço da empresa (opcional).';
COMMENT ON COLUMN public.empresas.numero IS
  'Número do endereço da empresa (opcional, texto).';
COMMENT ON COLUMN public.empresas.complemento IS
  'Complemento do endereço da empresa (opcional).';
COMMENT ON COLUMN public.empresas.bairro IS
  'Bairro do endereço da empresa (opcional).';
COMMENT ON COLUMN public.empresas.cidade IS
  'Cidade do endereço da empresa (opcional).';
COMMENT ON COLUMN public.empresas.estado IS
  'UF do endereço da empresa (opcional, 2 letras maiúsculas normalizadas no cliente).';
