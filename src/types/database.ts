/**
 * Raw Postgres row shapes returned by `select *` (and the gate RPCs) when
 * reading through `@/lib/db/client`.
 *
 * Column names match `prisma/schema.prisma` (`@map` values) so SQL and TypeScript
 * stay aligned. Presentational types live in `src/types/index.ts` and friends;
 * mappers in `src/lib/services/mappers.ts` convert rows into those.
 *
 * There is no customer email column anywhere — bookings only carry
 * `customer_name` and `customer_mobile`. There are no role or permission types:
 * one administrator has full access.
 */

export type EventStatus = "draft" | "published" | "archived";
export type EventDateStatus = "scheduled" | "sold_out" | "cancelled" | "completed";
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired" | "refunded";
export type PaymentStatus = "unpaid" | "created" | "paid" | "failed" | "refunded";
export type DigitalPassStatus = "active" | "used" | "cancelled" | "expired";
export type GalleryStatus = "draft" | "published" | "archived";
export type MediaType = "image" | "video";

// -----------------------------------------------------------------------------
// Table rows (snake_case = database columns)
// -----------------------------------------------------------------------------

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  name_hindi: string | null;
  tagline: string | null;
  description: string | null;
  description_hindi: string | null;
  venue_name: string;
  venue_hindi: string | null;
  venue_address: string | null;
  city: string;
  state: string | null;
  maps_url: string | null;
  hero_image_url: string | null;
  /** Selected as a boolean only; public event queries never fetch the bytea payload. */
  hero_image_data_present?: boolean;
  /** Cast to text in reads so a PostgreSQL bigint is safe to put in URLs/JSON. */
  hero_image_version?: string | null;
  logo_url: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  whatsapp_number: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  youtube_url: string | null;
  support_hours: string[];
  currency: string;
  status: EventStatus;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventDateRow {
  id: string;
  event_id: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  capacity: number;
  capacity_held: number;
  available_capacity: number;
  booking_open: boolean;
  status: EventDateStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PassCategoryRow {
  id: string;
  event_id: string;
  code: string;
  name: string;
  name_hindi: string | null;
  composition: string;
  description: string | null;
  image_url: string | null;
  price_inr: number;
  number_of_people: number;
  max_per_booking: number;
  min_age: number;
  is_active: boolean;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EventHighlightRow {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EventFeatureRow {
  id: string;
  event_id: string;
  code: string;
  label: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GalleryRow {
  id: string;
  event_id: string | null;
  album: string | null;
  title: string | null;
  description: string | null;
  media_type: MediaType;
  /** Vercel Blob key (not a public URL). */
  storage_path: string | null;
  thumbnail_path: string | null;
  url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  alt_text: string;
  captured_on: string | null;
  status: GalleryStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BookingRow {
  id: string;
  booking_id: string;
  customer_name: string;
  customer_mobile: string;
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
}

export interface DigitalPassRow {
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
}

export interface CheckInRow {
  id: string;
  digital_pass_id: string;
  event_date_id: string;
  checked_in_at: string;
  gate: string | null;
  checked_in_by: string | null;
  notes: string | null;
}

export interface PaymentEventRow {
  id: string;
  event_id: string;
  event_type: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  amount_paise: number | null;
  outcome: string;
  received_at: string;
  processed_at: string | null;
}

// -----------------------------------------------------------------------------
// Gate RPC (`scan_pass` / `check_in_pass` / `pass_entry`)
// -----------------------------------------------------------------------------

/**
 * One row of the gate verdict. Every field except `outcome` and `reason` is
 * null when the pass was refused before it could be read, which is why the
 * presentation type in `src/types/admin.ts` marks them nullable too.
 * `qr_token` is never returned.
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

/**
 * The three jsonb arrays `admin_booking_detail` returns. Assembled inside the
 * database (one booking, one pass list, one gate list, one payment history).
 * `qr_token` appears in none of them.
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
