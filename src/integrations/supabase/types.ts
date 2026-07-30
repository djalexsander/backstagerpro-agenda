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
    PostgrestVersion: "14.4"
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
          artist: string
          city: string
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
          show_time: string | null
          status: Database["public"]["Enums"]["event_status"]
          updated_at: string
          venue: string
        }
        Insert: {
          artist: string
          city: string
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
          show_time?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          updated_at?: string
          venue: string
        }
        Update: {
          artist?: string
          city?: string
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
          show_time?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          updated_at?: string
          venue?: string
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
          descricao?: string | null
          empresa_id?: string
          localizacao_pai_id?: string | null
          nome?: string
          tipo?: Database["public"]["Enums"]["estoque_localizacao_tipo"]
        }
        Relationships: []
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
        Insert: never
        Update: never
        Relationships: []
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
        Insert: never
        Update: never
        Relationships: []
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
            referencedRelation: "materiais"
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_read_company_module: {
        Args: { _empresa_id: string; _feature_key: string }
        Returns: boolean
      }
      can_write_company_module: {
        Args: { _empresa_id: string; _feature_key: string }
        Returns: boolean
      }
      choose_company_plan: {
        Args: {
          _actor_id: string
          _plan_id?: string | null
          _selection_type: string
        }
        Returns: Json
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
      get_self_registration_auth_state: {
        Args: { _email: string }
        Returns: {
          email_confirmed_at: string | null
          registration_source: string | null
          user_id: string
        }[]
      }
      deactivate_trial_modules: {
        Args: { _empresa_id: string }
        Returns: undefined
      }
      detach_company_user: {
        Args: {
          _actor_id: string
          _empresa_id?: string | null
          _target_user_id: string
        }
        Returns: Json
      }
      finalize_user_auth_deletion: {
        Args: {
          _audit_id: string
          _error?: string | null
          _success: boolean
        }
        Returns: undefined
      }
      get_user_empresa_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_master_admin: { Args: { _user_id: string }; Returns: boolean }
      company_has_lifetime_subscription: {
        Args: { _empresa_id: string }
        Returns: boolean
      }
      company_has_active_module: {
        Args: { _empresa_id: string; _feature_key: string }
        Returns: boolean
      }
      company_module_dependencies_satisfied: {
        Args: { _empresa_id: string; _module_id: string }
        Returns: boolean
      }
      generate_material_barcode: {
        Args: { _material_id: string }
        Returns: string
      }
      generate_material_qr_code: {
        Args: { _material_id: string }
        Returns: string
      }
      ajustar_estoque_material: {
        Args: {
          _client_uuid: string
          _data_efetiva?: string | null
          _empresa_id?: string | null
          _justificativa: string
          _localizacao_id: string
          _material_id: string
          _motivo: string
          _observacao?: string | null
          _quantidade_fisica: number
        }
        Returns: Database["public"]["Tables"]["estoque_movimentacoes"]["Row"]
      }
      estornar_movimentacao_estoque: {
        Args: {
          _client_uuid: string
          _data_efetiva?: string | null
          _empresa_id?: string | null
          _justificativa: string
          _movimentacao_id: string
        }
        Returns: Database["public"]["Tables"]["estoque_movimentacoes"]["Row"]
      }
      registrar_movimentacao_estoque: {
        Args: {
          _client_uuid: string
          _data_efetiva?: string | null
          _documento_referencia?: string | null
          _empresa_id?: string | null
          _localizacao_destino_id?: string | null
          _localizacao_origem_id?: string | null
          _material_id: string
          _motivo?: string | null
          _observacao?: string | null
          _origem_id?: string | null
          _origem_modulo?: string
          _quantidade: number
          _tipo: string
        }
        Returns: Database["public"]["Tables"]["estoque_movimentacoes"]["Row"]
      }
      listar_estoque_resumo: {
        Args: {
          _ativo?: string | null
          _busca?: string | null
          _categoria_id?: string | null
          _empresa_id?: string | null
          _filtro_saldo?: string | null
          _localizacao_id?: string | null
          _pagina?: number
          _tamanho_pagina?: number
          _tipo_controle?: string | null
        }
        Returns: {
          material: Json
          saldos: Json
          total_count: number
        }[]
      }
      prepare_asaas_charge: {
        Args: {
          _actor_id: string
          _module_id?: string | null
          _plan_id?: string | null
        }
        Returns: Json
      }
      process_asaas_payment_webhook: {
        Args: {
          _asaas_payment_id: string
          _event_created_at?: string | null
          _event_id: string
          _event_type: string
          _external_reference?: string | null
          _provider_amount: number
        }
        Returns: Json
      }
      set_company_lifetime_subscription: {
        Args: { _empresa_id: string }
        Returns: Json
      }
      user_owns_event_file: { Args: { file_path: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user" | "master_admin" | "admin_empresa" | "usuario"
      event_status:
        | "confirmado"
        | "pendente"
        | "cancelado"
        | "em_negociacao"
        | "finalizado"
      file_type: "artist_rider" | "event_rider" | "material_list"
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
      material_control_type: "individual" | "quantidade"
      material_identification_status: "nao_gerada" | "ativa" | "inativa"
      material_identification_type: "qr_code" | "codigo_barras" | "ambos"
      material_operational_status:
        | "disponivel"
        | "em_manutencao"
        | "avariado"
        | "extraviado"
        | "baixado"
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
      event_status: [
        "confirmado",
        "pendente",
        "cancelado",
        "em_negociacao",
        "finalizado",
      ],
      file_type: ["artist_rider", "event_rider", "material_list"],
      material_control_type: ["individual", "quantidade"],
      material_identification_status: ["nao_gerada", "ativa", "inativa"],
      material_identification_type: ["qr_code", "codigo_barras", "ambos"],
      material_operational_status: [
        "disponivel",
        "em_manutencao",
        "avariado",
        "extraviado",
        "baixado",
      ],
    },
  },
} as const
