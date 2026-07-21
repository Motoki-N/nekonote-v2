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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_model_settings: {
        Row: {
          capability: string
          created_at: string
          id: string
          model_id: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          capability: string
          created_at?: string
          id?: string
          model_id: string
          provider: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          capability?: string
          created_at?: string
          id?: string
          model_id?: string
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_usage_logs: {
        Row: {
          created_at: string
          feature: string
          id: string
          input_tokens: number | null
          model_id: string
          output_tokens: number | null
          provider: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feature: string
          id?: string
          input_tokens?: number | null
          model_id: string
          output_tokens?: number | null
          provider: string
          user_id?: string
        }
        Update: {
          created_at?: string
          feature?: string
          id?: string
          input_tokens?: number | null
          model_id?: string
          output_tokens?: number | null
          provider?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          id: string
          note_id: string | null
          persona_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note_id?: string | null
          persona_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          note_id?: string | null
          persona_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_threads_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      illustrations: {
        Row: {
          created_at: string
          id: string
          kind: string
          project_id: string
          prompt: string
          reference_illustration_id: string | null
          request: Json
          storage_path: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          project_id: string
          prompt: string
          reference_illustration_id?: string | null
          request: Json
          storage_path: string
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          project_id?: string
          prompt?: string
          reference_illustration_id?: string | null
          request?: Json
          storage_path?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "illustrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "illustrations_reference_illustration_id_fkey"
            columns: ["reference_illustration_id"]
            isOneToOne: false
            referencedRelation: "illustrations"
            referencedColumns: ["id"]
          },
        ]
      }
      manuscript_links: {
        Row: {
          created_at: string
          file_path: string
          id: string
          last_reviewed_commit: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_path: string
          id?: string
          last_reviewed_commit?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_path?: string
          id?: string
          last_reviewed_commit?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manuscript_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      note_tags: {
        Row: {
          created_at: string
          note_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          note_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          note_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_tags_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      personas: {
        Row: {
          ai_capability: string
          created_at: string
          description: string
          id: string
          is_default: boolean
          name: string
          persona_type: string
          reference_scope: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_capability: string
          created_at?: string
          description: string
          id?: string
          is_default?: boolean
          name: string
          persona_type: string
          reference_scope: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_capability?: string
          created_at?: string
          description?: string
          id?: string
          is_default?: boolean
          name?: string
          persona_type?: string
          reference_scope?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          base_path: string | null
          created_at: string
          deadline: string | null
          event_name: string | null
          id: string
          repo: string | null
          schedule: Json | null
          status: string
          structure_status: string
          target_pages: number | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_path?: string | null
          created_at?: string
          deadline?: string | null
          event_name?: string | null
          id?: string
          repo?: string | null
          schedule?: Json | null
          status?: string
          structure_status?: string
          target_pages?: number | null
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          base_path?: string | null
          created_at?: string
          deadline?: string | null
          event_name?: string | null
          id?: string
          repo?: string | null
          schedule?: Json | null
          status?: string
          structure_status?: string
          target_pages?: number | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      proposal_notes: {
        Row: {
          created_at: string
          note_id: string
          proposal_id: string
        }
        Insert: {
          created_at?: string
          note_id: string
          proposal_id: string
        }
        Update: {
          created_at?: string
          note_id?: string
          proposal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_notes_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_notes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          content: string
          created_at: string
          genre: string | null
          id: string
          project_id: string
          status: string
          target_audience: string | null
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          genre?: string | null
          id?: string
          project_id: string
          status?: string
          target_audience?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          genre?: string | null
          id?: string
          project_id?: string
          status?: string
          target_audience?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      review_feedbacks: {
        Row: {
          content: string
          created_at: string
          id: string
          review_session_id: string
          updated_at: string
          user_response: string | null
          verdict: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          review_session_id: string
          updated_at?: string
          user_response?: string | null
          verdict?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          review_session_id?: string
          updated_at?: string
          user_response?: string | null
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_feedbacks_review_session_id_fkey"
            columns: ["review_session_id"]
            isOneToOne: false
            referencedRelation: "review_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      review_profiles: {
        Row: {
          created_at: string
          default_persona_id: string | null
          id: string
          is_default: boolean
          name: string
          prompt_template: string
          target_phase: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          default_persona_id?: string | null
          id?: string
          is_default?: boolean
          name: string
          prompt_template: string
          target_phase: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          default_persona_id?: string | null
          id?: string
          is_default?: boolean
          name?: string
          prompt_template?: string
          target_phase?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_profiles_default_persona_id_fkey"
            columns: ["default_persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      review_sessions: {
        Row: {
          created_at: string
          id: string
          persona_id: string | null
          project_id: string
          review_profile_id: string | null
          status: string
          target_ref: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          persona_id?: string | null
          project_id: string
          review_profile_id?: string | null
          status?: string
          target_ref?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          persona_id?: string | null
          project_id?: string
          review_profile_id?: string | null
          status?: string
          target_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_sessions_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_sessions_review_profile_id_fkey"
            columns: ["review_profile_id"]
            isOneToOne: false
            referencedRelation: "review_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      revision_suggestions: {
        Row: {
          committed_sha: string | null
          created_at: string
          granularity: string
          id: string
          manuscript_link_id: string
          original_text: string
          reason: string | null
          status: string
          suggested_text: string
          updated_at: string
        }
        Insert: {
          committed_sha?: string | null
          created_at?: string
          granularity: string
          id?: string
          manuscript_link_id: string
          original_text?: string
          reason?: string | null
          status?: string
          suggested_text?: string
          updated_at?: string
        }
        Update: {
          committed_sha?: string | null
          created_at?: string
          granularity?: string
          id?: string
          manuscript_link_id?: string
          original_text?: string
          reason?: string | null
          status?: string
          suggested_text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revision_suggestions_manuscript_link_id_fkey"
            columns: ["manuscript_link_id"]
            isOneToOne: false
            referencedRelation: "manuscript_links"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_notes: {
        Row: {
          created_at: string
          note_id: string
          scene_id: string
        }
        Insert: {
          created_at?: string
          note_id: string
          scene_id: string
        }
        Update: {
          created_at?: string
          note_id?: string
          scene_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_notes_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_notes_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          anchor: string | null
          content: string
          created_at: string
          emotion_end: string | null
          emotion_start: string | null
          id: string
          manuscript_path: string | null
          order_index: number
          part: string
          project_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          anchor?: string | null
          content?: string
          created_at?: string
          emotion_end?: string | null
          emotion_start?: string | null
          id?: string
          manuscript_path?: string | null
          order_index?: number
          part: string
          project_id: string
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          anchor?: string | null
          content?: string
          created_at?: string
          emotion_end?: string | null
          emotion_start?: string | null
          id?: string
          manuscript_path?: string | null
          order_index?: number
          part?: string
          project_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          id: string
          kind: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      templates: {
        Row: {
          content: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          tag_name: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          tag_name?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          tag_name?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          github_pat_ciphertext: string | null
          github_username: string | null
          selected_project_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          github_pat_ciphertext?: string | null
          github_username?: string | null
          selected_project_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          github_pat_ciphertext?: string | null
          github_username?: string | null
          selected_project_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_selected_project_id_fkey"
            columns: ["selected_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_progress: {
        Row: {
          created_at: string
          date: string
          id: string
          project_id: string
          total_chars: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          project_id: string
          total_chars?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          project_id?: string
          total_chars?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "writing_progress_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_usage_summary: {
        Args: { days: number }
        Returns: {
          call_count: number
          feature: string
          input_tokens: number
          model_id: string
          output_tokens: number
          provider: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
