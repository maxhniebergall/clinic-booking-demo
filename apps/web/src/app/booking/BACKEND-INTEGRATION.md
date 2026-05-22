# Booking UI — hardcoded data to connect to the backend

The booking calendar (`/booking`) is currently **frontend-only**. All availability,
provider, and scheduling data is mocked client-side. This document lists each hardcoded
aspect, where it lives today, and what backend it should be replaced with.

When implementing, follow the stack patterns: Drizzle schema in `packages/db/src/schema/`,
oRPC procedures in `packages/api/src/routers/index.ts` (use `protectedProcedure`), and call
them from the client via `orpc.<procedure>.queryOptions()` / `useMutation` (see
`apps/web/src/utils/orpc.ts`).

---

## 1. Provider types

- **Where:** `slots.ts` → `PROVIDER_TYPES` (Physiotherapist, Chiropractor, Massage Therapist)
  and `PROVIDER_SEED`; rendered as the filter bar in `booking-calendar.tsx`.
- **Today:** A hardcoded array of `{ id, label }`.
- **Should be:** A `provider` (and/or `provider_type`) table queried via an API, e.g.
  `orpc.providers.list`. Real providers also carry name, specialty, bio, photo, and which
  locations/services they offer.

## 2. Slot availability

- **Where:** `slots.ts` → `isAvailable()` and `generateSlots()`.
- **Today:** A deterministic hash fakes ~70% availability per (day, time, provider).
- **Should be:** A backend availability query, e.g. `orpc.availability.getSlots({ date,
  durationMinutes, providerId })`, computed from the provider's working schedule **minus**
  already-booked appointments. Availability must be authoritative server-side — never trust
  the client to decide what's open.

## 3. Clinic / working hours

- **Where:** `slots.ts` → `DAY_START_HOUR` (9) and `DAY_END_HOUR` (17).
- **Today:** Fixed 9am–5pm for everyone, every day.
- **Should be:** Per-provider (and per-weekday) working hours from a `provider_schedule` /
  availability-rules table, including days off, holidays, and breaks.

## 4. Appointment durations

- **Where:** `slots.ts` → `SLOT_DURATIONS` (15/30/45/60) and `DEFAULT_DURATION`.
- **Today:** A fixed list offered for every provider.
- **Should be:** Driven by the **service / appointment type** the patient is booking
  (e.g. "Initial assessment — 60 min", "Follow-up — 30 min"), from a `service` table tied
  to the provider. Duration usually isn't a free choice; it follows the selected service.

## 5. Booking submission (the "Book" button)

- **Where:** `booking-calendar.tsx` → footer `<Button disabled>` and `selectedSlot` state.
- **Today:** Disabled placeholder; selecting a slot only updates local state and nothing is
  persisted.
- **Should be:** A `protectedProcedure` mutation, e.g. `orpc.appointments.create({
  providerId, serviceId, start, durationMinutes })`, writing to an `appointment` table
  linked to the logged-in `user`. Needs server-side validation (slot still free, within
  working hours) and a double-booking guard, then a confirmation state / toast.

## 6. The patient's existing appointments

- **Where:** Not shown anywhere yet.
- **Should be:** `orpc.appointments.listMine` for the logged-in user, with cancel/reschedule
  actions — so the calendar can mark days the patient already has bookings.

---

## Suggested data model (follow-up)

Minimum tables to make the above real (in `packages/db/src/schema/`):

- `provider` — id, name, type/specialty, bio, active.
- `service` — id, providerId (or many-to-many), name, durationMinutes, price.
- `provider_schedule` / `availability_rule` — providerId, weekday, startTime, endTime,
  plus exceptions (days off).
- `appointment` — id, userId (FK → `user`), providerId, serviceId, start, end, status,
  createdAt.

Once these exist, delete the mock logic in `slots.ts` and replace the three client-side
selectors (provider, duration, slots) with queried data.
