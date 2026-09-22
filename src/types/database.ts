/**
 * Database types for the Supabase schema in `supabase/migrations/`.
 *
 * Hand-written to mirror the output of
 * `supabase gen types typescript --schema public` — the shape matches exactly, so
 * once the project is linked you can regenerate this file and it is a drop-in
 * replacement. Every column, nullability and default mirrors the SQL.
 *
 * Only `supabase-js` consumes this type; UI components should use the
 * presentational types in `src/types/index.ts` instead.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      event_highlights: {
        Row: {
          id: string;
          event_id: string;
          title: string;
          description: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          title: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          title?: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      event_features: {
        Row: {
          id: string;
          event_id: string;
          code: string;
          label: string;
          description: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          code: string;
          label: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          code?: string;
          label?: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      events: {
        Row: {
          id: string;
          slug: string;
          name: string;
          tagline: string | null;
          description: string | null;
          venue_name: string;
          venue_address: string | null;
          city: string;
          state: string | null;
          maps_url: string | null;
          hero_image_url: string | null;
          contact_phone: string | null;
          contact_email: string | null;
          currency: string;
          status: EventStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          tagline?: string | null;
          description?: string | null;
          venue_name: string;
          venue_address?: string | null;
          city: string;
          state?: string | null;
          maps_url?: string | null;
          hero_image_url?: string | null;
          contact_phone?: string | null;
          contact_email?: string | null;
          currency?: string;
          status?: EventStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          tagline?: string | null;
          description?: string | null;
          venue_name?: string;
          venue_address?: string | null;
          city?: string;
          state?: string | null;
          maps_url?: string | null;
          hero_image_url?: string | null;
          contact_phone?: string | null;
          contact_email?: string | null;
          currency?: string;
          status?: EventStatus;
          created_at?: string;
          updated_at?: string;
        };
        // Regenerate with the Supabase CLI to populate join metadata.
        Relationships: [];
      };

      event_dates: {
        Row: {
          id: string;
          event_id: string;
          event_date: string;
          start_time: string | null;
          end_time: string | null;
          capacity: number;
          status: EventDateStatus;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          event_date: string;
          start_time?: string | null;
          end_time?: string | null;
          capacity?: number;
          status?: EventDateStatus;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          event_date?: string;
          start_time?: string | null;
          end_time?: string | null;
          capacity?: number;
          status?: EventDateStatus;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      payment_events: {
        Row: {
          id: string;
          event_id: string;
          event_type: string;
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          amount_paise: number | null;
          outcome: string;
          received_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          event_id: string;
          event_type: string;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          amount_paise?: number | null;
          outcome?: string;
          received_at?: string;
          processed_at?: string | null;
        };
        Update: {
          outcome?: string;
          processed_at?: string | null;
        };
        Relationships: [];
      };
      pass_categories: {
        Row: {
          id: string;
          event_id: string;
          code: string;
          name: string;
          composition: string;
          description: string | null;
          price_inr: number;
          number_of_people: number;
          max_per_booking: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          code: string;
          name: string;
          composition: string;
          description?: string | null;
          price_inr: number;
          number_of_people: number;
          max_per_booking?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          code?: string;
          name?: string;
          composition?: string;
          description?: string | null;
          price_inr?: number;
          number_of_people?: number;
          max_per_booking?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      bookings: {
        Row: {
          id: string;
          booking_id: string;
          customer_name: string;
          customer_mobile: string;
          customer_email: string;
          event_date_id: string;
          pass_category_id: string;
          quantity: number;
          number_of_people: number;
          subtotal: number;
          total_amount: number;
          booking_status: BookingStatus;
          payment_status: PaymentStatus;
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          idempotency_key: string | null;
          public_token: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        /**
         * `subtotal`, `number_of_people` and a defaulted `total_amount` are
         * overwritten by the `set_booking_amounts()` trigger, so they are
         * optional here — the database always calculates them from the pass
         * category's price.
         */
        Insert: {
          id?: string;
          booking_id?: string;
          customer_name: string;
          customer_mobile: string;
          customer_email: string;
          event_date_id: string;
          pass_category_id: string;
          quantity: number;
          number_of_people?: number;
          subtotal?: number;
          total_amount?: number;
          booking_status?: BookingStatus;
          payment_status?: PaymentStatus;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          idempotency_key?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          booking_id?: string;
          customer_name?: string;
          customer_mobile?: string;
          customer_email?: string;
          event_date_id?: string;
          pass_category_id?: string;
          quantity?: number;
          number_of_people?: number;
          subtotal?: number;
          total_amount?: number;
          booking_status?: BookingStatus;
          payment_status?: PaymentStatus;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          idempotency_key?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      digital_passes: {
        Row: {
          id: string;
          booking_id: string;
          pass_id: string;
          qr_token: string;
          qr_code_url: string | null;
          valid_date: string;
          status: DigitalPassStatus;
          checked_in: boolean;
          checked_in_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          pass_id?: string;
          qr_token?: string;
          qr_code_url?: string | null;
          valid_date: string;
          status?: DigitalPassStatus;
          checked_in?: boolean;
          checked_in_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          booking_id?: string;
          pass_id?: string;
          qr_token?: string;
          qr_code_url?: string | null;
          valid_date?: string;
          status?: DigitalPassStatus;
          checked_in?: boolean;
          checked_in_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };

      check_ins: {
        Row: {
          id: string;
          digital_pass_id: string;
          event_date_id: string;
          checked_in_at: string;
          gate: string | null;
          checked_in_by: string | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          digital_pass_id: string;
          event_date_id: string;
          checked_in_at?: string;
          gate?: string | null;
          checked_in_by?: string | null;
          notes?: string | null;
        };
        Update: {
          id?: string;
          digital_pass_id?: string;
          event_date_id?: string;
          checked_in_at?: string;
          gate?: string | null;
          checked_in_by?: string | null;
          notes?: string | null;
        };
        Relationships: [];
      };

      gallery: {
        Row: {
          id: string;
          event_id: string | null;
          album: string | null;
          title: string | null;
          description: string | null;
          media_type: MediaType;
          storage_path: string | null;
          url: string | null;
          thumbnail_url: string | null;
          alt_text: string;
          captured_on: string | null;
          status: GalleryStatus;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id?: string | null;
          album?: string | null;
          title?: string | null;
          description?: string | null;
          media_type?: MediaType;
          storage_path?: string | null;
          url?: string | null;
          thumbnail_url?: string | null;
          alt_text: string;
          captured_on?: string | null;
          status?: GalleryStatus;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string | null;
          album?: string | null;
          title?: string | null;
          description?: string | null;
          media_type?: MediaType;
          storage_path?: string | null;
          url?: string | null;
          thumbnail_url?: string | null;
          alt_text?: string;
          captured_on?: string | null;
          status?: GalleryStatus;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      admin_users: {
        Row: {
          id: string;
          user_id: string;
          email: string;
          full_name: string | null;
          role: AdminRole;
          is_active: boolean;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          email: string;
          full_name?: string | null;
          role?: AdminRole;
          is_active?: boolean;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          email?: string;
          full_name?: string | null;
          role?: AdminRole;
          is_active?: boolean;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_staff: {
        Args: { p_user_id?: string };
        Returns: boolean;
      };
      is_admin: {
        Args: { p_user_id?: string };
        Returns: boolean;
      };
      is_owner: {
        Args: { p_user_id?: string };
        Returns: boolean;
      };
      generate_booking_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      generate_pass_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      attach_razorpay_order: {
        Args: { p_booking_id: string; p_razorpay_order_id: string };
        Returns: { booking_uuid: string; razorpay_order_id: string; attached: boolean }[];
      };
      confirm_booking_payment: {
        Args: { p_razorpay_order_id: string; p_razorpay_payment_id: string; p_amount_paise?: number | null };
        Returns: {
          booking_uuid: string;
          booking_reference: string;
          public_token: string;
          booking_status: string;
          payment_status: string;
          quantity: number;
          number_of_people: number;
          subtotal: number;
          total_amount: number;
          event_id: string;
          event_date: string;
          start_time: string | null;
          end_time: string | null;
          pass_name: string;
          pass_composition: string | null;
          currency: string;
          passes_issued: number;
          already_confirmed: boolean;
          capacity_note: string | null;
        }[];
      };
      fail_booking_payment: {
        Args: { p_razorpay_order_id: string; p_razorpay_payment_id?: string | null };
        Returns: string;
      };
      refund_booking_payment: {
        Args: { p_razorpay_payment_id: string };
        Returns: string;
      };
      apply_razorpay_event: {
        Args: {
          p_event_id: string;
          p_event_type: string;
          p_razorpay_order_id?: string | null;
          p_razorpay_payment_id?: string | null;
          p_amount_paise?: number | null;
        };
        Returns: { duplicate: boolean; outcome: string; booking_reference: string | null; passes_issued: number | null }[];
      };
      get_booking_status: {
        Args: { p_public_token: string };
        Returns: {
          booking_reference: string;
          booking_status: string;
          payment_status: string;
          quantity: number;
          number_of_people: number;
          total_amount: number;
          currency: string;
          event_name: string;
          event_date: string;
          start_time: string | null;
          end_time: string | null;
          venue_name: string;
          city: string;
          pass_name: string;
          pass_composition: string | null;
          passes_issued: number;
          created_at: string;
        }[];
      };
      create_pending_booking: {
        Args: {
          p_event_id: string;
          p_event_date_id: string;
          p_pass_category_id: string;
          p_customer_name: string;
          p_customer_mobile: string;
          p_customer_email: string;
          p_quantity: number;
          p_number_of_people: number;
          p_idempotency_key?: string | null;
        };
        Returns: {
          booking_uuid: string;
          booking_reference: string;
          public_token: string;
          booking_status: string;
          payment_status: string;
          quantity: number;
          number_of_people: number;
          subtotal: number;
          total_amount: number;
          event_id: string;
          event_date_id: string;
          event_date: string;
          start_time: string | null;
          end_time: string | null;
          pass_category_id: string;
          pass_name: string;
          pass_composition: string | null;
          currency: string;
          razorpay_order_id: string | null;
          created_at: string;
          was_existing: boolean;
        }[];
      };
      get_event_night_availability: {
        Args: { p_event_id: string };
        Returns: {
          event_date_id: string;
          event_date: string;
          start_time: string | null;
          end_time: string | null;
          night_status: string;
          capacity: number;
          booked_people: number;
          remaining: number;
          is_fully_booked: boolean;
          is_bookable: boolean;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// -----------------------------------------------------------------------------
// Status unions — kept in sync with the CHECK constraints in the migrations.
// Changing a value here is not enough: the SQL constraint must change too.
// -----------------------------------------------------------------------------

export type EventStatus = "draft" | "published" | "archived";
export type EventDateStatus = "scheduled" | "sold_out" | "cancelled" | "completed";
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired" | "refunded";
export type PaymentStatus = "unpaid" | "created" | "paid" | "failed" | "refunded";
export type DigitalPassStatus = "active" | "used" | "cancelled" | "expired";
export type GalleryStatus = "draft" | "published" | "archived";
export type MediaType = "image" | "video";
export type AdminRole = "owner" | "admin" | "manager" | "scanner";

// -----------------------------------------------------------------------------
// Convenience aliases
// -----------------------------------------------------------------------------

export type PublicSchema = Database["public"];
export type PublicTable = keyof PublicSchema["Tables"];

/** Row shape of a table: `Row<"bookings">`. */
export type Row<T extends PublicTable> = PublicSchema["Tables"][T]["Row"];
/** Insert payload of a table: `Insert<"bookings">`. */
export type Insert<T extends PublicTable> = PublicSchema["Tables"][T]["Insert"];
/** Update payload of a table: `Update<"events">`. */
export type Update<T extends PublicTable> = PublicSchema["Tables"][T]["Update"];

export type EventRow = Row<"events">;
export type EventDateRow = Row<"event_dates">;
export type PassCategoryRow = Row<"pass_categories">;
export type BookingRow = Row<"bookings">;
export type DigitalPassRow = Row<"digital_passes">;
export type CheckInRow = Row<"check_ins">;
export type GalleryRow = Row<"gallery">;
export type EventHighlightRow = Row<"event_highlights">;
export type EventFeatureRow = Row<"event_features">;
export type AdminUserRow = Row<"admin_users">;
