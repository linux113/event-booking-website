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

/**
 * The three jsonb arrays `admin_booking_detail` returns. They are assembled inside
 * the database (one booking, one pass list, one gate list, one payment history), so
 * the row shapes are declared here rather than inferred from a join the app would
 * have to fan out itself. `qr_token` appears in none of them.
 */
export interface AdminBookingPass {
  pass_id: string;
  pass_number: number;
  status: string;
  checked_in: boolean;
  checked_in_at: string | null;
  valid_date: string;
}

export interface AdminBookingCheckIn {
  pass_id: string;
  gate: string | null;
  notes: string | null;
  checked_in_at: string;
  staff: string | null;
}

export interface AdminBookingPaymentEvent {
  event_id: string;
  event_type: string;
  outcome: string;
  amount_paise: number | null;
  received_at: string;
  processed_at: string | null;
}

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
          pass_number: number;
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
          pass_number: number;
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
          pass_number?: number;
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
      /** Any active role: super_admin, admin or staff. */
      is_staff: {
        Args: { p_user_id?: string };
        Returns: boolean;
      };
      /** super_admin or admin — the management roles. */
      is_admin: {
        Args: { p_user_id?: string };
        Returns: boolean;
      };
      /** Full access, including staff and role management. */
      is_super_admin: {
        Args: { p_user_id?: string };
        Returns: boolean;
      };
      /** The caller's own role, for the request hook (see `src/proxy.ts`). */
      current_staff_role: {
        Args: Record<string, never>;
        Returns: string | null;
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
      get_booking_passes: {
        Args: { p_public_token: string };
        Returns: {
          pass_id: string;
          qr_token: string;
          pass_status: string;
          checked_in: boolean;
          checked_in_at: string | null;
          valid_date: string;
          issued_at: string;
          pass_number: number;
          pass_total: number;
        }[];
      };
      get_pass_by_token: {
        Args: { p_qr_token: string };
        Returns: {
          pass_id: string;
          qr_token: string;
          pass_status: string;
          checked_in: boolean;
          checked_in_at: string | null;
          valid_date: string;
          issued_at: string;
          pass_number: number;
          pass_total: number;
          booking_reference: string;
          booking_status: string;
          payment_status: string;
          customer_name: string;
          quantity: number;
          total_amount: number;
          currency: string;
          event_name: string;
          event_date: string;
          start_time: string | null;
          end_time: string | null;
          venue_name: string;
          venue_address: string | null;
          city: string;
          pass_name: string;
          pass_composition: string | null;
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
      /**
       * Admin booking management (step 10). `admin_search_bookings` is the whole
       * /admin/bookings list: the search box, the five filters, the paging and the
       * count of the full result set (`total_count` is the size of the result before
       * paging, so the screen can say "3 of 128"). Column order here must match the
       * function's `returns table` order exactly — PostgREST binds by position.
       *
       * Two things are deliberate and worth knowing before reading the types:
       *
       *   * every contact, money and gateway column is nullable, because the function
       *     returns null for them when `p_include_contact` is false — a caller without
       *     `bookings:view_contact` is handed nothing it must remember not to show;
       *   * a filter value the schema does not recognise narrows nothing (it does not
       *     silently return an empty list that reads as "no such booking"), so the
       *     args are plain strings and the database does the validating.
       *
       * `admin_booking_detail` answers the same lookup for one booking and adds the
       * pass list, the gate entries and the Razorpay events as jsonb. It never returns
       * `qr_token`: the credential that admits a guest is not a screen's business.
       * Both functions are `service_role` only.
       */
      admin_search_bookings: {
        Args: {
          p_query?: string | null;
          p_event_date_from?: string | null;
          p_event_date_to?: string | null;
          p_pass_category_id?: string | null;
          p_payment_status?: string | null;
          p_booking_status?: string | null;
          p_check_in_status?: string | null;
          p_include_contact?: boolean;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          booking_uuid: string;
          booking_id: string;
          customer_name: string;
          customer_mobile: string | null;
          customer_email: string | null;
          event_name: string;
          event_slug: string;
          event_date: string;
          start_time: string | null;
          end_time: string | null;
          pass_name: string;
          pass_composition: string | null;
          quantity: number;
          number_of_people: number;
          total_amount: number | null;
          currency: string;
          booking_status: string;
          payment_status: string;
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          created_at: string;
          passes_issued: number;
          passes_checked_in: number;
          check_in_times: string[] | null;
          pass_ids: string[];
          total_count: number;
        }[];
      };
      admin_booking_detail: {
        Args: { p_lookup: string; p_include_contact?: boolean };
        Returns: {
          booking_uuid: string;
          booking_id: string;
          customer_name: string;
          customer_mobile: string | null;
          customer_email: string | null;
          event_name: string;
          event_slug: string;
          venue_name: string | null;
          venue_address: string | null;
          city: string | null;
          event_date: string;
          start_time: string | null;
          end_time: string | null;
          pass_name: string;
          pass_composition: string | null;
          quantity: number;
          number_of_people: number;
          subtotal: number | null;
          total_amount: number | null;
          currency: string;
          booking_status: string;
          payment_status: string;
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
          passes: AdminBookingPass[] | null;
          check_ins: AdminBookingCheckIn[] | null;
          payment_events: AdminBookingPaymentEvent[] | null;
        }[];
      };
      /**
       * The dashboard's statistics (step 9). Every figure on /admin comes from one of
       * these four functions, so no statistic is ever summed in the browser or in
       * Node. Two conventions are visible in the types on purpose:
       *
       *   * money columns are `number | null` — the database returns null rather than
       *     a figure when `p_include_revenue` is false, and a component cannot render
       *     what it was never given;
       *   * contact columns on the recent list are `string | null` for the same reason,
       *     keyed off `p_include_contact`.
       *
       * All four are `service_role` only. Days are counted in `p_tz` (the venue's
       * timezone) so "today" means the venue's today.
       */
      admin_dashboard_stats: {
        Args: { p_today: string; p_tz?: string; p_include_revenue?: boolean };
        Returns: {
          bookings_total: number;
          bookings_confirmed: number;
          bookings_paid: number;
          bookings_pending: number;
          bookings_refunded: number;
          bookings_today: number;
          revenue_total: number | null;
          revenue_today: number | null;
          revenue_refunded: number | null;
          check_ins_total: number;
          check_ins_today: number;
          passes_issued: number;
          passes_active: number;
          passes_used: number;
          people_paid: number;
          capacity_total: number;
          capacity_taken: number;
          capacity_available: number;
          tonight_date: string | null;
          tonight_capacity: number;
          tonight_taken: number;
          tonight_available: number;
          nights_total: number;
          nights_upcoming: number;
          gallery_published: number;
          gallery_draft: number;
          staff_active: number;
          staff_total: number;
        }[];
      };
      /** Day-by-day bookings (and revenue) for the dashboard chart. */
      admin_booking_series: {
        Args: { p_today: string; p_days?: number; p_tz?: string; p_include_revenue?: boolean };
        Returns: {
          day: string;
          bookings: number;
          confirmed: number;
          revenue: number | null;
        }[];
      };
      /** Bookings, passes, people and revenue per pass category. */
      admin_pass_breakdown: {
        Args: { p_include_revenue?: boolean };
        Returns: {
          pass_category_id: string;
          pass_name: string;
          pass_composition: string | null;
          price_inr: number;
          is_active: boolean;
          bookings: number;
          paid_bookings: number;
          passes_issued: number;
          people: number;
          revenue: number | null;
        }[];
      };
      /** The newest bookings, for the dashboard table. */
      admin_recent_bookings: {
        Args: { p_limit?: number; p_include_contact?: boolean };
        Returns: {
          booking_uuid: string;
          booking_id: string;
          customer_name: string;
          customer_mobile: string | null;
          customer_email: string | null;
          event_date: string;
          start_time: string | null;
          pass_name: string;
          quantity: number;
          number_of_people: number;
          total_amount: number | null;
          currency: string;
          booking_status: string;
          payment_status: string;
          created_at: string;
        }[];
      };
      /**
       * Gate entry (step 7). `scan_pass` is the read-only verdict; `check_in_pass`
       * is the same verdict with the compare-and-swap and the `check_ins` row
       * behind it. Both are executable by `service_role` only, and both demand a
       * staff user id — the return shape is identical, so the scanner can show the
       * result of either without a second model.
       */
      scan_pass: {
        Args: { p_qr_token: string; p_gate_date: string; p_staff_user_id: string };
        Returns: PassEntryRow[];
      };
      check_in_pass: {
        Args: {
          p_qr_token: string;
          p_gate_date: string;
          p_staff_user_id: string;
          p_gate?: string | null;
        };
        Returns: PassEntryRow[];
      };
      /** Internal: the shared body of the two above. Revoked from every role. */
      pass_entry: {
        Args: {
          p_qr_token: string;
          p_gate_date: string;
          p_staff_user_id: string | null;
          p_commit: boolean;
          p_gate?: string | null;
        };
        Returns: PassEntryRow[];
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

/**
 * One row of the gate verdict (`scan_pass` / `check_in_pass` / `pass_entry`).
 *
 * Every field except `outcome` and `reason` is null when the pass was refused
 * before it could be read, which is why the presentation type in
 * `src/types/admin.ts` marks them nullable too.
 */
export interface PassEntryRow {
  outcome: string;
  reason: string | null;
  pass_id: string | null;
  pass_status: string | null;
  checked_in: boolean | null;
  checked_in_at: string | null;
  pass_number: number | null;
  pass_total: number | null;
  customer_name: string | null;
  pass_name: string | null;
  pass_composition: string | null;
  booking_reference: string | null;
  booking_status: string | null;
  payment_status: string | null;
  event_name: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  city: string | null;
  gate_date: string | null;
  staff_name: string | null;
  check_in_id: string | null;
}

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
