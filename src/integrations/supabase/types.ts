export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      asaas_payments: {
        Row: {
          activation_completed_at: string | null
          activation_status: string
          amount: number
          asaas_customer_id: string | null
          asaas_payment_id: string | null
          created_at: string
          due_date: string | null
          empresa_id: string
          id: string
          invoice_url: string | null
          last_webhook_event_id: string | null
          metadata: Json | null
          payment_confirmed_at: string | null
          payment_method: string | null
          payment_type: string
          pix_copy_paste: string | null
          pix_qr_code: string | null
          related_batch_request_id: string | null
          related_module_id: string | null
          related_plano_id: string | null
          source_app: string
          status: string
          updated_at: string
        }
        Insert: {
          activation_completed_at?: string | null
          activation_status?: string
          amount?: number
          asaas_customer_id?: string | null
          asaas_payment_id?: string | null
          created_at?: string
          due_date?: string | null
          empresa_id: string
          id?: string
          invoice_url?: string | null
          last_webhook_event_id?: string | null
          metadata?: Json | null
          payment_confirmed_at?: string | null
          payment_method?: string | null
          payment_type: string
          pix_copy_paste?: string | null
          pix_qr_code?: string | null
          related_batch_request_id?: string | null
          related_module_id?: string | null
          related_plano_id?: string | null
          source_app?: string
          status?: string
          updated_at?: string
        }
        Update: {
          activation_completed_at?: string | null
          activation_status?: string
          amount?: number
          asaas_customer_id?: string | null
          asaas_payment_id?: string | null
          created_at?: string
          due_date?: string | null
          empresa_id?: string
          id?: string
          invoice_url?: string | null
          last_webhook_event_id?: string | null
          metadata?: Json | null
          payment_confirmed_at?: string | null
          payment_method?: string | null
          payment_type?: string
          pix_copy_paste?: string | null
          pix_qr_code?: string | null
          related_batch_request_id?: string | null
          related_module_id?: string | null
          related_plano_id?: string | null
          source_app?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asaas_payments_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asaas_payments_related_batch_request_id_fkey"
            columns: ["related_batch_request_id"]
            isOneToOne: false
            referencedRelation: "module_batch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asaas_payments_related_module_id_fkey"
            columns: ["related_module_id"]
            isOneToOne: false
            referencedRelation: "module_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asaas_payments_related_plano_id_fkey"
            columns: ["related_plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      asaas_webhook_events: {
        Row: {
          asaas_payment_id: string
          event_type: string
          id: string
          internal_payment_id: string
          processed_at: string
          provider_amount: number
          result: string
        }
        Insert: {
          asaas_payment_id: string
          event_type: string
          id: string
          internal_payment_id: string
          processed_at?: string
          provider_amount: number
          result: string
        }
        Update: {
          asaas_payment_id?: string
          event_type?: string
          id?: string
          internal_payment_id?: string
          processed_at?: string
          provider_amount?: number
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "asaas_webhook_events_internal_payment_id_fkey"
            columns: ["internal_payment_id"]
            isOneToOne: false
            referencedRelation: "asaas_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      backups: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          nome: string
          payload: Json
          periodo_fim: string | null
          periodo_inicio: string | null
          tipo: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          nome: string
          payload?: Json
          periodo_fim?: string | null
          periodo_inicio?: string | null
          tipo?: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          nome?: string
          payload?: Json
          periodo_fim?: string | null
          periodo_inicio?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "backups_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_materiais: {
        Row: {
          ativo: boolean
          created_at: string
          created_by: string | null
          descricao: string | null
          empresa_id: string
          id: string
          nome: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id: string
          id?: string
          nome: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorias_materiais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          ativo: boolean
          cpf_cnpj: string | null
          created_at: string
          created_by: string
          email: string | null
          empresa_id: string
          id: string
          nome: string
          nome_fantasia: string | null
          observacoes: string | null
          telefone: string | null
          tipo_pessoa: Database["public"]["Enums"]["customer_person_type"]
          updated_at: string
          updated_by: string
        }
        Insert: {
          ativo?: boolean
          cpf_cnpj?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          empresa_id: string
          id?: string
          nome: string
          nome_fantasia?: string | null
          observacoes?: string | null
          telefone?: string | null
          tipo_pessoa: Database["public"]["Enums"]["customer_person_type"]
          updated_at?: string
          updated_by: string
        }
        Update: {
          ativo?: boolean
          cpf_cnpj?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          nome_fantasia?: string | null
          observacoes?: string | null
          telefone?: string | null
          tipo_pessoa?: Database["public"]["Enums"]["customer_person_type"]
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          ativo: boolean
          conteudo: string
          created_at: string
          empresa_id: string
          id: string
          nome: string
          tipo: string
          updated_at: string
          variaveis: Json
        }
        Insert: {
          ativo?: boolean
          conteudo?: string
          created_at?: string
          empresa_id: string
          id?: string
          nome: string
          tipo?: string
          updated_at?: string
          variaveis?: Json
        }
        Update: {
          ativo?: boolean
          conteudo?: string
          created_at?: string
          empresa_id?: string
          id?: string
          nome?: string
          tipo?: string
          updated_at?: string
          variaveis?: Json
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_impressora_config: {
        Row: {
          altura_mm: number | null
          ativo: boolean
          configuracoes: Json
          created_at: string
          created_by: string | null
          empresa_id: string
          finalidade: string
          formato: string | null
          id: string
          largura_mm: number | null
          nome_impressora: string | null
          orientacao: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          altura_mm?: number | null
          ativo?: boolean
          configuracoes?: Json
          created_at?: string
          created_by?: string | null
          empresa_id: string
          finalidade: string
          formato?: string | null
          id?: string
          largura_mm?: number | null
          nome_impressora?: string | null
          orientacao?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          altura_mm?: number | null
          ativo?: boolean
          configuracoes?: Json
          created_at?: string
          created_by?: string | null
          empresa_id?: string
          finalidade?: string
          formato?: string | null
          id?: string
          largura_mm?: number | null
          nome_impressora?: string | null
          orientacao?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresa_impressora_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_modules: {
        Row: {
          activated_at: string | null
          created_at: string
          empresa_id: string
          expires_at: string | null
          granted_by_admin: boolean
          id: string
          module_id: string
          origem: string
          status: string
          trial_granted: boolean
          updated_at: string
          valor_cobrado: number
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          empresa_id: string
          expires_at?: string | null
          granted_by_admin?: boolean
          id?: string
          module_id: string
          origem?: string
          status?: string
          trial_granted?: boolean
          updated_at?: string
          valor_cobrado?: number
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          empresa_id?: string
          expires_at?: string | null
          granted_by_admin?: boolean
          id?: string
          module_id?: string
          origem?: string
          status?: string
          trial_granted?: boolean
          updated_at?: string
          valor_cobrado?: number
        }
        Relationships: [
          {
            foreignKeyName: "empresa_modules_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_modules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "module_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_usuarios: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          perfil: string
          user_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          perfil?: string
          user_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          perfil?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_usuarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_usuarios_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      empresas: {
        Row: {
          cpf_cnpj: string | null
          created_at: string
          data_contrato: string | null
          email: string | null
          id: string
          logo_url: string | null
          nome_empresa: string
          plano: string | null
          plano_bloqueado: boolean
          plano_id: string | null
          precisa_escolher_plano: boolean
          status: string | null
          status_pagamento: string | null
          telefone: string | null
          trial_consumed_at: string | null
          trial_expires_at: string | null
          trial_started_at: string | null
          vencimento: string | null
        }
        Insert: {
          cpf_cnpj?: string | null
          created_at?: string
          data_contrato?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          nome_empresa: string
          plano?: string | null
          plano_bloqueado?: boolean
          plano_id?: string | null
          precisa_escolher_plano?: boolean
          status?: string | null
          status_pagamento?: string | null
          telefone?: string | null
          trial_consumed_at?: string | null
          trial_expires_at?: string | null
          trial_started_at?: string | null
          vencimento?: string | null
        }
        Update: {
          cpf_cnpj?: string | null
          created_at?: string
          data_contrato?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          nome_empresa?: string
          plano?: string | null
          plano_bloqueado?: boolean
          plano_id?: string | null
          precisa_escolher_plano?: boolean
          status?: string | null
          status_pagamento?: string | null
          telefone?: string | null
          trial_consumed_at?: string | null
          trial_expires_at?: string | null
          trial_started_at?: string | null
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresas_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_localizacoes: {
        Row: {
          ativa: boolean
          codigo: string
          created_at: string
          created_by: string | null
          descricao: string | null
          empresa_id: string
          id: string
          localizacao_pai_id: string | null
          nome: string
          tipo: Database["public"]["Enums"]["estoque_localizacao_tipo"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativa?: boolean
          codigo: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id: string
          id?: string
          localizacao_pai_id?: string | null
          nome: string
          tipo?: Database["public"]["Enums"]["estoque_localizacao_tipo"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativa?: boolean
          codigo?: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id?: string
          id?: string
          localizacao_pai_id?: string | null
          nome?: string
          tipo?: Database["public"]["Enums"]["estoque_localizacao_tipo"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_localizacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_localizacoes_parent_fkey"
            columns: ["empresa_id", "localizacao_pai_id"]
            isOneToOne: false
            referencedRelation: "estoque_localizacoes"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      estoque_movimentacoes: {
        Row: {
          client_uuid: string
          created_at: string
          created_by: string
          data_efetiva: string
          documento_referencia: string | null
          empresa_id: string
          id: string
          justificativa: string | null
          localizacao_destino_id: string | null
          localizacao_origem_id: string | null
          material_id: string
          motivo: string | null
          movimentacao_estornada_id: string | null
          observacao: string | null
          origem_id: string | null
          origem_modulo: Database["public"]["Enums"]["estoque_origem_modulo"]
          payload_hash: string
          quantidade: number
          saldo_destino_anterior: number | null
          saldo_destino_posterior: number | null
          saldo_origem_anterior: number | null
          saldo_origem_posterior: number | null
          saldo_total_anterior: number
          saldo_total_posterior: number
          tipo_movimentacao: Database["public"]["Enums"]["estoque_movimentacao_tipo"]
        }
        Insert: {
          client_uuid: string
          created_at?: string
          created_by: string
          data_efetiva?: string
          documento_referencia?: string | null
          empresa_id: string
          id?: string
          justificativa?: string | null
          localizacao_destino_id?: string | null
          localizacao_origem_id?: string | null
          material_id: string
          motivo?: string | null
          movimentacao_estornada_id?: string | null
          observacao?: string | null
          origem_id?: string | null
          origem_modulo?: Database["public"]["Enums"]["estoque_origem_modulo"]
          payload_hash: string
          quantidade: number
          saldo_destino_anterior?: number | null
          saldo_destino_posterior?: number | null
          saldo_origem_anterior?: number | null
          saldo_origem_posterior?: number | null
          saldo_total_anterior: number
          saldo_total_posterior: number
          tipo_movimentacao: Database["public"]["Enums"]["estoque_movimentacao_tipo"]
        }
        Update: {
          client_uuid?: string
          created_at?: string
          created_by?: string
          data_efetiva?: string
          documento_referencia?: string | null
          empresa_id?: string
          id?: string
          justificativa?: string | null
          localizacao_destino_id?: string | null
          localizacao_origem_id?: string | null
          material_id?: string
          motivo?: string | null
          movimentacao_estornada_id?: string | null
          observacao?: string | null
          origem_id?: string | null
          origem_modulo?: Database["public"]["Enums"]["estoque_origem_modulo"]
          payload_hash?: string
          quantidade?: number
          saldo_destino_anterior?: number | null
          saldo_destino_posterior?: number | null
          saldo_origem_anterior?: number | null
          saldo_origem_posterior?: number | null
          saldo_total_anterior?: number
          saldo_total_posterior?: number
          tipo_movimentacao?: Database["public"]["Enums"]["estoque_movimentacao_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "estoque_movimentacoes_empresa_destino_fkey"
            columns: ["empresa_id", "localizacao_destino_id"]
            isOneToOne: false
            referencedRelation: "estoque_localizacoes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_empresa_origem_fkey"
            columns: ["empresa_id", "localizacao_origem_id"]
            isOneToOne: false
            referencedRelation: "estoque_localizacoes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_estornada_fkey"
            columns: ["empresa_id", "material_id", "movimentacao_estornada_id"]
            isOneToOne: false
            referencedRelation: "estoque_movimentacoes"
            referencedColumns: ["empresa_id", "material_id", "id"]
          },
        ]
      }
      estoque_saldos: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          localizacao_id: string
          material_id: string
          quantidade: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          localizacao_id: string
          material_id: string
          quantidade?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          localizacao_id?: string
          material_id?: string
          quantidade?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estoque_saldos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_saldos_empresa_localizacao_fkey"
            columns: ["empresa_id", "localizacao_id"]
            isOneToOne: false
            referencedRelation: "estoque_localizacoes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "estoque_saldos_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "estoque_saldos_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "estoque_saldos_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      etiqueta_impressoes: {
        Row: {
          client_uuid: string
          empresa_id: string
          id: string
          material_id: string
          material_snapshot: Json
          modelo_id: string | null
          modelo_snapshot: Json
          payload_hash: string
          quantidade: number
          reimpressao_de_id: string | null
          solicitada_em: string
          solicitada_por: string
          solicitante_nome: string
        }
        Insert: {
          client_uuid: string
          empresa_id: string
          id?: string
          material_id: string
          material_snapshot: Json
          modelo_id?: string | null
          modelo_snapshot: Json
          payload_hash: string
          quantidade: number
          reimpressao_de_id?: string | null
          solicitada_em?: string
          solicitada_por: string
          solicitante_nome: string
        }
        Update: {
          client_uuid?: string
          empresa_id?: string
          id?: string
          material_id?: string
          material_snapshot?: Json
          modelo_id?: string | null
          modelo_snapshot?: Json
          payload_hash?: string
          quantidade?: number
          reimpressao_de_id?: string | null
          solicitada_em?: string
          solicitada_por?: string
          solicitante_nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "etiqueta_impressoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etiqueta_impressoes_material_company_fk"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "etiqueta_impressoes_material_company_fk"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "etiqueta_impressoes_material_company_fk"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "etiqueta_impressoes_modelo_company_fk"
            columns: ["empresa_id", "modelo_id"]
            isOneToOne: false
            referencedRelation: "etiqueta_modelos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "etiqueta_impressoes_reprint_company_fk"
            columns: ["empresa_id", "reimpressao_de_id"]
            isOneToOne: false
            referencedRelation: "etiqueta_impressoes"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      etiqueta_modelos: {
        Row: {
          altura_mm: number
          ativo: boolean
          campos: Json
          created_at: string
          created_by: string | null
          descricao: string | null
          empresa_id: string
          espacamento_interno_mm: number
          id: string
          largura_mm: number
          margem_interna_mm: number
          mostrar_borda: boolean
          nome: string
          padrao: boolean
          tamanho_fonte: number
          tipo_identificacao: Database["public"]["Enums"]["material_identification_type"]
          updated_at: string
          updated_by: string | null
          versao: number
        }
        Insert: {
          altura_mm: number
          ativo?: boolean
          campos?: Json
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id: string
          espacamento_interno_mm?: number
          id?: string
          largura_mm: number
          margem_interna_mm?: number
          mostrar_borda?: boolean
          nome: string
          padrao?: boolean
          tamanho_fonte?: number
          tipo_identificacao?: Database["public"]["Enums"]["material_identification_type"]
          updated_at?: string
          updated_by?: string | null
          versao?: number
        }
        Update: {
          altura_mm?: number
          ativo?: boolean
          campos?: Json
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id?: string
          espacamento_interno_mm?: number
          id?: string
          largura_mm?: number
          margem_interna_mm?: number
          mostrar_borda?: boolean
          nome?: string
          padrao?: boolean
          tamanho_fonte?: number
          tipo_identificacao?: Database["public"]["Enums"]["material_identification_type"]
          updated_at?: string
          updated_by?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "etiqueta_modelos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      etiqueta_solicitacao_itens: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          material_id: string
          material_snapshot: Json
          ordem: number
          quantidade: number
          solicitacao_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          material_id: string
          material_snapshot: Json
          ordem: number
          quantidade: number
          solicitacao_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          material_id?: string
          material_snapshot?: Json
          ordem?: number
          quantidade?: number
          solicitacao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "etiqueta_solicitacao_itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etiqueta_solicitacao_itens_material_company_fk"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "etiqueta_solicitacao_itens_material_company_fk"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "etiqueta_solicitacao_itens_material_company_fk"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "etiqueta_solicitacao_itens_request_company_fk"
            columns: ["empresa_id", "solicitacao_id"]
            isOneToOne: false
            referencedRelation: "etiqueta_solicitacoes"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      etiqueta_solicitacoes: {
        Row: {
          client_uuid: string
          empresa_id: string
          id: string
          modelo_id: string | null
          modelo_snapshot: Json
          origem: string
          payload_hash: string
          quantidade_etiquetas: number
          quantidade_materiais: number
          reimpressao_de_id: string | null
          solicitada_em: string
          solicitada_por: string
          solicitante_nome: string
        }
        Insert: {
          client_uuid: string
          empresa_id: string
          id?: string
          modelo_id?: string | null
          modelo_snapshot: Json
          origem?: string
          payload_hash: string
          quantidade_etiquetas: number
          quantidade_materiais: number
          reimpressao_de_id?: string | null
          solicitada_em?: string
          solicitada_por: string
          solicitante_nome: string
        }
        Update: {
          client_uuid?: string
          empresa_id?: string
          id?: string
          modelo_id?: string | null
          modelo_snapshot?: Json
          origem?: string
          payload_hash?: string
          quantidade_etiquetas?: number
          quantidade_materiais?: number
          reimpressao_de_id?: string | null
          solicitada_em?: string
          solicitada_por?: string
          solicitante_nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "etiqueta_solicitacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etiqueta_solicitacoes_modelo_company_fk"
            columns: ["empresa_id", "modelo_id"]
            isOneToOne: false
            referencedRelation: "etiqueta_modelos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "etiqueta_solicitacoes_reprint_company_fk"
            columns: ["empresa_id", "reimpressao_de_id"]
            isOneToOne: false
            referencedRelation: "etiqueta_solicitacoes"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      event_checklist_items: {
        Row: {
          categoria: string
          concluido: boolean
          created_at: string
          descricao: string
          empresa_id: string
          event_id: string
          id: string
          observacao: string | null
          ordem: number
          updated_at: string
        }
        Insert: {
          categoria?: string
          concluido?: boolean
          created_at?: string
          descricao: string
          empresa_id: string
          event_id: string
          id?: string
          observacao?: string | null
          ordem?: number
          updated_at?: string
        }
        Update: {
          categoria?: string
          concluido?: boolean
          created_at?: string
          descricao?: string
          empresa_id?: string
          event_id?: string
          id?: string
          observacao?: string | null
          ordem?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_checklist_items_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_checklist_items_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_days: {
        Row: {
          artist: string | null
          created_at: string
          date: string | null
          day_number: number
          empresa_id: string | null
          event_id: string
          id: string
          observations: string | null
          show_time: string | null
          updated_at: string
        }
        Insert: {
          artist?: string | null
          created_at?: string
          date?: string | null
          day_number: number
          empresa_id?: string | null
          event_id: string
          id?: string
          observations?: string | null
          show_time?: string | null
          updated_at?: string
        }
        Update: {
          artist?: string | null
          created_at?: string
          date?: string | null
          day_number?: number
          empresa_id?: string | null
          event_id?: string
          id?: string
          observations?: string | null
          show_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_days_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_days_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_files: {
        Row: {
          created_at: string
          empresa_id: string | null
          event_day_id: string | null
          event_id: string
          file_name: string
          file_path: string
          file_type: Database["public"]["Enums"]["file_type"]
          id: string
        }
        Insert: {
          created_at?: string
          empresa_id?: string | null
          event_day_id?: string | null
          event_id: string
          file_name: string
          file_path: string
          file_type: Database["public"]["Enums"]["file_type"]
          id?: string
        }
        Update: {
          created_at?: string
          empresa_id?: string | null
          event_day_id?: string | null
          event_id?: string
          file_name?: string
          file_path?: string
          file_type?: Database["public"]["Enums"]["file_type"]
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_files_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_files_event_day_id_fkey"
            columns: ["event_day_id"]
            isOneToOne: false
            referencedRelation: "event_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_files_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_funcionarios: {
        Row: {
          created_at: string
          empresa_id: string | null
          event_id: string
          funcionario_id: string
          id: string
        }
        Insert: {
          created_at?: string
          empresa_id?: string | null
          event_id: string
          funcionario_id: string
          id?: string
        }
        Update: {
          created_at?: string
          empresa_id?: string | null
          event_id?: string
          funcionario_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_funcionarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_funcionarios_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_funcionarios_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          artist: string | null
          city: string | null
          contratante_cidade: string | null
          contratante_nome: string | null
          contratante_telefone: string | null
          created_at: string
          created_by: string | null
          date: string
          empresa_id: string | null
          id: string
          logistics_departure: string | null
          material_list: string | null
          name: string
          num_days: number
          observations: string | null
          setup_time: string | null
          show_time: string | null
          staff_notes: string | null
          state: string | null
          status: Database["public"]["Enums"]["event_status"]
          updated_at: string
          venue: string | null
        }
        Insert: {
          artist?: string | null
          city?: string | null
          contratante_cidade?: string | null
          contratante_nome?: string | null
          contratante_telefone?: string | null
          created_at?: string
          created_by?: string | null
          date: string
          empresa_id?: string | null
          id?: string
          logistics_departure?: string | null
          material_list?: string | null
          name: string
          num_days?: number
          observations?: string | null
          setup_time?: string | null
          show_time?: string | null
          staff_notes?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          updated_at?: string
          venue?: string | null
        }
        Update: {
          artist?: string | null
          city?: string | null
          contratante_cidade?: string | null
          contratante_nome?: string | null
          contratante_telefone?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          empresa_id?: string | null
          id?: string
          logistics_departure?: string | null
          material_list?: string | null
          name?: string
          num_days?: number
          observations?: string | null
          setup_time?: string | null
          show_time?: string | null
          staff_notes?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      financeiro_lancamentos: {
        Row: {
          cliente_id: string | null
          created_at: string
          created_by: string | null
          descricao: string | null
          empresa_id: string
          forma_cobranca: string
          forma_pagamento: string | null
          id: string
          observacoes: string | null
          origem_id: string
          origem_tipo: string
          status: string
          tipo: string
          updated_at: string
          updated_by: string | null
          valor_estornado: number
          valor_original: number
          valor_recebido: number
          vencimento: string | null
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id: string
          forma_cobranca?: string
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          origem_id: string
          origem_tipo: string
          status?: string
          tipo?: string
          updated_at?: string
          updated_by?: string | null
          valor_estornado?: number
          valor_original: number
          valor_recebido?: number
          vencimento?: string | null
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id?: string
          forma_cobranca?: string
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          origem_id?: string
          origem_tipo?: string
          status?: string
          tipo?: string
          updated_at?: string
          updated_by?: string | null
          valor_estornado?: number
          valor_original?: number
          valor_recebido?: number
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_lancamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      financeiro_parcelas: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          lancamento_id: string
          numero: number
          status: string
          updated_at: string
          valor: number
          valor_estornado: number
          valor_recebido: number
          vencimento: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          lancamento_id: string
          numero: number
          status?: string
          updated_at?: string
          valor: number
          valor_estornado?: number
          valor_recebido?: number
          vencimento: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          lancamento_id?: string
          numero?: number
          status?: string
          updated_at?: string
          valor?: number
          valor_estornado?: number
          valor_recebido?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_parcelas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_parcelas_empresa_lancamento_fkey"
            columns: ["empresa_id", "lancamento_id"]
            isOneToOne: false
            referencedRelation: "financeiro_lancamentos"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      financeiro_recebimentos: {
        Row: {
          client_uuid: string
          created_at: string
          data_recebimento: string
          empresa_id: string
          executado_por: string | null
          forma_pagamento: string | null
          id: string
          lancamento_id: string
          observacao: string | null
          parcela_id: string | null
          recebimento_estornado_id: string | null
          tipo: string
          valor: number
        }
        Insert: {
          client_uuid: string
          created_at?: string
          data_recebimento?: string
          empresa_id: string
          executado_por?: string | null
          forma_pagamento?: string | null
          id?: string
          lancamento_id: string
          observacao?: string | null
          parcela_id?: string | null
          recebimento_estornado_id?: string | null
          tipo?: string
          valor: number
        }
        Update: {
          client_uuid?: string
          created_at?: string
          data_recebimento?: string
          empresa_id?: string
          executado_por?: string | null
          forma_pagamento?: string | null
          id?: string
          lancamento_id?: string
          observacao?: string | null
          parcela_id?: string | null
          recebimento_estornado_id?: string | null
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_recebimentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_recebimentos_empresa_lancamento_fkey"
            columns: ["empresa_id", "lancamento_id"]
            isOneToOne: false
            referencedRelation: "financeiro_lancamentos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "financeiro_recebimentos_lancamento_parcela_fkey"
            columns: ["lancamento_id", "parcela_id"]
            isOneToOne: false
            referencedRelation: "financeiro_parcelas"
            referencedColumns: ["lancamento_id", "id"]
          },
          {
            foreignKeyName: "financeiro_recebimentos_recebimento_estornado_id_fkey"
            columns: ["recebimento_estornado_id"]
            isOneToOne: false
            referencedRelation: "financeiro_recebimentos"
            referencedColumns: ["id"]
          },
        ]
      }
      financials: {
        Row: {
          cache: number | null
          cache_detail: Json | null
          created_at: string
          empresa_id: string | null
          event_id: string
          extra_costs: Json | null
          food: number | null
          funcionarios_cache: Json | null
          id: string
          lodging: number | null
          lodging_detail: Json | null
          other_costs: number | null
          transport: number | null
          transport_detail: Json | null
          updated_at: string
        }
        Insert: {
          cache?: number | null
          cache_detail?: Json | null
          created_at?: string
          empresa_id?: string | null
          event_id: string
          extra_costs?: Json | null
          food?: number | null
          funcionarios_cache?: Json | null
          id?: string
          lodging?: number | null
          lodging_detail?: Json | null
          other_costs?: number | null
          transport?: number | null
          transport_detail?: Json | null
          updated_at?: string
        }
        Update: {
          cache?: number | null
          cache_detail?: Json | null
          created_at?: string
          empresa_id?: string | null
          event_id?: string
          extra_costs?: Json | null
          food?: number | null
          funcionarios_cache?: Json | null
          id?: string
          lodging?: number | null
          lodging_detail?: Json | null
          other_costs?: number | null
          transport?: number | null
          transport_detail?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financials_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financials_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      funcionarios: {
        Row: {
          cache_padrao: number
          created_at: string
          empresa_id: string
          funcao: string
          id: string
          nome: string
          tipo: string
          updated_at: string
        }
        Insert: {
          cache_padrao?: number
          created_at?: string
          empresa_id: string
          funcao?: string
          id?: string
          nome: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          cache_padrao?: number
          created_at?: string
          empresa_id?: string
          funcao?: string
          id?: string
          nome?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funcionarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          conteudo_final: string
          created_at: string
          dados: Json
          empresa_id: string
          event_id: string | null
          id: string
          nome: string
          template_id: string | null
          tipo: string
        }
        Insert: {
          conteudo_final?: string
          created_at?: string
          dados?: Json
          empresa_id: string
          event_id?: string | null
          id?: string
          nome: string
          template_id?: string | null
          tipo?: string
        }
        Update: {
          conteudo_final?: string
          created_at?: string
          dados?: Json
          empresa_id?: string
          event_id?: string | null
          id?: string
          nome?: string
          template_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      manutencao_equipamento_numeradores: {
        Row: {
          ano: number
          empresa_id: string
          ultimo_numero: number
          updated_at: string
        }
        Insert: {
          ano: number
          empresa_id: string
          ultimo_numero?: number
          updated_at?: string
        }
        Update: {
          ano?: number
          empresa_id?: string
          ultimo_numero?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manutencao_equipamento_numeradores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      manutencao_ordem_eventos: {
        Row: {
          client_uuid: string
          created_at: string
          dados: Json
          data_efetiva: string
          descricao: string
          empresa_id: string
          executado_por: string
          id: string
          ordem_id: string
          payload_hash: string
          status_anterior:
            | Database["public"]["Enums"]["equipment_maintenance_status"]
            | null
          status_novo:
            | Database["public"]["Enums"]["equipment_maintenance_status"]
            | null
          tipo: Database["public"]["Enums"]["equipment_maintenance_event_type"]
        }
        Insert: {
          client_uuid: string
          created_at?: string
          dados?: Json
          data_efetiva?: string
          descricao: string
          empresa_id: string
          executado_por: string
          id?: string
          ordem_id: string
          payload_hash: string
          status_anterior?:
            | Database["public"]["Enums"]["equipment_maintenance_status"]
            | null
          status_novo?:
            | Database["public"]["Enums"]["equipment_maintenance_status"]
            | null
          tipo: Database["public"]["Enums"]["equipment_maintenance_event_type"]
        }
        Update: {
          client_uuid?: string
          created_at?: string
          dados?: Json
          data_efetiva?: string
          descricao?: string
          empresa_id?: string
          executado_por?: string
          id?: string
          ordem_id?: string
          payload_hash?: string
          status_anterior?:
            | Database["public"]["Enums"]["equipment_maintenance_status"]
            | null
          status_novo?:
            | Database["public"]["Enums"]["equipment_maintenance_status"]
            | null
          tipo?: Database["public"]["Enums"]["equipment_maintenance_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "manutencao_eventos_empresa_ordem_fkey"
            columns: ["empresa_id", "ordem_id"]
            isOneToOne: false
            referencedRelation: "manutencao_ordens"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "manutencao_ordem_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      manutencao_ordem_insumos: {
        Row: {
          created_at: string
          created_by: string
          custo_total: number | null
          custo_unitario: number
          descricao: string
          empresa_id: string
          id: string
          material_id: string | null
          ordem_id: string
          quantidade: number
          unidade: string
        }
        Insert: {
          created_at?: string
          created_by: string
          custo_total?: number | null
          custo_unitario?: number
          descricao: string
          empresa_id: string
          id?: string
          material_id?: string | null
          ordem_id: string
          quantidade?: number
          unidade?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          custo_total?: number | null
          custo_unitario?: number
          descricao?: string
          empresa_id?: string
          id?: string
          material_id?: string | null
          ordem_id?: string
          quantidade?: number
          unidade?: string
        }
        Relationships: [
          {
            foreignKeyName: "manutencao_insumos_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "manutencao_insumos_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "manutencao_insumos_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "manutencao_insumos_empresa_ordem_fkey"
            columns: ["empresa_id", "ordem_id"]
            isOneToOne: false
            referencedRelation: "manutencao_ordens"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "manutencao_ordem_insumos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      manutencao_ordens: {
        Row: {
          aberta_em: string
          cancelada_em: string | null
          client_uuid: string
          concluida_em: string | null
          condicao_entrada: string | null
          condicao_saida: string | null
          created_at: string
          created_by: string
          custo_mao_obra: number
          custo_outros: number
          custo_pecas: number
          custo_total: number | null
          custodia_evento_origem_id: string | null
          defeito_relatado: string
          diagnostico: string | null
          empresa_id: string
          fornecedor_externo: string | null
          id: string
          iniciada_em: string | null
          intervalo_preventivo_dias: number | null
          material_id: string
          modalidade_execucao: Database["public"]["Enums"]["equipment_maintenance_execution"]
          numero: string
          observacoes: string | null
          origem: Database["public"]["Enums"]["equipment_maintenance_origin"]
          payload_hash: string
          previsao_conclusao_em: string | null
          prioridade: Database["public"]["Enums"]["equipment_maintenance_priority"]
          proxima_preventiva_em: string | null
          quantidade_afetada: number
          responsavel_funcionario_id: string | null
          responsavel_nome: string | null
          responsavel_tipo:
            | Database["public"]["Enums"]["material_custody_responsible_type"]
            | null
          responsavel_usuario_id: string | null
          servico_executado: string | null
          status: Database["public"]["Enums"]["equipment_maintenance_status"]
          tipo: Database["public"]["Enums"]["equipment_maintenance_type"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
          updated_by: string
        }
        Insert: {
          aberta_em?: string
          cancelada_em?: string | null
          client_uuid: string
          concluida_em?: string | null
          condicao_entrada?: string | null
          condicao_saida?: string | null
          created_at?: string
          created_by: string
          custo_mao_obra?: number
          custo_outros?: number
          custo_pecas?: number
          custo_total?: number | null
          custodia_evento_origem_id?: string | null
          defeito_relatado: string
          diagnostico?: string | null
          empresa_id: string
          fornecedor_externo?: string | null
          id?: string
          iniciada_em?: string | null
          intervalo_preventivo_dias?: number | null
          material_id: string
          modalidade_execucao?: Database["public"]["Enums"]["equipment_maintenance_execution"]
          numero: string
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["equipment_maintenance_origin"]
          payload_hash: string
          previsao_conclusao_em?: string | null
          prioridade?: Database["public"]["Enums"]["equipment_maintenance_priority"]
          proxima_preventiva_em?: string | null
          quantidade_afetada?: number
          responsavel_funcionario_id?: string | null
          responsavel_nome?: string | null
          responsavel_tipo?:
            | Database["public"]["Enums"]["material_custody_responsible_type"]
            | null
          responsavel_usuario_id?: string | null
          servico_executado?: string | null
          status?: Database["public"]["Enums"]["equipment_maintenance_status"]
          tipo: Database["public"]["Enums"]["equipment_maintenance_type"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at?: string
          updated_by: string
        }
        Update: {
          aberta_em?: string
          cancelada_em?: string | null
          client_uuid?: string
          concluida_em?: string | null
          condicao_entrada?: string | null
          condicao_saida?: string | null
          created_at?: string
          created_by?: string
          custo_mao_obra?: number
          custo_outros?: number
          custo_pecas?: number
          custo_total?: number | null
          custodia_evento_origem_id?: string | null
          defeito_relatado?: string
          diagnostico?: string | null
          empresa_id?: string
          fornecedor_externo?: string | null
          id?: string
          iniciada_em?: string | null
          intervalo_preventivo_dias?: number | null
          material_id?: string
          modalidade_execucao?: Database["public"]["Enums"]["equipment_maintenance_execution"]
          numero?: string
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["equipment_maintenance_origin"]
          payload_hash?: string
          previsao_conclusao_em?: string | null
          prioridade?: Database["public"]["Enums"]["equipment_maintenance_priority"]
          proxima_preventiva_em?: string | null
          quantidade_afetada?: number
          responsavel_funcionario_id?: string | null
          responsavel_nome?: string | null
          responsavel_tipo?:
            | Database["public"]["Enums"]["material_custody_responsible_type"]
            | null
          responsavel_usuario_id?: string | null
          servico_executado?: string | null
          status?: Database["public"]["Enums"]["equipment_maintenance_status"]
          tipo?: Database["public"]["Enums"]["equipment_maintenance_type"]
          tipo_controle?: Database["public"]["Enums"]["material_control_type"]
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "manutencao_ordens_empresa_checkin_event_fkey"
            columns: ["empresa_id", "custodia_evento_origem_id"]
            isOneToOne: false
            referencedRelation: "material_custodia_eventos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "manutencao_ordens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manutencao_ordens_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "manutencao_ordens_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "manutencao_ordens_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      materiais: {
        Row: {
          ativo: boolean
          categoria_id: string
          codigo_barras: string | null
          codigo_interno: string
          conteudo_qr_code: string | null
          created_at: string
          created_by: string | null
          data_aquisicao: string | null
          descricao: string | null
          empresa_id: string
          estoque_minimo: number
          fornecedor: string | null
          id: string
          identificacao_gerada_em: string | null
          identificacao_gerada_por: string | null
          identificador_unico: string
          justificativa_status: string | null
          localizacao: string | null
          marca: string | null
          modelo: string | null
          nome: string
          numero_patrimonio: string | null
          numero_serie: string | null
          observacoes: string | null
          quantidade: number
          quantidade_legada_etapa1: number | null
          status_identificacao: Database["public"]["Enums"]["material_identification_status"]
          status_operacional: Database["public"]["Enums"]["material_operational_status"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          tipo_identificacao: Database["public"]["Enums"]["material_identification_type"]
          unidade_medida: string
          updated_at: string
          updated_by: string | null
          valor_aquisicao: number | null
          valor_locacao_padrao: number | null
          valor_reposicao: number | null
        }
        Insert: {
          ativo?: boolean
          categoria_id: string
          codigo_barras?: string | null
          codigo_interno: string
          conteudo_qr_code?: string | null
          created_at?: string
          created_by?: string | null
          data_aquisicao?: string | null
          descricao?: string | null
          empresa_id: string
          estoque_minimo?: number
          fornecedor?: string | null
          id?: string
          identificacao_gerada_em?: string | null
          identificacao_gerada_por?: string | null
          identificador_unico?: string
          justificativa_status?: string | null
          localizacao?: string | null
          marca?: string | null
          modelo?: string | null
          nome: string
          numero_patrimonio?: string | null
          numero_serie?: string | null
          observacoes?: string | null
          quantidade?: number
          quantidade_legada_etapa1?: number | null
          status_identificacao?: Database["public"]["Enums"]["material_identification_status"]
          status_operacional?: Database["public"]["Enums"]["material_operational_status"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          tipo_identificacao?: Database["public"]["Enums"]["material_identification_type"]
          unidade_medida?: string
          updated_at?: string
          updated_by?: string | null
          valor_aquisicao?: number | null
          valor_locacao_padrao?: number | null
          valor_reposicao?: number | null
        }
        Update: {
          ativo?: boolean
          categoria_id?: string
          codigo_barras?: string | null
          codigo_interno?: string
          conteudo_qr_code?: string | null
          created_at?: string
          created_by?: string | null
          data_aquisicao?: string | null
          descricao?: string | null
          empresa_id?: string
          estoque_minimo?: number
          fornecedor?: string | null
          id?: string
          identificacao_gerada_em?: string | null
          identificacao_gerada_por?: string | null
          identificador_unico?: string
          justificativa_status?: string | null
          localizacao?: string | null
          marca?: string | null
          modelo?: string | null
          nome?: string
          numero_patrimonio?: string | null
          numero_serie?: string | null
          observacoes?: string | null
          quantidade?: number
          quantidade_legada_etapa1?: number | null
          status_identificacao?: Database["public"]["Enums"]["material_identification_status"]
          status_operacional?: Database["public"]["Enums"]["material_operational_status"]
          tipo_controle?: Database["public"]["Enums"]["material_control_type"]
          tipo_identificacao?: Database["public"]["Enums"]["material_identification_type"]
          unidade_medida?: string
          updated_at?: string
          updated_by?: string | null
          valor_aquisicao?: number | null
          valor_locacao_padrao?: number | null
          valor_reposicao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "materiais_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materiais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      materiais_fotos: {
        Row: {
          created_at: string
          created_by: string | null
          empresa_id: string
          foto_principal: boolean
          id: string
          material_id: string
          nome_arquivo: string
          storage_path: string
          tamanho_arquivo: number
          tipo_arquivo: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          empresa_id: string
          foto_principal?: boolean
          id?: string
          material_id: string
          nome_arquivo: string
          storage_path: string
          tamanho_arquivo: number
          tipo_arquivo: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          empresa_id?: string
          foto_principal?: boolean
          id?: string
          material_id?: string
          nome_arquivo?: string
          storage_path?: string
          tamanho_arquivo?: number
          tipo_arquivo?: string
        }
        Relationships: [
          {
            foreignKeyName: "materiais_fotos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materiais_fotos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "materiais_fotos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["material_id"]
          },
          {
            foreignKeyName: "materiais_fotos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
        ]
      }
      material_custodia_eventos: {
        Row: {
          client_uuid: string
          condicao:
            | Database["public"]["Enums"]["material_custody_condition"]
            | null
          created_at: string
          custodia_id: string
          data_efetiva: string
          empresa_id: string
          executado_por: string
          id: string
          justificativa: string | null
          localizacao_destino_id: string | null
          localizacao_origem_id: string | null
          material_id: string
          movimento_estoque_id: string | null
          observacao: string | null
          ocorrencia: string | null
          payload_hash: string
          quantidade: number
          status_operacional_resultante: Database["public"]["Enums"]["material_operational_status"] | null
          tipo: Database["public"]["Enums"]["material_custody_event_type"]
        }
        Insert: {
          client_uuid: string
          condicao?:
            | Database["public"]["Enums"]["material_custody_condition"]
            | null
          created_at?: string
          custodia_id: string
          data_efetiva?: string
          empresa_id: string
          executado_por: string
          id?: string
          justificativa?: string | null
          localizacao_destino_id?: string | null
          localizacao_origem_id?: string | null
          material_id: string
          movimento_estoque_id?: string | null
          observacao?: string | null
          ocorrencia?: string | null
          payload_hash: string
          quantidade: number
          status_operacional_resultante?: Database["public"]["Enums"]["material_operational_status"] | null
          tipo: Database["public"]["Enums"]["material_custody_event_type"]
        }
        Update: {
          client_uuid?: string
          condicao?:
            | Database["public"]["Enums"]["material_custody_condition"]
            | null
          created_at?: string
          custodia_id?: string
          data_efetiva?: string
          empresa_id?: string
          executado_por?: string
          id?: string
          justificativa?: string | null
          localizacao_destino_id?: string | null
          localizacao_origem_id?: string | null
          material_id?: string
          movimento_estoque_id?: string | null
          observacao?: string | null
          ocorrencia?: string | null
          payload_hash?: string
          quantidade?: number
          status_operacional_resultante?: Database["public"]["Enums"]["material_operational_status"] | null
          tipo?: Database["public"]["Enums"]["material_custody_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "material_custodia_eventos_empresa_custodia_fkey"
            columns: ["empresa_id", "custodia_id"]
            isOneToOne: false
            referencedRelation: "material_custodias"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "material_custodia_eventos_empresa_destino_fkey"
            columns: ["empresa_id", "localizacao_destino_id"]
            isOneToOne: false
            referencedRelation: "estoque_localizacoes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "material_custodia_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_custodia_eventos_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "material_custodia_eventos_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "material_custodia_eventos_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "material_custodia_eventos_empresa_movimento_fkey"
            columns: ["empresa_id", "material_id", "movimento_estoque_id"]
            isOneToOne: false
            referencedRelation: "estoque_movimentacoes"
            referencedColumns: ["empresa_id", "material_id", "id"]
          },
          {
            foreignKeyName: "material_custodia_eventos_empresa_origem_fkey"
            columns: ["empresa_id", "localizacao_origem_id"]
            isOneToOne: false
            referencedRelation: "estoque_localizacoes"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      material_custodias: {
        Row: {
          client_uuid: string
          condicao_saida: Database["public"]["Enums"]["material_custody_condition"]
          created_at: string
          empresa_id: string
          encerrada_em: string | null
          executado_por: string
          finalidade: Database["public"]["Enums"]["material_custody_purpose"]
          id: string
          localizacao_origem_id: string
          material_id: string
          movimento_saida_id: string
          observacao_saida: string | null
          payload_hash: string
          previsao_retorno: string | null
          quantidade_devolvida: number
          quantidade_baixada: number
          quantidade_retirada: number
          referencia_id: string | null
          referencia_tipo: string | null
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_em: string
          status: Database["public"]["Enums"]["material_custody_status"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
        }
        Insert: {
          client_uuid: string
          condicao_saida: Database["public"]["Enums"]["material_custody_condition"]
          created_at?: string
          empresa_id: string
          encerrada_em?: string | null
          executado_por: string
          finalidade: Database["public"]["Enums"]["material_custody_purpose"]
          id?: string
          localizacao_origem_id: string
          material_id: string
          movimento_saida_id: string
          observacao_saida?: string | null
          payload_hash: string
          previsao_retorno?: string | null
          quantidade_devolvida?: number
          quantidade_baixada?: number
          quantidade_retirada: number
          referencia_id?: string | null
          referencia_tipo?: string | null
          responsavel_funcionario_id?: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id?: string | null
          retirada_em?: string
          status?: Database["public"]["Enums"]["material_custody_status"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at?: string
        }
        Update: {
          client_uuid?: string
          condicao_saida?: Database["public"]["Enums"]["material_custody_condition"]
          created_at?: string
          empresa_id?: string
          encerrada_em?: string | null
          executado_por?: string
          finalidade?: Database["public"]["Enums"]["material_custody_purpose"]
          id?: string
          localizacao_origem_id?: string
          material_id?: string
          movimento_saida_id?: string
          observacao_saida?: string | null
          payload_hash?: string
          previsao_retorno?: string | null
          quantidade_devolvida?: number
          quantidade_baixada?: number
          quantidade_retirada?: number
          referencia_id?: string | null
          referencia_tipo?: string | null
          responsavel_funcionario_id?: string | null
          responsavel_nome?: string
          responsavel_tipo?: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id?: string | null
          retirada_em?: string
          status?: Database["public"]["Enums"]["material_custody_status"]
          tipo_controle?: Database["public"]["Enums"]["material_control_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_custodias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_custodias_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "material_custodias_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "material_custodias_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "material_custodias_empresa_movimento_saida_fkey"
            columns: ["empresa_id", "material_id", "movimento_saida_id"]
            isOneToOne: false
            referencedRelation: "estoque_movimentacoes"
            referencedColumns: ["empresa_id", "material_id", "id"]
          },
          {
            foreignKeyName: "material_custodias_empresa_origem_fkey"
            columns: ["empresa_id", "localizacao_origem_id"]
            isOneToOne: false
            referencedRelation: "estoque_localizacoes"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      material_locacao_eventos: {
        Row: {
          client_uuid: string
          created_at: string
          custodia_id: string | null
          dados: Json
          data_efetiva: string
          descricao: string
          empresa_id: string
          executado_por: string
          id: string
          item_id: string | null
          locacao_id: string
          payload_hash: string
          tipo: Database["public"]["Enums"]["material_rental_event_type"]
        }
        Insert: {
          client_uuid: string
          created_at?: string
          custodia_id?: string | null
          dados?: Json
          data_efetiva?: string
          descricao: string
          empresa_id: string
          executado_por: string
          id?: string
          item_id?: string | null
          locacao_id: string
          payload_hash: string
          tipo: Database["public"]["Enums"]["material_rental_event_type"]
        }
        Update: {
          client_uuid?: string
          created_at?: string
          custodia_id?: string | null
          dados?: Json
          data_efetiva?: string
          descricao?: string
          empresa_id?: string
          executado_por?: string
          id?: string
          item_id?: string | null
          locacao_id?: string
          payload_hash?: string
          tipo?: Database["public"]["Enums"]["material_rental_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "material_locacao_eventos_empresa_custodia_fkey"
            columns: ["empresa_id", "custodia_id"]
            isOneToOne: false
            referencedRelation: "material_custodias"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "material_locacao_eventos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_locacao_eventos_empresa_item_fkey"
            columns: ["empresa_id", "item_id"]
            isOneToOne: false
            referencedRelation: "material_locacao_itens"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "material_locacao_eventos_empresa_locacao_fkey"
            columns: ["empresa_id", "locacao_id"]
            isOneToOne: false
            referencedRelation: "material_locacoes"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      material_locacao_itens: {
        Row: {
          created_at: string
          desconto: number
          empresa_id: string
          id: string
          locacao_id: string
          material_id: string
          modalidade_cobranca: Database["public"]["Enums"]["material_rental_billing_mode"]
          observacoes: string | null
          quantidade_contratada: number
          subtotal: number | null
          unidades_cobranca: number
          updated_at: string
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          desconto?: number
          empresa_id: string
          id?: string
          locacao_id: string
          material_id: string
          modalidade_cobranca?: Database["public"]["Enums"]["material_rental_billing_mode"]
          observacoes?: string | null
          quantidade_contratada: number
          subtotal?: number | null
          unidades_cobranca?: number
          updated_at?: string
          valor_unitario?: number
        }
        Update: {
          created_at?: string
          desconto?: number
          empresa_id?: string
          id?: string
          locacao_id?: string
          material_id?: string
          modalidade_cobranca?: Database["public"]["Enums"]["material_rental_billing_mode"]
          observacoes?: string | null
          quantidade_contratada?: number
          subtotal?: number | null
          unidades_cobranca?: number
          updated_at?: string
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "material_locacao_itens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_locacao_itens_empresa_locacao_fkey"
            columns: ["empresa_id", "locacao_id"]
            isOneToOne: false
            referencedRelation: "material_locacoes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "material_locacao_itens_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_divergencias_saldo"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "material_locacao_itens_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "estoque_reconciliacao_legado"
            referencedColumns: ["empresa_id", "material_id"]
          },
          {
            foreignKeyName: "material_locacao_itens_empresa_material_fkey"
            columns: ["empresa_id", "material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      material_locacao_numeradores: {
        Row: {
          ano: number
          empresa_id: string
          ultimo_numero: number
          updated_at: string
        }
        Insert: {
          ano: number
          empresa_id: string
          ultimo_numero?: number
          updated_at?: string
        }
        Update: {
          ano?: number
          empresa_id?: string
          ultimo_numero?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_locacao_numeradores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      material_locacoes: {
        Row: {
          client_uuid: string
          cliente_id: string
          contrato_referencia_id: string | null
          created_at: string
          created_by: string
          desconto: number
          devolucao_prevista_em: string
          empresa_id: string
          encerrada_em: string | null
          evento_id: string | null
          financeiro_lancamento_id: string | null
          id: string
          iniciada_em: string | null
          numero: string
          observacoes: string | null
          orcamento_referencia_id: string | null
          payload_hash: string
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_prevista_em: string
          status: Database["public"]["Enums"]["material_rental_status"]
          updated_at: string
          updated_by: string
          valor_bruto: number
          valor_total: number
        }
        Insert: {
          client_uuid: string
          cliente_id: string
          contrato_referencia_id?: string | null
          created_at?: string
          created_by: string
          desconto?: number
          devolucao_prevista_em: string
          empresa_id: string
          encerrada_em?: string | null
          evento_id?: string | null
          financeiro_lancamento_id?: string | null
          id?: string
          iniciada_em?: string | null
          numero: string
          observacoes?: string | null
          orcamento_referencia_id?: string | null
          payload_hash: string
          responsavel_funcionario_id?: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id?: string | null
          retirada_prevista_em: string
          status?: Database["public"]["Enums"]["material_rental_status"]
          updated_at?: string
          updated_by: string
          valor_bruto?: number
          valor_total?: number
        }
        Update: {
          client_uuid?: string
          cliente_id?: string
          contrato_referencia_id?: string | null
          created_at?: string
          created_by?: string
          desconto?: number
          devolucao_prevista_em?: string
          empresa_id?: string
          encerrada_em?: string | null
          evento_id?: string | null
          financeiro_lancamento_id?: string | null
          id?: string
          iniciada_em?: string | null
          numero?: string
          observacoes?: string | null
          orcamento_referencia_id?: string | null
          payload_hash?: string
          responsavel_funcionario_id?: string | null
          responsavel_nome?: string
          responsavel_tipo?: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id?: string | null
          retirada_prevista_em?: string
          status?: Database["public"]["Enums"]["material_rental_status"]
          updated_at?: string
          updated_by?: string
          valor_bruto?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "material_locacoes_empresa_cliente_fkey"
            columns: ["empresa_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "material_locacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      module_batch_request_items: {
        Row: {
          batch_request_id: string
          created_at: string
          id: string
          module_id: string
          valor: number
        }
        Insert: {
          batch_request_id: string
          created_at?: string
          id?: string
          module_id: string
          valor?: number
        }
        Update: {
          batch_request_id?: string
          created_at?: string
          id?: string
          module_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "module_batch_request_items_batch_request_id_fkey"
            columns: ["batch_request_id"]
            isOneToOne: false
            referencedRelation: "module_batch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_batch_request_items_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "module_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      module_batch_requests: {
        Row: {
          approved_at: string | null
          comprovante_url: string | null
          created_at: string
          empresa_id: string
          id: string
          observacao: string | null
          observacao_admin: string | null
          payment_method: string | null
          rejected_at: string | null
          status: string
          updated_at: string
          valor_total: number
        }
        Insert: {
          approved_at?: string | null
          comprovante_url?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          observacao?: string | null
          observacao_admin?: string | null
          payment_method?: string | null
          rejected_at?: string | null
          status?: string
          updated_at?: string
          valor_total?: number
        }
        Update: {
          approved_at?: string | null
          comprovante_url?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          observacao?: string | null
          observacao_admin?: string | null
          payment_method?: string | null
          rejected_at?: string | null
          status?: string
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "module_batch_requests_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      module_catalog: {
        Row: {
          ativo: boolean
          badge: string | null
          capacidade_extra_eventos: number
          capacidade_extra_storage: number
          capacidade_extra_usuarios: number
          categoria: string
          created_at: string
          descricao: string | null
          destaque: boolean
          feature_key: string
          id: string
          is_capacity_module: boolean
          metadata: Json | null
          nome: string
          ordem: number
          periodicidade: string
          texto_venda: string | null
          tipo_modulo: string
          updated_at: string
          valor: number
        }
        Insert: {
          ativo?: boolean
          badge?: string | null
          capacidade_extra_eventos?: number
          capacidade_extra_storage?: number
          capacidade_extra_usuarios?: number
          categoria?: string
          created_at?: string
          descricao?: string | null
          destaque?: boolean
          feature_key: string
          id?: string
          is_capacity_module?: boolean
          metadata?: Json | null
          nome: string
          ordem?: number
          periodicidade?: string
          texto_venda?: string | null
          tipo_modulo?: string
          updated_at?: string
          valor?: number
        }
        Update: {
          ativo?: boolean
          badge?: string | null
          capacidade_extra_eventos?: number
          capacidade_extra_storage?: number
          capacidade_extra_usuarios?: number
          categoria?: string
          created_at?: string
          descricao?: string | null
          destaque?: boolean
          feature_key?: string
          id?: string
          is_capacity_module?: boolean
          metadata?: Json | null
          nome?: string
          ordem?: number
          periodicidade?: string
          texto_venda?: string | null
          tipo_modulo?: string
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      module_dependencies: {
        Row: {
          created_at: string
          id: string
          module_id: string
          required_module_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          module_id: string
          required_module_id: string
        }
        Update: {
          created_at?: string
          id?: string
          module_id?: string
          required_module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_dependencies_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "module_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_dependencies_required_module_id_fkey"
            columns: ["required_module_id"]
            isOneToOne: false
            referencedRelation: "module_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      module_payments: {
        Row: {
          amount: number
          approved_at: string | null
          comprovante_url: string | null
          created_at: string
          empresa_id: string
          id: string
          module_id: string
          observacao_admin: string | null
          paid_at: string | null
          payment_method: string | null
          rejected_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          comprovante_url?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          module_id: string
          observacao_admin?: string | null
          paid_at?: string | null
          payment_method?: string | null
          rejected_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          comprovante_url?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          module_id?: string
          observacao_admin?: string | null
          paid_at?: string | null
          payment_method?: string | null
          rejected_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_payments_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_payments_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "module_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      module_requests: {
        Row: {
          approved_at: string | null
          created_at: string
          empresa_id: string
          id: string
          module_id: string
          observacao: string | null
          rejected_at: string | null
          requested_at: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          module_id: string
          observacao?: string | null
          rejected_at?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          module_id?: string
          observacao?: string | null
          rejected_at?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_requests_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_requests_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "module_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes_master: {
        Row: {
          created_at: string
          dados: Json | null
          empresa_id: string
          id: string
          lida: boolean
          mensagem: string
          tipo: string
        }
        Insert: {
          created_at?: string
          dados?: Json | null
          empresa_id: string
          id?: string
          lida?: boolean
          mensagem: string
          tipo?: string
        }
        Update: {
          created_at?: string
          dados?: Json | null
          empresa_id?: string
          id?: string
          lida?: boolean
          mensagem?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_master_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      pagamentos: {
        Row: {
          comprovante_path: string | null
          created_at: string
          descricao: string | null
          empresa_id: string
          id: string
          metodo: string | null
          plano_id: string | null
          status: string
          updated_at: string
          valor: number
        }
        Insert: {
          comprovante_path?: string | null
          created_at?: string
          descricao?: string | null
          empresa_id: string
          id?: string
          metodo?: string | null
          plano_id?: string | null
          status?: string
          updated_at?: string
          valor?: number
        }
        Update: {
          comprovante_path?: string | null
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          id?: string
          metodo?: string | null
          plano_id?: string | null
          status?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      planos: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          descricao: string | null
          disponivel_novo_cadastro: boolean
          id: string
          max_eventos: number | null
          max_usuarios: number | null
          nome: string
          periodicidade: string
          storage_limit: number | null
          trial_days: number
          updated_at: string
          valor: number
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          descricao?: string | null
          disponivel_novo_cadastro?: boolean
          id?: string
          max_eventos?: number | null
          max_usuarios?: number | null
          nome: string
          periodicidade?: string
          storage_limit?: number | null
          trial_days?: number
          updated_at?: string
          valor?: number
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          descricao?: string | null
          disponivel_novo_cadastro?: boolean
          id?: string
          max_eventos?: number | null
          max_usuarios?: number | null
          nome?: string
          periodicidade?: string
          storage_limit?: number | null
          trial_days?: number
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          activated_at: string | null
          ativado: boolean
          avatar_url: string | null
          created_at: string
          email: string | null
          empresa_id: string | null
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          ativado?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          empresa_id?: string | null
          full_name?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          ativado?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          empresa_id?: string | null
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      self_registration_rate_limits: {
        Row: {
          blocked_until: string | null
          identifier_hash: string
          request_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          blocked_until?: string | null
          identifier_hash: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          blocked_until?: string | null
          identifier_hash?: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          acao: string
          created_at: string
          dados: Json | null
          descricao: string
          empresa_id: string | null
          empresa_nome: string | null
          id: string
          tipo: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          dados?: Json | null
          descricao: string
          empresa_id?: string | null
          empresa_nome?: string | null
          id?: string
          tipo?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          dados?: Json | null
          descricao?: string
          empresa_id?: string | null
          empresa_nome?: string | null
          id?: string
          tipo?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_logs_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      user_company_removal_audit: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string
          auth_deletion_error: string | null
          auth_deletion_required: boolean
          auth_deletion_status: string
          created_at: string
          empresa_id: string | null
          empresa_nome: string | null
          id: string
          remaining_links: number
          removed_perfil: string | null
          target_email: string | null
          target_name: string | null
          target_user_id: string
          updated_at: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id: string
          auth_deletion_error?: string | null
          auth_deletion_required: boolean
          auth_deletion_status: string
          created_at?: string
          empresa_id?: string | null
          empresa_nome?: string | null
          id?: string
          remaining_links: number
          removed_perfil?: string | null
          target_email?: string | null
          target_name?: string | null
          target_user_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string
          auth_deletion_error?: string | null
          auth_deletion_required?: boolean
          auth_deletion_status?: string
          created_at?: string
          empresa_id?: string | null
          empresa_nome?: string | null
          id?: string
          remaining_links?: number
          removed_perfil?: string | null
          target_email?: string | null
          target_name?: string | null
          target_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_module_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_view: boolean
          created_at: string
          empresa_id: string
          feature_key: string
          granted_by: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          empresa_id: string
          feature_key: string
          granted_by?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          empresa_id?: string
          feature_key?: string
          granted_by?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_module_permissions_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_module_permissions_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "module_catalog"
            referencedColumns: ["feature_key"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      estoque_divergencias_saldo: {
        Row: {
          empresa_id: string | null
          material_id: string | null
          quantidade_projetada: number | null
          quantidade_saldos: number | null
        }
        Relationships: [
          {
            foreignKeyName: "materiais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_reconciliacao_legado: {
        Row: {
          codigo_interno: string | null
          empresa_id: string | null
          localizacao_legada: string | null
          material_id: string | null
          nome: string | null
          quantidade_legada_etapa1: number | null
          saldo_atual: number | null
          saldo_inicial_pendente: boolean | null
          status_reconciliacao: string | null
          tem_movimentacoes: boolean | null
          tipo_controle:
            | Database["public"]["Enums"]["material_control_type"]
            | null
        }
        Insert: {
          codigo_interno?: string | null
          empresa_id?: string | null
          localizacao_legada?: string | null
          material_id?: string | null
          nome?: string | null
          quantidade_legada_etapa1?: number | null
          saldo_atual?: number | null
          saldo_inicial_pendente?: never
          status_reconciliacao?: never
          tem_movimentacoes?: never
          tipo_controle?:
            | Database["public"]["Enums"]["material_control_type"]
            | null
        }
        Update: {
          codigo_interno?: string | null
          empresa_id?: string | null
          localizacao_legada?: string | null
          material_id?: string | null
          nome?: string | null
          quantidade_legada_etapa1?: number | null
          saldo_atual?: number | null
          saldo_inicial_pendente?: never
          status_reconciliacao?: never
          tem_movimentacoes?: never
          tipo_controle?:
            | Database["public"]["Enums"]["material_control_type"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "materiais_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ajustar_estoque_material: {
        Args: {
          _client_uuid: string
          _data_efetiva?: string
          _empresa_id?: string
          _justificativa: string
          _localizacao_id: string
          _material_id: string
          _motivo: string
          _observacao?: string
          _quantidade_fisica: number
        }
        Returns: {
          client_uuid: string
          created_at: string
          created_by: string
          data_efetiva: string
          documento_referencia: string | null
          empresa_id: string
          id: string
          justificativa: string | null
          localizacao_destino_id: string | null
          localizacao_origem_id: string | null
          material_id: string
          motivo: string | null
          movimentacao_estornada_id: string | null
          observacao: string | null
          origem_id: string | null
          origem_modulo: Database["public"]["Enums"]["estoque_origem_modulo"]
          payload_hash: string
          quantidade: number
          saldo_destino_anterior: number | null
          saldo_destino_posterior: number | null
          saldo_origem_anterior: number | null
          saldo_origem_posterior: number | null
          saldo_total_anterior: number
          saldo_total_posterior: number
          tipo_movimentacao: Database["public"]["Enums"]["estoque_movimentacao_tipo"]
        }
        SetofOptions: {
          from: "*"
          to: "estoque_movimentacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      alternar_status_cliente: {
        Args: { _ativo: boolean; _cliente_id: string; _empresa_id?: string }
        Returns: {
          ativo: boolean
          cpf_cnpj: string | null
          created_at: string
          created_by: string
          email: string | null
          empresa_id: string
          id: string
          nome: string
          nome_fantasia: string | null
          observacoes: string | null
          telefone: string | null
          tipo_pessoa: Database["public"]["Enums"]["customer_person_type"]
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "clientes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_stock_movement: {
        Args: {
          _client_uuid: string
          _company_id: string
          _destination_location_id: string
          _effective_at: string
          _justification: string
          _material_id: string
          _note: string
          _origin_location_id: string
          _payload_hash: string
          _quantity: number
          _reason: string
          _reference_document: string
          _reversed_movement_id?: string
          _source_id: string
          _source_module: Database["public"]["Enums"]["estoque_origem_modulo"]
          _type: Database["public"]["Enums"]["estoque_movimentacao_tipo"]
        }
        Returns: {
          client_uuid: string
          created_at: string
          created_by: string
          data_efetiva: string
          documento_referencia: string | null
          empresa_id: string
          id: string
          justificativa: string | null
          localizacao_destino_id: string | null
          localizacao_origem_id: string | null
          material_id: string
          motivo: string | null
          movimentacao_estornada_id: string | null
          observacao: string | null
          origem_id: string | null
          origem_modulo: Database["public"]["Enums"]["estoque_origem_modulo"]
          payload_hash: string
          quantidade: number
          saldo_destino_anterior: number | null
          saldo_destino_posterior: number | null
          saldo_origem_anterior: number | null
          saldo_origem_posterior: number | null
          saldo_total_anterior: number
          saldo_total_posterior: number
          tipo_movimentacao: Database["public"]["Enums"]["estoque_movimentacao_tipo"]
        }
        SetofOptions: {
          from: "*"
          to: "estoque_movimentacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_actor_company_operational_access: {
        Args: { _actor_id: string; _empresa_id: string; _feature_key?: string }
        Returns: undefined
      }
      assert_material_label_batch_completeness: {
        Args: { _company_id: string; _request_id: string }
        Returns: undefined
      }
      atualizar_ordem_manutencao: {
        Args: {
          _client_uuid: string
          _condicao_saida?: string
          _custo_mao_obra?: number
          _custo_outros?: number
          _custo_pecas?: number
          _diagnostico?: string
          _empresa_id?: string
          _expected_updated_at: string
          _fornecedor_externo?: string
          _intervalo_preventivo_dias?: number
          _modalidade_execucao?: string
          _observacoes?: string
          _ordem_id: string
          _previsao_conclusao_em?: string
          _prioridade?: string
          _responsavel_id?: string
          _responsavel_tipo?: string
          _servico_executado?: string
        }
        Returns: {
          aberta_em: string
          cancelada_em: string | null
          client_uuid: string
          concluida_em: string | null
          condicao_entrada: string | null
          condicao_saida: string | null
          created_at: string
          created_by: string
          custo_mao_obra: number
          custo_outros: number
          custo_pecas: number
          custo_total: number | null
          custodia_evento_origem_id: string | null
          defeito_relatado: string
          diagnostico: string | null
          empresa_id: string
          fornecedor_externo: string | null
          id: string
          iniciada_em: string | null
          intervalo_preventivo_dias: number | null
          material_id: string
          modalidade_execucao: Database["public"]["Enums"]["equipment_maintenance_execution"]
          numero: string
          observacoes: string | null
          origem: Database["public"]["Enums"]["equipment_maintenance_origin"]
          payload_hash: string
          previsao_conclusao_em: string | null
          prioridade: Database["public"]["Enums"]["equipment_maintenance_priority"]
          proxima_preventiva_em: string | null
          quantidade_afetada: number
          responsavel_funcionario_id: string | null
          responsavel_nome: string | null
          responsavel_tipo:
            | Database["public"]["Enums"]["material_custody_responsible_type"]
            | null
          responsavel_usuario_id: string | null
          servico_executado: string | null
          status: Database["public"]["Enums"]["equipment_maintenance_status"]
          tipo: Database["public"]["Enums"]["equipment_maintenance_type"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "manutencao_ordens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      atualizar_rascunho_locacao_material: {
        Args: {
          _client_uuid: string
          _cliente_id: string
          _devolucao_prevista_em: string
          _empresa_id?: string
          _evento_id?: string
          _locacao_id: string
          _observacoes?: string
          _responsavel_id: string
          _responsavel_tipo: string
          _retirada_prevista_em: string
        }
        Returns: {
          client_uuid: string
          cliente_id: string
          contrato_referencia_id: string | null
          created_at: string
          created_by: string
          desconto: number
          devolucao_prevista_em: string
          empresa_id: string
          encerrada_em: string | null
          evento_id: string | null
          financeiro_lancamento_id: string | null
          id: string
          iniciada_em: string | null
          numero: string
          observacoes: string | null
          orcamento_referencia_id: string | null
          payload_hash: string
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_prevista_em: string
          status: Database["public"]["Enums"]["material_rental_status"]
          updated_at: string
          updated_by: string
          valor_bruto: number
          valor_total: number
        }
        SetofOptions: {
          from: "*"
          to: "material_locacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      backfill_financeiro_locacoes: {
        Args: { _empresa_id?: string }
        Returns: {
          empresa_id: string
          locacao_id: string
          numero: string
          resultado: string
        }[]
      }
      backfill_financeiro_manutencoes: {
        Args: { _empresa_id?: string }
        Returns: {
          empresa_id: string
          numero: string
          ordem_id: string
          resultado: string
        }[]
      }
      backfill_user_module_view_permissions: { Args: never; Returns: undefined }
      buscar_materiais_custodia: {
        Args: { _busca: string; _empresa_id?: string; _limite?: number }
        Returns: {
          item: Json
        }[]
      }
      buscar_materiais_disponiveis_locacao: {
        Args: {
          _busca: string
          _devolucao_prevista_em: string
          _empresa_id?: string
          _limite?: number
          _locacao_excluir_id?: string
          _retirada_prevista_em: string
        }
        Returns: {
          item: Json
        }[]
      }
      buscar_materiais_etiqueta: {
        Args: { _busca?: string; _empresa_id?: string; _limite?: number }
        Returns: Json[]
      }
      buscar_materiais_manutencao: {
        Args: { _busca: string; _empresa_id?: string; _limite?: number }
        Returns: {
          item: Json
        }[]
      }
      can_manage_event_storage_object: {
        Args: { _file_path: string }
        Returns: boolean
      }
      can_manage_logo_storage_object: {
        Args: { _path: string }
        Returns: boolean
      }
      can_manage_material_photo_object: {
        Args: { _file_path: string }
        Returns: boolean
      }
      can_read_company_data: { Args: { _empresa_id: string }; Returns: boolean }
      can_read_company_module: {
        Args: { _empresa_id: string; _feature_key: string }
        Returns: boolean
      }
      can_read_event_storage_object: {
        Args: { _file_path: string }
        Returns: boolean
      }
      can_read_material_photo_object: {
        Args: { _file_path: string }
        Returns: boolean
      }
      can_write_company_data: {
        Args: { _empresa_id: string }
        Returns: boolean
      }
      can_write_company_module: {
        Args: { _empresa_id: string; _feature_key: string }
        Returns: boolean
      }
      cancelar_checkout_material: {
        Args: {
          _client_uuid: string
          _custodia_id: string
          _data_efetiva?: string
          _empresa_id?: string
          _justificativa: string
        }
        Returns: {
          client_uuid: string
          condicao_saida: Database["public"]["Enums"]["material_custody_condition"]
          created_at: string
          empresa_id: string
          encerrada_em: string | null
          executado_por: string
          finalidade: Database["public"]["Enums"]["material_custody_purpose"]
          id: string
          localizacao_origem_id: string
          material_id: string
          movimento_saida_id: string
          observacao_saida: string | null
          payload_hash: string
          previsao_retorno: string | null
          quantidade_devolvida: number
          quantidade_retirada: number
          referencia_id: string | null
          referencia_tipo: string | null
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_em: string
          status: Database["public"]["Enums"]["material_custody_status"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "material_custodias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancelar_locacao_material: {
        Args: {
          _client_uuid: string
          _empresa_id?: string
          _justificativa: string
          _locacao_id: string
        }
        Returns: {
          client_uuid: string
          cliente_id: string
          contrato_referencia_id: string | null
          created_at: string
          created_by: string
          desconto: number
          devolucao_prevista_em: string
          empresa_id: string
          encerrada_em: string | null
          evento_id: string | null
          financeiro_lancamento_id: string | null
          id: string
          iniciada_em: string | null
          numero: string
          observacoes: string | null
          orcamento_referencia_id: string | null
          payload_hash: string
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_prevista_em: string
          status: Database["public"]["Enums"]["material_rental_status"]
          updated_at: string
          updated_by: string
          valor_bruto: number
          valor_total: number
        }
        SetofOptions: {
          from: "*"
          to: "material_locacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      choose_company_plan: {
        Args: { _actor_id: string; _plan_id?: string; _selection_type: string }
        Returns: Json
      }
      company_set_user_role: {
        Args: {
          _full_name: string
          _role: string
          _target_user_id: string
        }
        Returns: Json
      }
      company_has_active_module: {
        Args: { _empresa_id: string; _feature_key: string }
        Returns: boolean
      }
      company_has_lifetime_subscription: {
        Args: { _empresa_id: string }
        Returns: boolean
      }
      company_has_operational_access: {
        Args: { _empresa_id: string }
        Returns: boolean
      }
      company_module_dependencies_satisfied: {
        Args: { _empresa_id: string; _module_id: string }
        Returns: boolean
      }
      concluir_locacao_material: {
        Args: {
          _client_uuid: string
          _empresa_id?: string
          _locacao_id: string
        }
        Returns: {
          client_uuid: string
          cliente_id: string
          contrato_referencia_id: string | null
          created_at: string
          created_by: string
          desconto: number
          devolucao_prevista_em: string
          empresa_id: string
          encerrada_em: string | null
          evento_id: string | null
          financeiro_lancamento_id: string | null
          id: string
          iniciada_em: string | null
          numero: string
          observacoes: string | null
          orcamento_referencia_id: string | null
          payload_hash: string
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_prevista_em: string
          status: Database["public"]["Enums"]["material_rental_status"]
          updated_at: string
          updated_by: string
          valor_bruto: number
          valor_total: number
        }
        SetofOptions: {
          from: "*"
          to: "material_locacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirmar_reserva_locacao_material: {
        Args: {
          _client_uuid: string
          _empresa_id?: string
          _forma_cobranca?: string
          _locacao_id: string
          _parcelas?: Json
          _vencimento?: string
        }
        Returns: {
          client_uuid: string
          cliente_id: string
          contrato_referencia_id: string | null
          created_at: string
          created_by: string
          desconto: number
          devolucao_prevista_em: string
          empresa_id: string
          encerrada_em: string | null
          evento_id: string | null
          financeiro_lancamento_id: string | null
          id: string
          iniciada_em: string | null
          numero: string
          observacoes: string | null
          orcamento_referencia_id: string | null
          payload_hash: string
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_prevista_em: string
          status: Database["public"]["Enums"]["material_rental_status"]
          updated_at: string
          updated_by: string
          valor_bruto: number
          valor_total: number
        }
        SetofOptions: {
          from: "*"
          to: "material_locacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_account_activation: {
        Args: { _user_id: string }
        Returns: string
      }
      consume_self_registration_rate_limit: {
        Args: {
          _block_seconds: number
          _identifier_hash: string
          _max_requests: number
          _window_seconds: number
        }
        Returns: boolean
      }
      criar_locacao_material: {
        Args: {
          _client_uuid: string
          _cliente_id: string
          _devolucao_prevista_em: string
          _empresa_id?: string
          _evento_id?: string
          _observacoes?: string
          _responsavel_id: string
          _responsavel_tipo: string
          _retirada_prevista_em: string
        }
        Returns: {
          client_uuid: string
          cliente_id: string
          contrato_referencia_id: string | null
          created_at: string
          created_by: string
          desconto: number
          devolucao_prevista_em: string
          empresa_id: string
          encerrada_em: string | null
          evento_id: string | null
          financeiro_lancamento_id: string | null
          id: string
          iniciada_em: string | null
          numero: string
          observacoes: string | null
          orcamento_referencia_id: string | null
          payload_hash: string
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_prevista_em: string
          status: Database["public"]["Enums"]["material_rental_status"]
          updated_at: string
          updated_by: string
          valor_bruto: number
          valor_total: number
        }
        SetofOptions: {
          from: "*"
          to: "material_locacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      criar_ordem_manutencao: {
        Args: {
          _client_uuid: string
          _condicao_entrada?: string
          _custodia_evento_origem_id?: string
          _defeito_relatado: string
          _empresa_id?: string
          _fornecedor_externo?: string
          _intervalo_preventivo_dias?: number
          _material_id: string
          _modalidade_execucao?: string
          _observacoes?: string
          _origem: string
          _previsao_conclusao_em?: string
          _prioridade: string
          _quantidade_afetada?: number
          _responsavel_id?: string
          _responsavel_tipo?: string
          _tipo: string
        }
        Returns: {
          aberta_em: string
          cancelada_em: string | null
          client_uuid: string
          concluida_em: string | null
          condicao_entrada: string | null
          condicao_saida: string | null
          created_at: string
          created_by: string
          custo_mao_obra: number
          custo_outros: number
          custo_pecas: number
          custo_total: number | null
          custodia_evento_origem_id: string | null
          defeito_relatado: string
          diagnostico: string | null
          empresa_id: string
          fornecedor_externo: string | null
          id: string
          iniciada_em: string | null
          intervalo_preventivo_dias: number | null
          material_id: string
          modalidade_execucao: Database["public"]["Enums"]["equipment_maintenance_execution"]
          numero: string
          observacoes: string | null
          origem: Database["public"]["Enums"]["equipment_maintenance_origin"]
          payload_hash: string
          previsao_conclusao_em: string | null
          prioridade: Database["public"]["Enums"]["equipment_maintenance_priority"]
          proxima_preventiva_em: string | null
          quantidade_afetada: number
          responsavel_funcionario_id: string | null
          responsavel_nome: string | null
          responsavel_tipo:
            | Database["public"]["Enums"]["material_custody_responsible_type"]
            | null
          responsavel_usuario_id: string | null
          servico_executado: string | null
          status: Database["public"]["Enums"]["equipment_maintenance_status"]
          tipo: Database["public"]["Enums"]["equipment_maintenance_type"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "manutencao_ordens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      deactivate_trial_modules: {
        Args: { _empresa_id: string }
        Returns: undefined
      }
      detach_company_user: {
        Args: {
          _actor_id: string
          _empresa_id?: string
          _target_user_id: string
        }
        Returns: Json
      }
      employee_belongs_to_company: {
        Args: { _empresa_id: string; _funcionario_id: string }
        Returns: boolean
      }
      equipment_active_maintenance_quantity: {
        Args: {
          _company_id: string
          _exclude_order_id?: string
          _material_id: string
        }
        Returns: number
      }
      equipment_maintenance_transition_allowed: {
        Args: {
          _from: Database["public"]["Enums"]["equipment_maintenance_status"]
          _to: Database["public"]["Enums"]["equipment_maintenance_status"]
        }
        Returns: boolean
      }
      estornar_movimentacao_estoque: {
        Args: {
          _client_uuid: string
          _data_efetiva?: string
          _empresa_id?: string
          _justificativa: string
          _movimentacao_id: string
        }
        Returns: {
          client_uuid: string
          created_at: string
          created_by: string
          data_efetiva: string
          documento_referencia: string | null
          empresa_id: string
          id: string
          justificativa: string | null
          localizacao_destino_id: string | null
          localizacao_origem_id: string | null
          material_id: string
          motivo: string | null
          movimentacao_estornada_id: string | null
          observacao: string | null
          origem_id: string | null
          origem_modulo: Database["public"]["Enums"]["estoque_origem_modulo"]
          payload_hash: string
          quantidade: number
          saldo_destino_anterior: number | null
          saldo_destino_posterior: number | null
          saldo_origem_anterior: number | null
          saldo_origem_posterior: number | null
          saldo_total_anterior: number
          saldo_total_posterior: number
          tipo_movimentacao: Database["public"]["Enums"]["estoque_movimentacao_tipo"]
        }
        SetofOptions: {
          from: "*"
          to: "estoque_movimentacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      estornar_recebimento_locacao: {
        Args: {
          _client_uuid: string
          _empresa_id?: string
          _justificativa: string
          _recebimento_id: string
          _valor?: number
        }
        Returns: {
          cliente_id: string | null
          created_at: string
          created_by: string | null
          descricao: string | null
          empresa_id: string
          forma_cobranca: string
          forma_pagamento: string | null
          id: string
          observacoes: string | null
          origem_id: string
          origem_tipo: string
          status: string
          tipo: string
          updated_at: string
          updated_by: string | null
          valor_estornado: number
          valor_original: number
          valor_recebido: number
          vencimento: string | null
        }
        SetofOptions: {
          from: "*"
          to: "financeiro_lancamentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      event_belongs_to_company: {
        Args: { _empresa_id: string; _event_id: string }
        Returns: boolean
      }
      event_day_belongs_to_event: {
        Args: { _empresa_id: string; _event_day_id: string; _event_id: string }
        Returns: boolean
      }
      finalize_user_auth_deletion: {
        Args: { _audit_id: string; _error?: string; _success: boolean }
        Returns: undefined
      }
      financeiro_status_from_valores: {
        Args: {
          _cancelado: boolean
          _valor_estornado: number
          _valor_original: number
          _valor_recebido: number
        }
        Returns: string
      }
      generate_material_barcode: {
        Args: { _material_id: string }
        Returns: string
      }
      generate_material_qr_code: {
        Args: { _material_id: string }
        Returns: string
      }
      get_canonical_empresa_perfil: {
        Args: { _user_id: string }
        Returns: string
      }
      get_self_registration_auth_state: {
        Args: { _email: string }
        Returns: {
          email_confirmed_at: string
          registration_source: string
          user_id: string
        }[]
      }
      get_user_empresa_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inativar_modelo_etiqueta: {
        Args: {
          _empresa_id?: string
          _expected_updated_at: string
          _modelo_id: string
        }
        Returns: boolean
      }
      is_master_admin: { Args: { _user_id: string }; Returns: boolean }
      is_valid_company_logo_path: { Args: { _path: string }; Returns: boolean }
      is_valid_event_storage_path: {
        Args: { _file_path: string }
        Returns: boolean
      }
      is_valid_material_photo_path: {
        Args: { _file_path: string }
        Returns: boolean
      }
      list_user_module_permissions: {
        Args: { _empresa_id: string; _user_id?: string }
        Returns: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_view: boolean
          feature_key: string
          module_nome: string
        }[]
      }
      listar_clientes: {
        Args: {
          _busca?: string
          _empresa_id?: string
          _limite?: number
          _somente_ativos?: boolean
        }
        Returns: {
          ativo: boolean
          cpf_cnpj: string | null
          created_at: string
          created_by: string
          email: string | null
          empresa_id: string
          id: string
          nome: string
          nome_fantasia: string | null
          observacoes: string | null
          telefone: string | null
          tipo_pessoa: Database["public"]["Enums"]["customer_person_type"]
          updated_at: string
          updated_by: string
        }[]
        SetofOptions: {
          from: "*"
          to: "clientes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      listar_clientes_a_receber: {
        Args: { _empresa_id?: string }
        Returns: {
          cliente_id: string
          cliente_nome: string
          cliente_nome_fantasia: string
          proximo_vencimento: string
          quantidade_titulos: number
          total_devido: number
          total_pendente_regularizacao: number
          total_vencido: number
        }[]
      }
      listar_contas_receber: {
        Args: {
          _busca?: string
          _empresa_id?: string
          _pagina?: number
          _por_pagina?: number
          _somente_revisao?: boolean
          _somente_vencidos?: boolean
          _status?: string
        }
        Returns: {
          item: Json
          total_count: number
        }[]
      }
      listar_custodias_materiais: {
        Args: {
          _busca?: string
          _data_fim?: string
          _data_inicio?: string
          _empresa_id?: string
          _executor_id?: string
          _finalidade?: string
          _localizacao_id?: string
          _pagina?: number
          _responsavel?: string
          _somente_abertas?: boolean
          _status?: string
          _tamanho_pagina?: number
        }
        Returns: {
          item: Json
          total_count: number
        }[]
      }
      listar_despesas_manutencao: {
        Args: {
          _busca?: string
          _empresa_id?: string
          _pagina?: number
          _por_pagina?: number
        }
        Returns: {
          item: Json
          total_count: number
        }[]
      }
      listar_estoque_resumo: {
        Args: {
          _ativo?: string
          _busca?: string
          _categoria_id?: string
          _empresa_id?: string
          _filtro_saldo?: string
          _localizacao_id?: string
          _pagina?: number
          _tamanho_pagina?: number
          _tipo_controle?: string
        }
        Returns: {
          material: Json
          saldos: Json
          total_count: number
        }[]
      }
      listar_eventos_custodia: {
        Args: { _custodia_id: string; _empresa_id?: string }
        Returns: {
          item: Json
        }[]
      }
      listar_eventos_para_locacao: {
        Args: { _busca?: string; _empresa_id?: string; _limite?: number }
        Returns: {
          item: Json
        }[]
      }
      listar_historico_impressoes_etiqueta: {
        Args: {
          _empresa_id?: string
          _material_id?: string
          _pagina?: number
          _por_pagina?: number
        }
        Returns: {
          item: Json
          total_count: number
        }[]
      }
      listar_locacoes_materiais: {
        Args: {
          _busca?: string
          _cliente_id?: string
          _empresa_id?: string
          _fim?: string
          _inicio?: string
          _pagina?: number
          _por_pagina?: number
          _responsavel?: string
          _somente_atrasadas?: boolean
          _status?: string
        }
        Returns: {
          item: Json
          total_count: number
        }[]
      }
      listar_modelos_etiqueta: {
        Args: { _empresa_id?: string }
        Returns: Json[]
      }
      listar_ordens_manutencao: {
        Args: {
          _busca?: string
          _empresa_id?: string
          _fim?: string
          _inicio?: string
          _material_id?: string
          _pagina?: number
          _por_pagina?: number
          _prioridade?: string
          _responsavel?: string
          _status?: string
          _tipo?: string
        }
        Returns: {
          item: Json
          total_count: number
        }[]
      }
      listar_responsaveis_custodia: {
        Args: { _empresa_id?: string }
        Returns: {
          detalhe: string
          id: string
          nome: string
          tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
        }[]
      }
      marcar_locacao_pronta_retirada: {
        Args: {
          _client_uuid: string
          _empresa_id?: string
          _locacao_id: string
        }
        Returns: {
          client_uuid: string
          cliente_id: string
          contrato_referencia_id: string | null
          created_at: string
          created_by: string
          desconto: number
          devolucao_prevista_em: string
          empresa_id: string
          encerrada_em: string | null
          evento_id: string | null
          financeiro_lancamento_id: string | null
          id: string
          iniciada_em: string | null
          numero: string
          observacoes: string | null
          orcamento_referencia_id: string | null
          payload_hash: string
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_prevista_em: string
          status: Database["public"]["Enums"]["material_rental_status"]
          updated_at: string
          updated_by: string
          valor_bruto: number
          valor_total: number
        }
        SetofOptions: {
          from: "*"
          to: "material_locacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      master_provision_company_module_entitlements: {
        Args: { _empresa_id: string }
        Returns: undefined
      }
      registrar_baixa_custodia_material: {
        Args: {
          _classificacao: string
          _client_uuid: string
          _custodia_id: string
          _data_efetiva?: string
          _empresa_id?: string
          _justificativa: string
          _observacao?: string
          _quantidade: number
        }
        Returns: Database["public"]["Tables"]["material_custodias"]["Row"]
        SetofOptions: {
          from: "*"
          to: "material_custodias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      master_approve_module_batch_request: {
        Args: { _batch_request_id: string; _observacao_admin?: string | null }
        Returns: Json
      }
      master_approve_module_payment: {
        Args: { _observacao_admin?: string | null; _payment_id: string }
        Returns: Json
      }
      master_approve_module_request: {
        Args: { _observacao?: string | null; _request_id: string }
        Returns: Json
      }
      master_set_company_plan: {
        Args: {
          _empresa_id: string
          _plano_id: string
          _renew_trial?: boolean
          _status?: string
          _vencimento?: string | null
        }
        Returns: Json
      }
      master_set_user_role: {
        Args: {
          _empresa_id: string | null
          _full_name: string
          _role: string
          _target_user_id: string
        }
        Returns: Json
      }
      material_is_operationally_available: {
        Args: { _company_id: string; _material_id: string }
        Returns: boolean
      }
      material_label_batch_json: {
        Args: { _company_id: string; _request_id: string }
        Returns: Json
      }
      material_rental_availability: {
        Args: {
          _company_id: string
          _end_at: string
          _exclude_rental_id?: string
          _material_id: string
          _start_at: string
        }
        Returns: {
          disponivel: number
          estoque_fisico: number
          reservado: number
        }[]
      }
      material_rental_item_operational_totals: {
        Args: { _item_id: string }
        Returns: {
          com_cliente: number
          devolvida: number
          retirada: number
        }[]
      }
      next_equipment_maintenance_number: {
        Args: { _at?: string; _company_id: string }
        Returns: string
      }
      next_material_rental_number: {
        Args: { _at: string; _company_id: string }
        Returns: string
      }
      obter_configuracoes_impressora: {
        Args: { _empresa_id?: string }
        Returns: {
          altura_mm: number | null
          ativo: boolean
          configuracoes: Json
          created_at: string
          created_by: string | null
          empresa_id: string
          finalidade: string
          formato: string | null
          id: string
          largura_mm: number | null
          nome_impressora: string | null
          orientacao: string
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "empresa_impressora_config"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      obter_financeiro_locacao: {
        Args: { _empresa_id?: string; _locacao_id: string }
        Returns: Json
      }
      obter_indicadores_custodia: {
        Args: { _empresa_id?: string }
        Returns: Json
      }
      obter_indicadores_etiquetas: {
        Args: { _empresa_id?: string }
        Returns: Json
      }
      obter_indicadores_locacoes: {
        Args: { _empresa_id?: string }
        Returns: Json
      }
      obter_indicadores_manutencao: {
        Args: { _empresa_id?: string }
        Returns: Json
      }
      obter_locacao_material: {
        Args: { _empresa_id?: string; _locacao_id: string }
        Returns: Json
      }
      obter_ordem_manutencao: {
        Args: { _empresa_id?: string; _ordem_id: string }
        Returns: Json
      }
      obter_resumo_financeiro_locacoes: {
        Args: { _empresa_id?: string }
        Returns: {
          valor_a_receber: number
          valor_contratado: number
          valor_pendente_regularizacao: number
          valor_recebido: number
          valor_vencido: number
        }[]
      }
      obter_resumo_financeiro_manutencoes: {
        Args: { _empresa_id?: string }
        Returns: {
          quantidade_ordens: number
          valor_total: number
        }[]
      }
      obter_resumo_manutencao_material: {
        Args: { _empresa_id?: string; _material_id: string }
        Returns: Json
      }
      obter_solicitacao_impressao_etiqueta: {
        Args: { _empresa_id?: string; _solicitacao_id: string }
        Returns: Json
      }
      obter_sugestao_manutencao_checkin: {
        Args: { _custodia_id: string; _empresa_id?: string }
        Returns: Json
      }
      prepare_asaas_charge: {
        Args: { _actor_id: string; _module_id?: string; _plan_id?: string }
        Returns: Json
      }
      process_asaas_payment_webhook: {
        Args: {
          _asaas_payment_id: string
          _event_created_at?: string
          _event_id: string
          _event_type: string
          _external_reference?: string
          _provider_amount: number
        }
        Returns: Json
      }
      provision_company_module_entitlements: {
        Args: { _empresa_id: string }
        Returns: undefined
      }
      recalculate_material_rental_totals: {
        Args: { _company_id: string; _rental_id: string }
        Returns: undefined
      }
      registrar_checkin_material: {
        Args: {
          _client_uuid: string
          _condicao_retorno: string
          _custodia_id: string
          _data_efetiva?: string
          _empresa_id?: string
          _localizacao_destino_id: string
          _observacao?: string
          _ocorrencia?: string
          _quantidade: number
        }
        Returns: {
          client_uuid: string
          condicao_saida: Database["public"]["Enums"]["material_custody_condition"]
          created_at: string
          empresa_id: string
          encerrada_em: string | null
          executado_por: string
          finalidade: Database["public"]["Enums"]["material_custody_purpose"]
          id: string
          localizacao_origem_id: string
          material_id: string
          movimento_saida_id: string
          observacao_saida: string | null
          payload_hash: string
          previsao_retorno: string | null
          quantidade_devolvida: number
          quantidade_retirada: number
          referencia_id: string | null
          referencia_tipo: string | null
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_em: string
          status: Database["public"]["Enums"]["material_custody_status"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "material_custodias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_checkout_material: {
        Args: {
          _client_uuid: string
          _condicao_saida: string
          _data_efetiva?: string
          _empresa_id?: string
          _finalidade: string
          _localizacao_origem_id: string
          _material_id: string
          _observacao?: string
          _previsao_retorno?: string
          _quantidade: number
          _referencia_id?: string
          _referencia_tipo?: string
          _responsavel_id: string
          _responsavel_tipo: string
        }
        Returns: {
          client_uuid: string
          condicao_saida: Database["public"]["Enums"]["material_custody_condition"]
          created_at: string
          empresa_id: string
          encerrada_em: string | null
          executado_por: string
          finalidade: Database["public"]["Enums"]["material_custody_purpose"]
          id: string
          localizacao_origem_id: string
          material_id: string
          movimento_saida_id: string
          observacao_saida: string | null
          payload_hash: string
          previsao_retorno: string | null
          quantidade_devolvida: number
          quantidade_retirada: number
          referencia_id: string | null
          referencia_tipo: string | null
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_em: string
          status: Database["public"]["Enums"]["material_custody_status"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "material_custodias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_devolucao_locacao_material: {
        Args: {
          _client_uuid: string
          _condicao_retorno: string
          _custodia_id: string
          _data_efetiva?: string
          _empresa_id?: string
          _locacao_id: string
          _localizacao_destino_id: string
          _observacao?: string
          _ocorrencia?: string
          _quantidade: number
        }
        Returns: {
          client_uuid: string
          condicao_saida: Database["public"]["Enums"]["material_custody_condition"]
          created_at: string
          empresa_id: string
          encerrada_em: string | null
          executado_por: string
          finalidade: Database["public"]["Enums"]["material_custody_purpose"]
          id: string
          localizacao_origem_id: string
          material_id: string
          movimento_saida_id: string
          observacao_saida: string | null
          payload_hash: string
          previsao_retorno: string | null
          quantidade_devolvida: number
          quantidade_retirada: number
          referencia_id: string | null
          referencia_tipo: string | null
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_em: string
          status: Database["public"]["Enums"]["material_custody_status"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "material_custodias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_movimentacao_estoque: {
        Args: {
          _client_uuid: string
          _data_efetiva?: string
          _documento_referencia?: string
          _empresa_id?: string
          _localizacao_destino_id?: string
          _localizacao_origem_id?: string
          _material_id: string
          _motivo?: string
          _observacao?: string
          _origem_id?: string
          _origem_modulo?: string
          _quantidade: number
          _tipo: string
        }
        Returns: {
          client_uuid: string
          created_at: string
          created_by: string
          data_efetiva: string
          documento_referencia: string | null
          empresa_id: string
          id: string
          justificativa: string | null
          localizacao_destino_id: string | null
          localizacao_origem_id: string | null
          material_id: string
          motivo: string | null
          movimentacao_estornada_id: string | null
          observacao: string | null
          origem_id: string | null
          origem_modulo: Database["public"]["Enums"]["estoque_origem_modulo"]
          payload_hash: string
          quantidade: number
          saldo_destino_anterior: number | null
          saldo_destino_posterior: number | null
          saldo_origem_anterior: number | null
          saldo_origem_posterior: number | null
          saldo_total_anterior: number
          saldo_total_posterior: number
          tipo_movimentacao: Database["public"]["Enums"]["estoque_movimentacao_tipo"]
        }
        SetofOptions: {
          from: "*"
          to: "estoque_movimentacoes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_recebimento_locacao: {
        Args: {
          _client_uuid: string
          _data_recebimento?: string
          _empresa_id?: string
          _forma_pagamento: string
          _locacao_id: string
          _observacao?: string
          _parcela_id?: string
          _valor: number
        }
        Returns: {
          cliente_id: string | null
          created_at: string
          created_by: string | null
          descricao: string | null
          empresa_id: string
          forma_cobranca: string
          forma_pagamento: string | null
          id: string
          observacoes: string | null
          origem_id: string
          origem_tipo: string
          status: string
          tipo: string
          updated_at: string
          updated_by: string | null
          valor_estornado: number
          valor_original: number
          valor_recebido: number
          vencimento: string | null
        }
        SetofOptions: {
          from: "*"
          to: "financeiro_lancamentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_retirada_locacao_material: {
        Args: {
          _client_uuid: string
          _condicao_saida: string
          _data_efetiva?: string
          _empresa_id?: string
          _item_id: string
          _locacao_id: string
          _localizacao_origem_id: string
          _observacao?: string
          _quantidade: number
          _responsavel_id: string
          _responsavel_tipo: string
        }
        Returns: {
          client_uuid: string
          condicao_saida: Database["public"]["Enums"]["material_custody_condition"]
          created_at: string
          empresa_id: string
          encerrada_em: string | null
          executado_por: string
          finalidade: Database["public"]["Enums"]["material_custody_purpose"]
          id: string
          localizacao_origem_id: string
          material_id: string
          movimento_saida_id: string
          observacao_saida: string | null
          payload_hash: string
          previsao_retorno: string | null
          quantidade_devolvida: number
          quantidade_retirada: number
          referencia_id: string | null
          referencia_tipo: string | null
          responsavel_funcionario_id: string | null
          responsavel_nome: string
          responsavel_tipo: Database["public"]["Enums"]["material_custody_responsible_type"]
          responsavel_usuario_id: string | null
          retirada_em: string
          status: Database["public"]["Enums"]["material_custody_status"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "material_custodias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_solicitacao_impressao_etiqueta: {
        Args: {
          _client_uuid: string
          _empresa_id?: string
          _material_id: string
          _modelo_id: string
          _quantidade: number
          _reimpressao_de_id?: string
        }
        Returns: Json
      }
      registrar_solicitacao_impressao_lote_etiquetas: {
        Args: {
          _client_uuid: string
          _empresa_id?: string
          _expected_model_updated_at?: string
          _itens: Json
          _modelo_id: string
          _reimpressao_de_id?: string
        }
        Returns: Json
      }
      remover_insumo_ordem_manutencao: {
        Args: {
          _client_uuid: string
          _empresa_id?: string
          _insumo_id: string
          _justificativa: string
          _ordem_id: string
        }
        Returns: boolean
      }
      remover_item_locacao_material: {
        Args: {
          _client_uuid: string
          _empresa_id?: string
          _item_id: string
          _locacao_id: string
        }
        Returns: boolean
      }
      resolve_custody_company: {
        Args: { _requested_company_id: string; _write: boolean }
        Returns: string
      }
      resolve_custody_responsible_name: {
        Args: {
          _company_id: string
          _responsible_id: string
          _responsible_type: Database["public"]["Enums"]["material_custody_responsible_type"]
        }
        Returns: string
      }
      resolve_equipment_maintenance_company: {
        Args: { _requested_company_id: string; _write: boolean }
        Returns: string
      }
      resolve_equipment_maintenance_responsible: {
        Args: {
          _company_id: string
          _responsible_id: string
          _responsible_type: Database["public"]["Enums"]["material_custody_responsible_type"]
        }
        Returns: string
      }
      resolve_financial_company: {
        Args: { _requested_company_id: string; _write: boolean }
        Returns: string
      }
      resolve_material_labels_company: {
        Args: { _requested_company_id: string; _write: boolean }
        Returns: string
      }
      resolve_material_rental_company: {
        Args: { _requested_company_id: string; _write: boolean }
        Returns: string
      }
      resolve_stock_company: {
        Args: { _requested_company_id: string; _write: boolean }
        Returns: string
      }
      restore_company_backup: {
        Args: { _empresa_id: string; _payload: Json }
        Returns: Json
      }
      gather_company_backup_data: {
        Args: {
          _date_end?: string | null
          _date_start?: string | null
          _empresa_id: string
        }
        Returns: Json
      }
      request_company_module_batch: {
        Args: { _module_ids: string[]; _observacao?: string | null }
        Returns: Json
      }
      salvar_cliente: {
        Args: {
          _cliente_id?: string
          _cpf_cnpj?: string
          _email?: string
          _empresa_id?: string
          _nome: string
          _nome_fantasia?: string
          _observacoes?: string
          _telefone?: string
          _tipo_pessoa: string
        }
        Returns: {
          ativo: boolean
          cpf_cnpj: string | null
          created_at: string
          created_by: string
          email: string | null
          empresa_id: string
          id: string
          nome: string
          nome_fantasia: string | null
          observacoes: string | null
          telefone: string | null
          tipo_pessoa: Database["public"]["Enums"]["customer_person_type"]
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "clientes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      salvar_configuracao_impressora: {
        Args: {
          _altura_mm?: number
          _ativo?: boolean
          _configuracoes?: Json
          _empresa_id?: string
          _finalidade: string
          _formato?: string
          _largura_mm?: number
          _nome_impressora?: string
          _orientacao?: string
        }
        Returns: {
          altura_mm: number | null
          ativo: boolean
          configuracoes: Json
          created_at: string
          created_by: string | null
          empresa_id: string
          finalidade: string
          formato: string | null
          id: string
          largura_mm: number | null
          nome_impressora: string | null
          orientacao: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "empresa_impressora_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      salvar_insumo_ordem_manutencao: {
        Args: {
          _client_uuid: string
          _custo_unitario: number
          _descricao: string
          _empresa_id?: string
          _material_id?: string
          _ordem_id: string
          _quantidade: number
          _unidade: string
        }
        Returns: {
          created_at: string
          created_by: string
          custo_total: number | null
          custo_unitario: number
          descricao: string
          empresa_id: string
          id: string
          material_id: string | null
          ordem_id: string
          quantidade: number
          unidade: string
        }
        SetofOptions: {
          from: "*"
          to: "manutencao_ordem_insumos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      salvar_item_locacao_material: {
        Args: {
          _client_uuid: string
          _desconto: number
          _empresa_id?: string
          _item_id?: string
          _locacao_id: string
          _material_id: string
          _modalidade_cobranca: string
          _observacoes?: string
          _quantidade: number
          _unidades_cobranca: number
          _valor_unitario: number
        }
        Returns: {
          created_at: string
          desconto: number
          empresa_id: string
          id: string
          locacao_id: string
          material_id: string
          modalidade_cobranca: Database["public"]["Enums"]["material_rental_billing_mode"]
          observacoes: string | null
          quantidade_contratada: number
          subtotal: number | null
          unidades_cobranca: number
          updated_at: string
          valor_unitario: number
        }
        SetofOptions: {
          from: "*"
          to: "material_locacao_itens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      salvar_modelo_etiqueta: {
        Args: {
          _altura_mm: number
          _campos: Json
          _descricao?: string
          _empresa_id?: string
          _expected_updated_at?: string
          _largura_mm: number
          _modelo_id?: string
          _mostrar_borda?: boolean
          _nome: string
          _padrao?: boolean
          _tamanho_fonte?: number
          _tipo_identificacao: string
        }
        Returns: Json
      }
      salvar_modelo_etiqueta_v2: {
        Args: {
          _altura_mm: number
          _campos: Json
          _descricao?: string
          _empresa_id?: string
          _espacamento_interno_mm?: number
          _expected_updated_at?: string
          _largura_mm: number
          _margem_interna_mm?: number
          _modelo_id?: string
          _mostrar_borda?: boolean
          _nome: string
          _padrao?: boolean
          _tamanho_fonte?: number
          _tipo_identificacao: string
        }
        Returns: Json
      }
      set_company_lifetime_subscription: {
        Args: { _empresa_id: string; _status?: string }
        Returns: Json
      }
      set_user_module_permissions: {
        Args: { _empresa_id: string; _permissions: Json; _user_id: string }
        Returns: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_view: boolean
          created_at: string
          empresa_id: string
          feature_key: string
          granted_by: string | null
          id: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "user_module_permissions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      sync_equipment_maintenance_financial_entry: {
        Args: { _company_id: string; _ordem_id: string }
        Returns: undefined
      }
      sync_material_rental_financial_entry: {
        Args: {
          _company_id: string
          _forma_cobranca?: string
          _locacao_id: string
          _parcelas?: Json
          _vencimento?: string
        }
        Returns: undefined
      }
      sync_material_rental_status: {
        Args: { _company_id: string; _locacao_id: string }
        Returns: undefined
      }
      template_belongs_to_company: {
        Args: { _empresa_id: string; _template_id: string }
        Returns: boolean
      }
      transicionar_ordem_manutencao: {
        Args: {
          _client_uuid: string
          _data_efetiva?: string
          _empresa_id?: string
          _expected_updated_at: string
          _justificativa?: string
          _novo_status: string
          _ordem_id: string
        }
        Returns: {
          aberta_em: string
          cancelada_em: string | null
          client_uuid: string
          concluida_em: string | null
          condicao_entrada: string | null
          condicao_saida: string | null
          created_at: string
          created_by: string
          custo_mao_obra: number
          custo_outros: number
          custo_pecas: number
          custo_total: number | null
          custodia_evento_origem_id: string | null
          defeito_relatado: string
          diagnostico: string | null
          empresa_id: string
          fornecedor_externo: string | null
          id: string
          iniciada_em: string | null
          intervalo_preventivo_dias: number | null
          material_id: string
          modalidade_execucao: Database["public"]["Enums"]["equipment_maintenance_execution"]
          numero: string
          observacoes: string | null
          origem: Database["public"]["Enums"]["equipment_maintenance_origin"]
          payload_hash: string
          previsao_conclusao_em: string | null
          prioridade: Database["public"]["Enums"]["equipment_maintenance_priority"]
          proxima_preventiva_em: string | null
          quantidade_afetada: number
          responsavel_funcionario_id: string | null
          responsavel_nome: string | null
          responsavel_tipo:
            | Database["public"]["Enums"]["material_custody_responsible_type"]
            | null
          responsavel_usuario_id: string | null
          servico_executado: string | null
          status: Database["public"]["Enums"]["equipment_maintenance_status"]
          tipo: Database["public"]["Enums"]["equipment_maintenance_type"]
          tipo_controle: Database["public"]["Enums"]["material_control_type"]
          updated_at: string
          updated_by: string
        }
        SetofOptions: {
          from: "*"
          to: "manutencao_ordens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_has_module_action: {
        Args: { _action: string; _empresa_id: string; _feature_key: string }
        Returns: boolean
      }
      validate_material_label_fields: { Args: { _fields: Json }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "user" | "master_admin" | "admin_empresa" | "usuario"
      customer_person_type: "pessoa_fisica" | "pessoa_juridica"
      equipment_maintenance_event_type:
        | "criacao"
        | "edicao"
        | "mudanca_status"
        | "diagnostico"
        | "inicio"
        | "conclusao"
        | "cancelamento"
        | "insumo_adicionado"
        | "insumo_removido"
      equipment_maintenance_execution: "interna" | "externa"
      equipment_maintenance_origin:
        | "manual"
        | "checkin"
        | "inspecao"
        | "preventiva"
        | "defeito_operacional"
      equipment_maintenance_priority: "baixa" | "normal" | "alta" | "critica"
      equipment_maintenance_status:
        | "aberta"
        | "aguardando_analise"
        | "em_manutencao"
        | "aguardando_peca"
        | "concluida"
        | "cancelada"
      equipment_maintenance_type: "corretiva" | "preventiva" | "inspecao"
      estoque_localizacao_tipo:
        | "deposito"
        | "almoxarifado"
        | "sala"
        | "veiculo"
        | "estrutura"
        | "area_tecnica"
        | "outra"
      estoque_movimentacao_tipo:
        | "entrada"
        | "saida"
        | "transferencia"
        | "ajuste_positivo"
        | "ajuste_negativo"
        | "saldo_inicial"
        | "estorno"
      estoque_origem_modulo:
        | "manual"
        | "controle_estoque"
        | "checkin_checkout"
        | "locacao_materiais"
        | "manutencao_equipamentos"
      event_status:
        | "confirmado"
        | "pendente"
        | "cancelado"
        | "em_negociacao"
        | "finalizado"
      file_type: "artist_rider" | "event_rider" | "material_list"
      material_control_type: "individual" | "quantidade"
      material_custody_condition:
        | "bom"
        | "com_avaria"
        | "danificado"
        | "manutencao_necessaria"
        | "incompleto"
      material_custody_event_type:
        | "checkout"
        | "checkin"
        | "cancelamento"
        | "correcao"
      material_custody_purpose:
        | "uso_interno"
        | "funcionario"
        | "evento"
        | "cliente"
        | "locacao"
        | "manutencao"
        | "transferencia_operacional"
        | "outro"
      material_custody_responsible_type: "usuario" | "funcionario"
      material_custody_status: "aberta" | "parcial" | "concluida" | "cancelada"
      material_identification_status: "nao_gerada" | "ativa" | "inativa"
      material_identification_type: "qr_code" | "codigo_barras" | "ambos"
      material_operational_status:
        | "disponivel"
        | "em_manutencao"
        | "avariado"
        | "extraviado"
        | "baixado"
      material_rental_billing_mode: "fixo" | "diaria" | "periodo" | "unidade"
      material_rental_event_type:
        | "criacao"
        | "edicao"
        | "reserva"
        | "pronta_retirada"
        | "retirada"
        | "devolucao"
        | "cancelamento"
        | "correcao"
        | "conclusao"
      material_rental_status:
        | "rascunho"
        | "reservada"
        | "pronta_retirada"
        | "em_andamento"
        | "parcialmente_devolvida"
        | "concluida"
        | "cancelada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "master_admin", "admin_empresa", "usuario"],
      customer_person_type: ["pessoa_fisica", "pessoa_juridica"],
      equipment_maintenance_event_type: [
        "criacao",
        "edicao",
        "mudanca_status",
        "diagnostico",
        "inicio",
        "conclusao",
        "cancelamento",
        "insumo_adicionado",
        "insumo_removido",
      ],
      equipment_maintenance_execution: ["interna", "externa"],
      equipment_maintenance_origin: [
        "manual",
        "checkin",
        "inspecao",
        "preventiva",
        "defeito_operacional",
      ],
      equipment_maintenance_priority: ["baixa", "normal", "alta", "critica"],
      equipment_maintenance_status: [
        "aberta",
        "aguardando_analise",
        "em_manutencao",
        "aguardando_peca",
        "concluida",
        "cancelada",
      ],
      equipment_maintenance_type: ["corretiva", "preventiva", "inspecao"],
      estoque_localizacao_tipo: [
        "deposito",
        "almoxarifado",
        "sala",
        "veiculo",
        "estrutura",
        "area_tecnica",
        "outra",
      ],
      estoque_movimentacao_tipo: [
        "entrada",
        "saida",
        "transferencia",
        "ajuste_positivo",
        "ajuste_negativo",
        "saldo_inicial",
        "estorno",
      ],
      estoque_origem_modulo: [
        "manual",
        "controle_estoque",
        "checkin_checkout",
        "locacao_materiais",
        "manutencao_equipamentos",
      ],
      event_status: [
        "confirmado",
        "pendente",
        "cancelado",
        "em_negociacao",
        "finalizado",
      ],
      file_type: ["artist_rider", "event_rider", "material_list"],
      material_control_type: ["individual", "quantidade"],
      material_custody_condition: [
        "bom",
        "com_avaria",
        "danificado",
        "manutencao_necessaria",
        "incompleto",
      ],
      material_custody_event_type: [
        "checkout",
        "checkin",
        "cancelamento",
        "correcao",
      ],
      material_custody_purpose: [
        "uso_interno",
        "funcionario",
        "evento",
        "cliente",
        "locacao",
        "manutencao",
        "transferencia_operacional",
        "outro",
      ],
      material_custody_responsible_type: ["usuario", "funcionario"],
      material_custody_status: ["aberta", "parcial", "concluida", "cancelada"],
      material_identification_status: ["nao_gerada", "ativa", "inativa"],
      material_identification_type: ["qr_code", "codigo_barras", "ambos"],
      material_operational_status: [
        "disponivel",
        "em_manutencao",
        "avariado",
        "extraviado",
        "baixado",
      ],
      material_rental_billing_mode: ["fixo", "diaria", "periodo", "unidade"],
      material_rental_event_type: [
        "criacao",
        "edicao",
        "reserva",
        "pronta_retirada",
        "retirada",
        "devolucao",
        "cancelamento",
        "correcao",
        "conclusao",
      ],
      material_rental_status: [
        "rascunho",
        "reservada",
        "pronta_retirada",
        "em_andamento",
        "parcialmente_devolvida",
        "concluida",
        "cancelada",
      ],
    },
  },
} as const
