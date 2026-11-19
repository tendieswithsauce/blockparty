// Generated from Supabase project "MVP". Regenerate after schema changes;
// do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type ListingCondition = 'new' | 'like_new' | 'good' | 'fair' | 'for_parts'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type HandoffMethod = 'meetup' | 'pickup' | 'delivery'
export type ListingSort = 'newest' | 'relevance' | 'ending_soon' | 'price_low' | 'price_high'

type TransactionRow = {
  amount_cents: number
  authorized_at: string | null
  buyer_id: string
  cancel_reason: string | null
  canceled_at: string | null
  canceled_by: string | null
  created_at: string
  delivery_fee_cents: number
  fee_waived: boolean
  handoff_address: string | null
  handoff_attempts: number
  handoff_code: string | null
  handoff_method: HandoffMethod
  id: number
  listing_id: number
  meetup_at: string | null
  meetup_deadline: string | null
  meetup_spot_id: string | null
  payout_attempts: number
  picked_up_at: string | null
  platform_fee_cents: number
  proposal_note: string | null
  proposed_by: string | null
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
          bidder_no: number
          created_at: string
          id: number
          listing_id: number
        }
        Insert: {
          amount_cents: number
          bidder_id: string
          bidder_no?: number
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
      categories: {
        Row: { id: string; is_active: boolean; name: string; parent_id: string | null; sort_order: number }
        Insert: { id: string; is_active?: boolean; name: string; parent_id?: string | null; sort_order?: number }
        Update: { id?: string; is_active?: boolean; name?: string; parent_id?: string | null; sort_order?: number }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      charities: {
        Row: {
          approved_at: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          cra_city: string | null
          cra_legal_name: string | null
          cra_province: string | null
          description: string | null
          id: number
          name: string
          owner_id: string
          slug: string
          status: 'pending' | 'approved' | 'rejected' | 'suspended'
          website: string | null
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          cra_city?: string | null
          cra_legal_name?: string | null
          cra_province?: string | null
          description?: string | null
          id?: never
          name?: string
          owner_id?: string
          slug?: string
          status?: 'pending' | 'approved' | 'rejected' | 'suspended'
          website?: string | null
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          cra_city?: string | null
          cra_legal_name?: string | null
          cra_province?: string | null
          description?: string | null
          id?: never
          name?: string
          owner_id?: string
          slug?: string
          status?: 'pending' | 'approved' | 'rejected' | 'suspended'
          website?: string | null
        }
        Relationships: []
      }
      listing_reserves: {
        Row: { created_at: string; listing_id: number; reserve_cents: number }
        Insert: { created_at?: string; listing_id: number; reserve_cents: number }
        Update: { created_at?: string; listing_id?: number; reserve_cents?: number }
        Relationships: [
          {
            foreignKeyName: "listing_reserves_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
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
          category_id: string
          charity_id: number | null
          condition: ListingCondition
          converted_at: string | null
          created_at: string
          current_bid_cents: number | null
          description: string | null
          delivery_fee_cents: number | null
          delivery_km: number | null
          display_price_cents: number | null
          ends_at: string | null
          extensions: number
          has_reserve: boolean
          id: number
          image_paths: string[]
          listing_type: Database["public"]["Enums"]["listing_type"]
          moderated_by: string | null
          moderation_attempts: number
          moderation_checked_at: string | null
          moderation_reason: string | null
          offers_meetup: boolean
          offers_pickup: boolean
          reserve_met: boolean
          review_status: ReviewStatus
          search_vector: unknown
          seller_id: string
          silent: boolean
          starting_price_cents: number | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at: string
          watch_count: number
          winning_bid_id: number | null
        }
        Insert: {
          area_id: string
          bid_count?: number
          buy_now_price_cents?: number | null
          category_id: string
          charity_id?: number | null
          condition: ListingCondition
          converted_at?: string | null
          created_at?: string
          current_bid_cents?: number | null
          description?: string | null
          display_price_cents?: number | null
          ends_at?: string | null
          has_reserve?: boolean
          id?: number
          image_paths?: string[]
          listing_type: Database["public"]["Enums"]["listing_type"]
          moderated_by?: string | null
          moderation_attempts?: number
          moderation_checked_at?: string | null
          moderation_reason?: string | null
          reserve_met?: boolean
          review_status?: ReviewStatus
          search_vector?: unknown
          seller_id: string
          silent?: boolean
          starting_price_cents?: number | null
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at?: string
          watch_count?: number
          winning_bid_id?: number | null
        }
        Update: {
          area_id?: string
          bid_count?: number
          buy_now_price_cents?: number | null
          category_id?: string
          charity_id?: number | null
          condition?: ListingCondition
          converted_at?: string | null
          created_at?: string
          current_bid_cents?: number | null
          description?: string | null
          display_price_cents?: number | null
          ends_at?: string | null
          has_reserve?: boolean
          id?: number
          image_paths?: string[]
          listing_type?: Database["public"]["Enums"]["listing_type"]
          moderated_by?: string | null
          moderation_attempts?: number
          moderation_checked_at?: string | null
          moderation_reason?: string | null
          reserve_met?: boolean
          review_status?: ReviewStatus
          search_vector?: unknown
          seller_id?: string
          silent?: boolean
          starting_price_cents?: number | null
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          updated_at?: string
          watch_count?: number
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
            foreignKeyName: "listings_charity_id_fkey"
            columns: ["charity_id"]
            isOneToOne: false
            referencedRelation: "charities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
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
      marketplace_settings: {
        Row: {
          charity_fee_free_cap_cents: number
          email_site_url: string | null
          id: boolean
        }
        Insert: {
          charity_fee_free_cap_cents?: number
          email_site_url?: string | null
          id?: never
        }
        Update: {
          charity_fee_free_cap_cents?: number
          email_site_url?: string | null
          id?: never
        }
        Relationships: []
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string | null
          email_attempts: number
          email_claimed_at: string | null
          email_status: string
          emailed_at: string | null
          id: number
          kind: string
          link: string | null
          listing_id: number | null
          read_at: string | null
          title: string
          transaction_id: number | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          email_attempts?: number
          email_claimed_at?: string | null
          email_status?: string
          emailed_at?: string | null
          id?: never
          kind: string
          link?: string | null
          listing_id?: number | null
          read_at?: string | null
          title: string
          transaction_id?: number | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          email_attempts?: number
          email_claimed_at?: string | null
          email_status?: string
          emailed_at?: string | null
          id?: never
          kind?: string
          link?: string | null
          listing_id?: number | null
          read_at?: string | null
          title?: string
          transaction_id?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      order_messages: {
        Row: {
          body: string
          created_at: string
          id: number
          kind: string
          sender_id: string
          transaction_id: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: never
          kind?: string
          sender_id: string
          transaction_id: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: never
          kind?: string
          sender_id?: string
          transaction_id?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: Json | null
          area_id: string | null
          avatar_path: string | null
          created_at: string
          email: string | null
          email_alerts: boolean
          emergency_contact_email: string | null
          emergency_contact_name: string | null
          full_name: string | null
          home_address: string | null
          id: string
          phone: string | null
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_payouts_enabled: boolean
          updated_at: string
          username: string
          username_changed_at: string | null
          welcome_email_sent_at: string | null
        }
        Insert: {
          address?: Json | null
          area_id?: string | null
          avatar_path?: string | null
          emergency_contact_email?: string | null
          emergency_contact_name?: string | null
          home_address?: string | null
          created_at?: string
          email?: string | null
          email_alerts?: boolean
          full_name?: string | null
          id: string
          phone?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_payouts_enabled?: boolean
          updated_at?: string
          username?: string
          username_changed_at?: string | null
          welcome_email_sent_at?: string | null
        }
        Update: {
          address?: Json | null
          area_id?: string | null
          avatar_path?: string | null
          emergency_contact_email?: string | null
          emergency_contact_name?: string | null
          home_address?: string | null
          created_at?: string
          email?: string | null
          email_alerts?: boolean
          full_name?: string | null
          id?: string
          phone?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_payouts_enabled?: boolean
          updated_at?: string
          username?: string
          username_changed_at?: string | null
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
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: number
          rating: number
          reviewee_id: string
          reviewer_id: string
          reviewer_role: 'buyer' | 'seller'
          transaction_id: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: never
          rating?: number
          reviewee_id?: string
          reviewer_id?: string
          reviewer_role?: 'buyer' | 'seller'
          transaction_id?: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: never
          rating?: number
          reviewee_id?: string
          reviewer_id?: string
          reviewer_role?: 'buyer' | 'seller'
          transaction_id?: number
        }
        Relationships: []
      }
      strikes: {
        Row: {
          created_at: string
          expires_at: string
          id: number
          reason: string
          transaction_id: number | null
          user_id: string
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: never
          reason?: string
          transaction_id?: number | null
          user_id?: string
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: never
          reason?: string
          transaction_id?: number | null
          user_id?: string
          voided_at?: string | null
        }
        Relationships: []
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
          delivery_fee_cents?: number
          handoff_address?: string | null
          handoff_attempts?: number
          handoff_code?: string | null
          handoff_method?: HandoffMethod
          id?: number
          listing_id: number
          meetup_at?: string | null
          meetup_deadline?: string | null
          meetup_spot_id?: string | null
          payout_attempts?: number
          picked_up_at?: string | null
          platform_fee_cents?: number
          proposal_note?: string | null
          proposed_by?: string | null
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
      username_blocked_terms: {
        Row: { term: string }
        Insert: { term: string }
        Update: { term?: string }
        Relationships: []
      }
      bid_handoff_choices: {
        Row: { bidder_id: string; listing_id: number; method: HandoffMethod; updated_at: string }
        Insert: { bidder_id: string; listing_id: number; method: HandoffMethod; updated_at?: string }
        Update: { bidder_id?: string; listing_id?: number; method?: HandoffMethod; updated_at?: string }
        Relationships: []
      }
      safety_alerts: {
        Row: {
          attempts: number
          body: string
          claimed_at: string | null
          created_at: string
          dedupe_key: string
          id: number
          kind: string
          sent_at: string | null
          status: 'pending' | 'sending' | 'sent' | 'failed'
          subject: string
          to_email: string
          to_name: string | null
          transaction_id: number
          user_id: string
        }
        Insert: never
        Update: { status?: 'pending' | 'sending' | 'sent' | 'failed'; sent_at?: string | null }
        Relationships: []
      }
      saved_searches: {
        Row: {
          area_ids: string[] | null
          area_key: string | null
          category_id: string | null
          conditions: string[] | null
          created_at: string
          id: number
          label: string
          last_matched_at: string | null
          listing_type: Database["public"]["Enums"]["listing_type"] | null
          max_cents: number | null
          min_cents: number | null
          query: string | null
          query_string: string
          user_id: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      user_blocks: {
        Row: { blocked_id: string; blocker_id: string; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      watchlist: {
        Row: {
          created_at: string
          listing_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          listing_id: number
          user_id?: string
        }
        Update: {
          created_at?: string
          listing_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_overview: {
        Args: never
        Returns: {
          active_listings: number
          cancelled_month: number
          fees_all_cents: number
          fees_month_cents: number
          new_users_month: number
          open_orders: number
          orders_all: number
          orders_month: number
          sales_all_cents: number
          sales_month_cents: number
          users: number
        }[]
      }
      admin_review_listing: {
        Args: { p_approve: boolean; p_listing_id: number; p_reason?: string | null }
        Returns: undefined
      }
      admin_review_queue: {
        Args: never
        Returns: {
          category: string | null
          created_at: string
          description: string | null
          id: number
          image_paths: string[]
          listing_type: Database["public"]["Enums"]["listing_type"]
          moderated_by: string | null
          moderation_reason: string | null
          price_cents: number | null
          seller_name: string
          title: string
        }[]
      }
      admin_strikes: {
        Args: never
        Returns: {
          active_count: number
          created_at: string
          expires_at: string
          id: number
          item_title: string | null
          reason: string
          username: string
        }[]
      }
      admin_void_strike: { Args: { p_strike_id: number }; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      admin_charity_queue: {
        Args: never
        Returns: {
          applicant: string
          bn: string
          contact_email: string | null
          contact_name: string
          contact_phone: string | null
          contact_role: string
          cra_city: string | null
          cra_legal_name: string | null
          cra_province: string | null
          created_at: string
          description: string | null
          id: number
          name: string
          on_cra_list: boolean
          website: string | null
        }[]
      }
      admin_review_charity: {
        Args: { p_approve: boolean; p_charity_id: number; p_note?: string | null }
        Returns: undefined
      }
      admin_set_charity_fee_cap: { Args: { p_cents: number }; Returns: undefined }
      apply_charity: {
        Args: {
          p_bn: string
          p_contact_email?: string | null
          p_contact_name: string
          p_contact_phone?: string | null
          p_contact_role: string
          p_description: string | null
          p_name: string
          p_website: string | null
        }
        Returns: undefined
      }
      auction_work_pending: { Args: never; Returns: boolean }
      begin_purchase: {
        Args: { p_buyer_id: string; p_fee_bps: number; p_handoff?: HandoffMethod | null; p_listing_id: number; p_min_fee_cents?: number }
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
      claim_notification_emails: {
        Args: { p_limit?: number }
        Returns: {
          body: string | null
          email: string | null
          id: number
          kind: string
          link: string | null
          title: string
        }[]
      }
      charity_directory: {
        Args: never
        Returns: {
          active_listings: number
          city: string | null
          description: string | null
          id: number
          name: string
          province: string | null
          slug: string
        }[]
      }
      check_handoff_code: {
        Args: { p_code: string; p_seller_id: string; p_transaction_id: number }
        Returns: boolean
      }
      check_username: { Args: { p_name: string }; Returns: string | null }
      choose_meetup_time: {
        Args: { p_time: string | null; p_transaction_id: number }
        Returns: undefined
      }
      close_auction: {
        Args: { p_fee_bps: number; p_listing_id: number; p_min_fee_cents?: number }
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
      convert_to_auction: {
        Args: {
          p_duration_days: number
          p_listing_id: number
          p_reserve_cents?: number | null
          p_starting_price_cents: number
        }
        Returns: undefined
      }
      create_listing: {
        Args: {
          p_area_id: string
          p_category_id: string
          p_condition: ListingCondition
          p_description: string | null
          p_duration_days?: number | null
          p_image_paths: string[]
          p_listing_type: Database["public"]["Enums"]["listing_type"]
          p_price_cents: number
          p_delivery_fee_cents?: number | null
          p_delivery_km?: number | null
          p_offers_meetup?: boolean
          p_offers_pickup?: boolean
          p_reserve_cents?: number | null
          p_title: string
        }
        Returns: number
      }
      distance_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      expired_orders: { Args: never; Returns: number[] }
      generate_username: { Args: never; Returns: string }
      get_handoff_code: { Args: { p_transaction_id: number }; Returns: string }
      listing_photos_ok: { Args: { p_paths: string[] }; Returns: boolean }
      my_charity: {
        Args: never
        Returns: {
          bn: string
          contact_name: string
          contact_role: string
          description: string | null
          fee_free_cap_cents: number
          fee_free_used_cents: number
          id: number
          name: string
          review_note: string | null
          slug: string
          status: 'pending' | 'approved' | 'rejected' | 'suspended'
          website: string | null
        }[]
      }
      order_party_names: {
        Args: { p_transaction_id: number }
        Returns: {
          buyer_name: string
          seller_name: string
        }[]
      }
      place_bid: {
        Args: { p_amount_cents: number; p_handoff?: HandoffMethod | null; p_listing_id: number }
        Returns: {
          amount_cents: number
          bidder_id: string
          bidder_no: number
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
      leave_review: {
        Args: { p_comment?: string | null; p_rating: number; p_transaction_id: number }
        Returns: undefined
      }
      profile_reviews: {
        Args: { p_limit?: number; p_username: string }
        Returns: {
          comment: string | null
          created_at: string
          item_title: string
          rating: number
          reviewer_name: string
          reviewer_role: 'buyer' | 'seller'
        }[]
      }
      propose_meetup: {
        Args: { p_note?: string | null; p_spot_id: string; p_times: string[]; p_transaction_id: number }
        Returns: undefined
      }
      send_order_message: {
        Args: { p_body: string; p_kind?: string; p_transaction_id: number }
        Returns: {
          body: string
          created_at: string
          id: number
          kind: string
          sender_id: string
          transaction_id: number
        }
      }
      public_profile: {
        Args: { p_username: string }
        Returns: {
          member_since: string
          purchases: number
          rating: number | null
          review_count: number
          sales: number
          username: string
          avatar_path: string | null
        }[]
      }
      release_stale_purchases: {
        Args: never
        Returns: {
          payment_intent_id: string | null
          transaction_id: number
        }[]
      }
      search_listings: {
        Args: {
          p_area_ids?: string[] | null
          p_category_id?: string | null
          p_conditions?: ListingCondition[] | null
          p_limit?: number
          p_listing_type?: Database["public"]["Enums"]["listing_type"] | null
          p_max_cents?: number | null
          p_min_cents?: number | null
          p_offset?: number
          p_query?: string | null
          p_sort?: ListingSort
        }
        Returns: Database["public"]["Tables"]["listings"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      seller_can_receive_payouts: { Args: never; Returns: boolean }
      set_username: { Args: { p_name: string }; Returns: string }
      silent_bid_status: {
        Args: { p_listing_id: number }
        Returns: { is_leading: boolean; my_bid_cents: number | null }[]
      }
      admin_handoff_locations: {
        Args: { p_transaction_id: number }
        Returns: {
          accuracy_m: number | null
          captured_at: string | null
          handoff_method: HandoffMethod
          lat: number | null
          listing_title: string
          lng: number | null
          meetup_at: string | null
          order_status: string
          picked_up_at: string | null
          role: 'buyer' | 'seller'
          username: string | null
        }[]
      }
      answer_question: { Args: { p_answer: string; p_question_id: number }; Returns: undefined }
      ask_question: { Args: { p_listing_id: number; p_question: string }; Returns: number }
      listing_questions_for: {
        Args: { p_listing_id: number }
        Returns: {
          answer: string | null
          answered_at: string | null
          asker_name: string
          created_at: string
          id: number
          mine: boolean
          question: string
        }[]
      }
      order_handoff_place: {
        Args: { p_transaction_id: number }
        Returns: { address: string | null; address_hidden_until: string | null; method: HandoffMethod }[]
      }
      record_handoff_location: {
        Args: { p_accuracy_m?: number | null; p_lat: number; p_lng: number; p_transaction_id: number }
        Returns: undefined
      }
      remove_question: { Args: { p_question_id: number }; Returns: undefined }
      claim_safety_alerts: {
        Args: { p_limit?: number }
        Returns: { body: string; id: number; subject: string; to_email: string; to_name: string | null }[]
      }
      save_search: {
        Args: {
          p_area_ids?: string[] | null
          p_area_key?: string | null
          p_category_id?: string | null
          p_conditions?: string[] | null
          p_listing_type?: Database["public"]["Enums"]["listing_type"] | null
          p_max_cents?: number | null
          p_min_cents?: number | null
          p_query?: string | null
          p_query_string?: string
        }
        Returns: number
      }
      claim_anonymous_engagement: { Args: { p_anon_id: string }; Returns: undefined }
      log_listing_view: {
        Args: { p_anon_id?: string | null; p_listing_id: number; p_source?: string | null }
        Returns: undefined
      }
      log_search: {
        Args: {
          p_anon_id?: string | null
          p_area_key?: string | null
          p_category_id?: string | null
          p_conditions?: string[] | null
          p_listing_type?: Database['public']['Enums']['listing_type'] | null
          p_max_cents?: number | null
          p_min_cents?: number | null
          p_query?: string | null
          p_result_count?: number | null
          p_sort?: string | null
        }
        Returns: undefined
      }
      admin_reports: {
        Args: never
        Returns: {
          active_strikes: number
          created_at: string
          details: string | null
          id: number
          listing_id: number | null
          listing_status: string | null
          listing_title: string | null
          open_reports_on_user: number
          question: string | null
          question_id: number | null
          reason: string
          reported_user: string | null
          reported_user_id: string | null
          reporter: string
          target_type: 'listing' | 'user' | 'question'
        }[]
      }
      admin_resolve_report: {
        Args: { p_action: 'dismiss' | 'handled' | 'remove_listing' | 'remove_question'; p_note?: string | null; p_report_id: number }
        Returns: undefined
      }
      block_user: { Args: { p_user_id: string }; Returns: undefined }
      is_blocked_with: { Args: { p_other: string }; Returns: { blocked: boolean; by_me: boolean }[] }
      my_bidder_no: { Args: { p_listing_id: number }; Returns: number | null }
      my_bids: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["bids"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "bids"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      my_blocks: {
        Args: never
        Returns: { avatar_path: string | null; created_at: string; user_id: string; username: string }[]
      }
      report_content: {
        Args: {
          p_details?: string | null
          p_listing_id?: number | null
          p_question_id?: number | null
          p_reason: string
          p_target_type: string
          p_user_id?: string | null
        }
        Returns: undefined
      }
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
