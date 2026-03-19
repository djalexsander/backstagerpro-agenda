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
          status: string | null
          status_pagamento: string | null
          telefone: string | null
          trial_expires_at: string | null
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
          status?: string | null
          status_pagamento?: string | null
          telefone?: string | null
          trial_expires_at?: string | null
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
          status?: string | null
          status_pagamento?: string | null
          telefone?: string | null
          trial_expires_at?: string | null
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
          created_at: string
          descricao: string | null
          id: string
          max_eventos: number | null
          max_usuarios: number | null
          nome: string
          storage_limit: number | null
          trial_days: number
          updated_at: string
          valor: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          max_eventos?: number | null
          max_usuarios?: number | null
          nome: string
          storage_limit?: number | null
          trial_days?: number
          updated_at?: string
          valor?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          max_eventos?: number | null
          max_usuarios?: number | null
          nome?: string
          storage_limit?: number | null
          trial_days?: number
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ativado: boolean
          avatar_url: string | null
          created_at: string
          empresa_id: string | null
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ativado?: boolean
          avatar_url?: string | null
          created_at?: string
          empresa_id?: string | null
          full_name?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ativado?: boolean
          avatar_url?: string | null
          created_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_empresa_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_master_admin: { Args: { _user_id: string }; Returns: boolean }
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
    },
  },
} as const
