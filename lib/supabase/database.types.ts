// Generated from Supabase project "MVP". Regenerate after schema changes;
// do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type TransactionRow = {
  amount_cents: number
  authorized_at: string | null
  buyer_id: string
  cancel_reason: string | null
  canceled_at: string | null
  canceled_by: string | null
  created_at: string
  handoff_attempts: number
  handoff_code: string | null
  id: number
  listing_id: number
  meetup_at: string | null
  meetup_deadline: string | null
  meetup_spot_id: string | null
  picked_up_at: string | null
  platform_fee_cents: number
  proposed_times: string[] | null
  seller_id: string
  status: Database["public"]["Enums"]["transaction_status"]
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_transfer_id: string | null
  updated_at: string
}

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      areas: {
        Row: {
          city: string
          country: string
          id: string
          is_active: boolean
          lat: number
          lng: number
          name: string
          region: string
          sort_order: number
          timezone: string
        }
        Insert: {
          city: string
          country: string
          id: string
          is_active?: boolean
          lat: number
          lng: number
          name: string
          region: string
          sort_order?: number
          timezone: string
        }
        Update: {
          city?: string
          country?: string
          id?: string
          is_active?: boolean
          lat?: number
          lng?: number
          name?: string
          region?: string
          sort_order?: number
          timezone?: string
        }
        Relationships: []
      }
      bids: {
        Row: {
          amount_cents: number
          bidder_id: string
          created_at: string
          id: number
          listing_id: number
        }
        Insert: {
          amount_cents: number
          bidder_id: string
          created_at?: string
          id?: number
          listing_id: number
        }
        Update: {
          amount_cents?: number
          bidder_id?: string
          created_at?: string
          id?: number
          listing_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "bids_bidder_id_fkey"
            columns: ["bidder_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          area_id: string
          bid_count: number
          buy_now_price_cents: number | null
          created_at: string
          current_bid_cents: number | null
          description: string | null
          ends_at: string | null
          id: number
          image_paths: string[]
          listing_type: Database["public"]["Enums"]["listing_type"]
          seller_id: string
          starting_price_cents: number | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at: string
          winning_bid_id: number | null
        }
        Insert: {
          area_id: string
          bid_count?: number
          buy_now_price_cents?: number | null
          created_at?: string
          current_bid_cents?: number | null
          description?: string | null
          ends_at?: string | null
          id?: number
          image_paths?: string[]
          listing_type: Database["public"]["Enums"]["listing_type"]
          seller_id: string
          starting_price_cents?: number | null
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at?: string
          winning_bid_id?: number | null
        }
        Update: {
          area_id?: string
          bid_count?: number
          buy_now_price_cents?: number | null
          created_at?: string
          current_bid_cents?: number | null
          description?: string | null
          ends_at?: string | null
          id?: number
          image_paths?: string[]
          listing_type?: Database["public"]["Enums"]["listing_type"]
          seller_id?: string
          starting_price_cents?: number | null
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          updated_at?: string
          winning_bid_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_winning_bid_fk"
            columns: ["winning_bid_id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_spots: {
        Row: {
          address: string
          city: string
          country: string
          id: string
          is_active: boolean
          kind: string
          lat: number
          lng: number
          name: string
          notes: string | null
          region: string
          timezone: string
        }
        Insert: {
          address: string
          city: string
          country: string
          id: string
          is_active?: boolean
          kind: string
          lat: number
          lng: number
          name: string
          notes?: string | null
          region: string
          timezone: string
        }
        Update: {
          address?: string
          city?: string
          country?: string
          id?: string
          is_active?: boolean
          kind?: string
          lat?: number
          lng?: number
          name?: string
          notes?: string | null
          region?: string
          timezone?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: Json | null
          area_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_payouts_enabled: boolean
          updated_at: string
          username: string | null
          welcome_email_sent_at: string | null
        }
        Insert: {
          address?: Json | null
          area_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_payouts_enabled?: boolean
          updated_at?: string
          username?: string | null
          welcome_email_sent_at?: string | null
        }
        Update: {
          address?: Json | null
          area_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_payouts_enabled?: boolean
          updated_at?: string
          username?: string | null
          welcome_email_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: TransactionRow
        Insert: {
          amount_cents: number
          authorized_at?: string | null
          buyer_id: string
          cancel_reason?: string | null
          canceled_at?: string | null
          canceled_by?: string | null
          created_at?: string
          handoff_attempts?: number
          handoff_code?: string | null
          id?: number
          listing_id: number
          meetup_at?: string | null
          meetup_deadline?: string | null
          meetup_spot_id?: string | null
          picked_up_at?: string | null
          platform_fee_cents?: number
          proposed_times?: string[] | null
          seller_id: string
          status?: Database["public"]["Enums"]["transaction_status"]
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          updated_at?: string
        }
        Update: Partial<TransactionRow>
        Relationships: [
          {
            foreignKeyName: "transactions_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_canceled_by_fkey"
            columns: ["canceled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_meetup_spot_id_fkey"
            columns: ["meetup_spot_id"]
            isOneToOne: false
            referencedRelation: "meetup_spots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auction_work_pending: { Args: never; Returns: boolean }
      begin_purchase: {
        Args: { p_buyer_id: string; p_fee_bps: number; p_listing_id: number }
        Returns: TransactionRow
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_authorized_purchase: {
        Args: {
          p_buyer_id: string
          p_transaction_id: number
          p_window_seconds: number
        }
        Returns: string
      }
      cancel_order: {
        Args: { p_reason: string; p_transaction_id: number; p_user_id: string | null }
        Returns: string
      }
      cancel_pending_purchase: {
        Args: { p_transaction_id: number }
        Returns: undefined
      }
      check_handoff_code: {
        Args: { p_code: string; p_seller_id: string; p_transaction_id: number }
        Returns: boolean
      }
      choose_meetup_time: {
        Args: { p_time: string | null; p_transaction_id: number }
        Returns: undefined
      }
      close_auction: {
        Args: { p_fee_bps: number; p_listing_id: number }
        Returns: TransactionRow
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_order: {
        Args: { p_transaction_id: number; p_transfer_id: string | null }
        Returns: undefined
      }
      distance_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      expired_orders: { Args: never; Returns: number[] }
      get_handoff_code: { Args: { p_transaction_id: number }; Returns: string }
      listing_photos_ok: { Args: { p_paths: string[] }; Returns: boolean }
      order_party_names: {
        Args: { p_transaction_id: number }
        Returns: {
          buyer_first_name: string
          seller_first_name: string
        }[]
      }
      place_bid: {
        Args: { p_amount_cents: number; p_listing_id: number }
        Returns: {
          amount_cents: number
          bidder_id: string
          created_at: string
          id: number
          listing_id: number
        }
        SetofOptions: {
          from: "*"
          to: "bids"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      propose_meetup: {
        Args: { p_spot_id: string; p_times: string[]; p_transaction_id: number }
        Returns: undefined
      }
      release_stale_purchases: {
        Args: never
        Returns: {
          payment_intent_id: string | null
          transaction_id: number
        }[]
      }
      seller_can_receive_payouts: { Args: never; Returns: boolean }
      suggest_meetup_spots: {
        Args: { p_limit?: number; p_transaction_id: number }
        Returns: {
          address: string
          buyer_km: number
          id: string
          kind: string
          lat: number
          lng: number
          name: string
          notes: string | null
          seller_km: number
          timezone: string
        }[]
      }
    }
    Enums: {
      listing_status:
        | "active"
        | "sold"
        | "pending_pickup"
        | "complete"
        | "inactive"
        | "incomplete"
      listing_type: "auction" | "fixed"
      transaction_status:
        | "pending"
        | "authorized"
        | "dropped_off"
        | "completed"
        | "canceled"
        | "refunded"
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
    Enums: {
      listing_status: [
        "active",
        "sold",
        "pending_pickup",
        "complete",
        "inactive",
        "incomplete",
      ],
      listing_type: ["auction", "fixed"],
      transaction_status: [
        "pending",
        "authorized",
        "dropped_off",
        "completed",
        "canceled",
        "refunded",
      ],
    },
  },
} as const
