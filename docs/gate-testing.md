# Testing the gate: passes, QR scanning and date validation

Three things can go wrong at a door, and each has its own way of being checked:

| Question | Check it with |
| -------- | ------------- |
| Is this *pass* good? | `npm run test:gate` (below), or one SQL line against the live database |
| Does *scanning* work — camera, decode, verdict, admission? | The phone checklist in §2 |
| Will it still validate if the **date** changes? | §3 — the rules and the one midnight trap |

## 1 · `npm run test:gate` — the whole gate in 16 assertions

Runs against a real PostgreSQL with the real schema and the real functions the
scanner calls (`scan_pass()` / `check_in_pass()`), and issues each pass the way a
guest gets one: booking → Razorpay order → confirmed payment.

```bash
npm run test:gate
```

What it proves, in order:

1. **The gate's clock** — the server, not the phone, decides the night, in
   `Asia/Kolkata`: 23:59:59 IST is the same night, 00:00 IST is the next one, and
   doors-open time (19:00 IST) is still that night.
2. **Token shape** — only 64 lowercase-hex tokens are passes; uppercase, short,
   long or non-hex are refused before the database is asked anything.
3. **An issued pass carries the night it was bought for.**
4. **The date decides the verdict** — valid on its night; `not_yet_valid` one day
   early; `expired` one day late; a scan **writes nothing** (no check-in row, pass
   still `active`).
5. **Admission** — a wrong night cannot be admitted *and leaves no trace*; the right
   night admits once and stamps the time and the gate label; the same pass cannot go
   through twice (still exactly one `check_ins` row).
6. **Refusals** — an unknown but well-formed token is `invalid`; a malformed token
   never reaches the database; a **cancelled night** refuses every pass on it.
7. **What the scanner shows** — every verdict carries the name, booking reference,
   pass type and pass number the panel renders.

## 2 · Manual check on the phone (the camera path)

1. Sign in as admin on the phone and open **`/admin/scanner`**. The banner must read
   **Gate night: <date>** — that date is the venue's, decided by the server. If it is
   wrong, every verdict below will be wrong too.
2. Open a pass — the guest's `/pass/<id>?t=<token>` page or the printed PDF — on a
   second screen, or print it.
3. Point the camera at the QR code. Expected: the guest's name, pass type and
   **VALID**, with a **Confirm entry** button.
4. Tap **Confirm entry** → **ADMITTED**. Scan the same code again → **ALREADY USED**.
5. Type a gate label (e.g. `Gate A`) once: it is remembered on that phone, and it is
   what the check-in log records.

Two practical notes:

* **The camera needs `https://`** (or `localhost`). Opened from a laptop over
  `http://<lan-ip>`, the browser will not hand over the camera — that is the browser,
  not the app. Use the **manual box** instead: paste the **whole**
  `https://…/verify/<64-hex-token>` URL. The scanner accepts our verification URLs and
  nothing else, so a text QR code or another site's link is correctly refused.
* Nothing on the phone decides anything: the token goes to `/api/staff/scan` and the
  verdict comes back from the database. A wrong-looking screen means a wrong verdict
  from the database — check §4 before suspecting the camera.

## 3 · The date rule — what happens when the date or time changes

The pass carries one date (`digital_passes.valid_date`) and the gate compares it with
one date: **today at the venue** (`Asia/Kolkata`, decided on the server). Times of day
are never compared — a 19:00 guest and a 23:00 guest are both fine.

| Pass `valid_date` | Gate night (today at the venue) | Verdict |
| ----------------- | ------------------------------- | ------- |
| 2026-10-12 | 2026-10-12 | **valid** → can be admitted |
| 2026-10-12 | 2026-10-11 | `not_yet_valid` — "This pass is for a later night." |
| 2026-10-11 | 2026-10-12 | `expired` — "This pass was for an earlier night." |
| 2026-10-12 | 2026-10-12, night `cancelled` | `invalid` — "That night is not taking place." |

> **⚠️ There is no grace window after midnight.** The gate date is the calendar date at
> the venue, so a guest holding a pass for the 11th who arrives at **00:30 on the 12th**
> is scanned against the 12th and refused as `expired` — even though the party is still
> running. If a night is expected to run past midnight, everyone must be admitted
> **before 00:00 IST**, or the night's `event_date` (and the passes on it) must be dated
> the day the doors stay open into. `npm run test:gate` asserts this behaviour so it can
> never change by accident; if a post-midnight window is wanted, that is a deliberate
> change to `gateNight()` — not something to discover at the door.

## 4 · Checking one specific pass or booking in SQL

Neon SQL Editor (or any client) — the same functions the scanner calls:

```sql
-- The pass behind a booking reference
select dp.pass_id, dp.status, dp.checked_in, dp.checked_in_at, dp.valid_date,
       left(dp.qr_token, 8) || '…' as token
  from public.digital_passes dp
  join public.bookings b on b.id = dp.booking_id
 where b.booking_id = 'DND202600001';

-- The verdict for a token, for one night. Writes nothing.
select outcome, reason, customer_name, pass_number, pass_total
  from public.scan_pass('<64-character token>', date '2026-10-11');

-- Admit someone by hand (this is the write — only for a real admission).
select outcome, reason, check_in_id
  from public.check_in_pass('<64-character token>', date '2026-10-11', 'Gate A');

-- The auditor's view: who was admitted, when, at which gate
select ci.checked_in_at, ci.gate, dp.pass_id, b.booking_id, b.customer_name
  from public.check_ins ci
  join public.digital_passes dp on dp.id = ci.digital_pass_id
  join public.bookings b on b.id = dp.booking_id
 order by ci.checked_in_at desc
 limit 20;
```

Running `check_in_pass(...)` a second time for the same token returns `already_used`
and writes nothing — that is the double-entry guarantee, not an error.

## 5 · What each verdict means, and what to do

| Verdict | Shown to the door | Usual cause |
| ------- | ----------------- | ----------- |
| `valid` | valid — Confirm entry | normal |
| `checked_in` | admitted | normal |
| `already_used` | already scanned | the guest went in, or someone reused a screenshot |
| `not_yet_valid` | pass is for a later night | wrong night's pass at the door |
| `expired` | pass was for an earlier night | the night passed — or it is after midnight (see §3) |
| `payment_not_verified` | no verified payment | booking not `confirmed` / payment not `paid` |
| `refunded` | booking cancelled or refunded | pass cancelled, or booking refunded |
| `invalid` | that code is not a pass / night not taking place | unknown token, malformed token, cancelled night |
| *error* | "The gate could not check that pass. Try again in a moment." | the server could not reach the database — check `DATABASE_URL` / Neon status; if `/admin/bookings` is broken too, it is a database-side problem, not the camera |

A refusal is never a code bug by itself: the verdict is a row the database returned.
§4 shows the exact query to reproduce it.
