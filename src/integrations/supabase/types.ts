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
      booking_requests: {
        Row: {
          access_token: string | null
          budget: number | null
          client_id: string | null
          created_at: string
          gallery_id: string | null
          id: string
          location: string | null
          message: string | null
          preferred_date: string | null
          requester_email: string
          requester_name: string | null
          shoot_type: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          budget?: number | null
          client_id?: string | null
          created_at?: string
          gallery_id?: string | null
          id?: string
          location?: string | null
          message?: string | null
          preferred_date?: string | null
          requester_email: string
          requester_name?: string | null
          shoot_type?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          budget?: number | null
          client_id?: string | null
          created_at?: string
          gallery_id?: string | null
          id?: string
          location?: string | null
          message?: string | null
          preferred_date?: string | null
          requester_email?: string
          requester_name?: string | null
          shoot_type?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
        ]
      }
      client_uploads: {
        Row: {
          booking_id: string | null
          client_id: string | null
          created_at: string
          filename: string
          id: string
          note: string | null
          storage_path: string
          uploader_email: string
          user_id: string | null
        }
        Insert: {
          booking_id?: string | null
          client_id?: string | null
          created_at?: string
          filename: string
          id?: string
          note?: string | null
          storage_path: string
          uploader_email: string
          user_id?: string | null
        }
        Update: {
          booking_id?: string | null
          client_id?: string | null
          created_at?: string
          filename?: string
          id?: string
          note?: string | null
          storage_path?: string
          uploader_email?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_uploads_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          org: string | null
          phone: string | null
          user_id: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          org?: string | null
          phone?: string | null
          user_id: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          org?: string | null
          phone?: string | null
          user_id?: string
        }
        Relationships: []
      }
      galleries: {
        Row: {
          client_id: string | null
          cover_path: string | null
          created_at: string
          downloads_enabled: boolean
          expires_at: string | null
          id: string
          message: string | null
          passcode: string | null
          shoot_id: string | null
          slug: string
          status: string
          title: string
          user_id: string
          view_count: number
        }
        Insert: {
          client_id?: string | null
          cover_path?: string | null
          created_at?: string
          downloads_enabled?: boolean
          expires_at?: string | null
          id?: string
          message?: string | null
          passcode?: string | null
          shoot_id?: string | null
          slug: string
          status?: string
          title: string
          user_id: string
          view_count?: number
        }
        Update: {
          client_id?: string | null
          cover_path?: string | null
          created_at?: string
          downloads_enabled?: boolean
          expires_at?: string | null
          id?: string
          message?: string | null
          passcode?: string | null
          shoot_id?: string | null
          slug?: string
          status?: string
          title?: string
          user_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "galleries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "galleries_shoot_id_fkey"
            columns: ["shoot_id"]
            isOneToOne: false
            referencedRelation: "shoots"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_favorites: {
        Row: {
          created_at: string
          gallery_id: string
          id: string
          note: string | null
          photo_id: string
          viewer: string
        }
        Insert: {
          created_at?: string
          gallery_id: string
          id?: string
          note?: string | null
          photo_id: string
          viewer?: string
        }
        Update: {
          created_at?: string
          gallery_id?: string
          id?: string
          note?: string | null
          photo_id?: string
          viewer?: string
        }
        Relationships: [
          {
            foreignKeyName: "gallery_favorites_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gallery_favorites_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "gallery_photos"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_photos: {
        Row: {
          created_at: string
          filename: string
          gallery_id: string
          height: number | null
          id: string
          sort_order: number
          storage_path: string
          user_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          filename: string
          gallery_id: string
          height?: number | null
          id?: string
          sort_order?: number
          storage_path: string
          user_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          filename?: string
          gallery_id?: string
          height?: number | null
          id?: string
          sort_order?: number
          storage_path?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gallery_photos_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          client_id: string | null
          created_at: string
          currency: string
          description: string | null
          due_date: string | null
          hosted_invoice_url: string | null
          id: string
          shoot_id: string | null
          status: string
          stripe_invoice_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          client_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          hosted_invoice_url?: string | null
          id?: string
          shoot_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          client_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          due_date?: string | null
          hosted_invoice_url?: string | null
          id?: string
          shoot_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_shoot_id_fkey"
            columns: ["shoot_id"]
            isOneToOne: false
            referencedRelation: "shoots"
            referencedColumns: ["id"]
          },
        ]
      }
      lightroom_sync: {
        Row: {
          direction: string
          frames: Json
          id: string
          kind: string
          updated_at: string
          workspace: string
        }
        Insert: {
          direction: string
          frames?: Json
          id?: string
          kind?: string
          updated_at?: string
          workspace: string
        }
        Update: {
          direction?: string
          frames?: Json
          id?: string
          kind?: string
          updated_at?: string
          workspace?: string
        }
        Relationships: []
      }
      lightroom_workspaces: {
        Row: {
          created_at: string
          token: string | null
          token_hash: string | null
          user_id: string
          workspace: string
        }
        Insert: {
          created_at?: string
          token?: string | null
          token_hash?: string | null
          user_id: string
          workspace: string
        }
        Update: {
          created_at?: string
          token?: string | null
          token_hash?: string | null
          user_id?: string
          workspace?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          stripe_account_id: string | null
          stripe_account_status: string
          studio_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          stripe_account_id?: string | null
          stripe_account_status?: string
          studio_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          stripe_account_id?: string | null
          stripe_account_status?: string
          studio_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shoots: {
        Row: {
          client_id: string | null
          created_at: string
          frames: number
          id: string
          keepers: number
          location: string | null
          name: string
          shoot_date: string | null
          status: string
          user_id: string
          work_minutes: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          frames?: number
          id?: string
          keepers?: number
          location?: string | null
          name: string
          shoot_date?: string | null
          status?: string
          user_id: string
          work_minutes?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          frames?: number
          id?: string
          keepers?: number
          location?: string | null
          name?: string
          shoot_date?: string | null
          status?: string
          user_id?: string
          work_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "shoots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      signups: {
        Row: {
          billing: string
          created_at: string
          email: string
          id: string
          plan: string
          studio: string | null
        }
        Insert: {
          billing?: string
          created_at?: string
          email: string
          id?: string
          plan?: string
          studio?: string | null
        }
        Update: {
          billing?: string
          created_at?: string
          email?: string
          id?: string
          plan?: string
          studio?: string | null
        }
        Relationships: []
      }
      stripe_oauth_states: {
        Row: {
          created_at: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          category: string
          client_id: string | null
          created_at: string
          description: string
          id: string
          kind: string
          occurred_on: string
          shoot_id: string | null
          source: string
          stripe_object_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          client_id?: string | null
          created_at?: string
          description: string
          id?: string
          kind: string
          occurred_on?: string
          shoot_id?: string | null
          source?: string
          stripe_object_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          client_id?: string | null
          created_at?: string
          description?: string
          id?: string
          kind?: string
          occurred_on?: string
          shoot_id?: string | null
          source?: string
          stripe_object_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shoot_id_fkey"
            columns: ["shoot_id"]
            isOneToOne: false
            referencedRelation: "shoots"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
