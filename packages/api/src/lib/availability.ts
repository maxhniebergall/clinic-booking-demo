import { db } from "@my-better-t-app/db";
import {
  appointment,
  availabilityException,
  availabilityRule,
  provider,
  providerServiceOption,
} from "@my-better-t-app/db/schema/booking";
import { ORPCError } from "@orpc/server";
import { and, eq, gt, gte, lt, lte } from "drizzle-orm";

export type Slot = { startAt: Date; endAt: Date };

const DAY_MS = 86_400_000;
const BOOKING_HORIZON_DAYS = 60;
const SEARCH_WINDOW_DAYS = 14;

// ---------------------------------------------------------------------------
// Timezone helpers (no external dependency — uses Intl for DST correctness).
// ---------------------------------------------------------------------------

// Offset (ms) such that: localWallClockReadAsUTC = instant + offset.
function tzOffsetMs(timeZone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUTC - instant.getTime();
}

// Convert a provider-local wall-clock (date "YYYY-MM-DD" + minutes from midnight)
// to the corresponding UTC instant, resolving DST via a one-step refinement.
function zonedWallToUtc(
  localDate: string,
  minutes: number,
  timeZone: string,
): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, Math.floor(minutes / 60), minutes % 60);
  const offset1 = tzOffsetMs(timeZone, new Date(guess));
  let ts = guess - offset1;
  const offset2 = tzOffsetMs(timeZone, new Date(ts));
  if (offset2 !== offset1) ts = guess - offset2;
  return new Date(ts);
}

// Provider-local calendar date ("YYYY-MM-DD") for a UTC instant.
function localDateOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseHm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h! * 60 + m!;
}

// Day-of-week (0=Sun..6=Sat) of a calendar date — timezone-independent.
function dayOfWeek(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

function eachLocalDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let cur = Date.UTC(fy!, fm! - 1, fd!);
  const end = Date.UTC(ty!, tm! - 1, td!);
  while (cur <= end) {
    const dt = new Date(cur);
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    dates.push(`${dt.getUTCFullYear()}-${mm}-${dd}`);
    cur += DAY_MS;
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Loading + compute
// ---------------------------------------------------------------------------

async function loadProviderAndOption(
  providerId: string,
  serviceId: string,
  durationMinutes: number,
) {
  const prov = await db.query.provider.findFirst({
    where: eq(provider.id, providerId),
  });
  if (!prov || !prov.active) {
    throw new ORPCError("NOT_FOUND", { message: "Provider not found" });
  }
  const option = await db.query.providerServiceOption.findFirst({
    where: and(
      eq(providerServiceOption.providerId, providerId),
      eq(providerServiceOption.serviceId, serviceId),
      eq(providerServiceOption.durationMinutes, durationMinutes),
    ),
  });
  if (!option) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This provider does not offer that service at that length",
    });
  }
  return prov;
}

/**
 * Computes open appointment slots for a provider/service/duration across an
 * inclusive provider-local date range. Open = inside a weekly rule window, not
 * blocked by an exception, in the future, and not overlapping a booked
 * appointment. `getAvailability` and `createBooking` both route through this
 * code so their UTC grid keys are identical.
 */
export async function getAvailableSlots(args: {
  providerId: string;
  serviceId: string;
  durationMinutes: number;
  from: string; // provider-local "YYYY-MM-DD", inclusive
  to: string; // provider-local "YYYY-MM-DD", inclusive
  now: Date;
}): Promise<Slot[]> {
  const prov = await loadProviderAndOption(
    args.providerId,
    args.serviceId,
    args.durationMinutes,
  );
  const tz = prov.timezone;
  const increment = prov.slotIncrementMinutes;

  const dates = eachLocalDate(args.from, args.to);
  if (dates.length === 0) return [];

  const [rules, exceptions] = await Promise.all([
    db.query.availabilityRule.findMany({
      where: eq(availabilityRule.providerId, args.providerId),
    }),
    db.query.availabilityException.findMany({
      where: and(
        eq(availabilityException.providerId, args.providerId),
        gte(availabilityException.date, args.from),
        lte(availabilityException.date, args.to),
      ),
    }),
  ]);

  // UTC window covering the local range, used to fetch overlapping bookings.
  const rangeStart = zonedWallToUtc(args.from, 0, tz);
  const rangeEnd = zonedWallToUtc(args.to, 24 * 60, tz);
  const booked = await db
    .select({ startAt: appointment.startAt, endAt: appointment.endAt })
    .from(appointment)
    .where(
      and(
        eq(appointment.providerId, args.providerId),
        eq(appointment.status, "booked"),
        gt(appointment.endAt, rangeStart),
        lt(appointment.startAt, rangeEnd),
      ),
    );
  const bookedRanges = booked.map(
    (b) => [b.startAt.getTime(), b.endAt.getTime()] as const,
  );

  const rulesByDow = new Map<number, typeof rules>();
  for (const rule of rules) {
    const list = rulesByDow.get(rule.dayOfWeek) ?? [];
    list.push(rule);
    rulesByDow.set(rule.dayOfWeek, list);
  }
  const exceptionsByDate = new Map<string, typeof exceptions>();
  for (const ex of exceptions) {
    const list = exceptionsByDate.get(ex.date) ?? [];
    list.push(ex);
    exceptionsByDate.set(ex.date, list);
  }

  const nowMs = args.now.getTime();
  const byStart = new Map<number, Slot>();

  for (const date of dates) {
    const dayRules = rulesByDow.get(dayOfWeek(date));
    if (!dayRules?.length) continue;

    const dayExceptions = exceptionsByDate.get(date) ?? [];
    if (dayExceptions.some((ex) => ex.blockAllDay)) continue;
    const partialBlocks = dayExceptions
      .filter((ex) => !ex.blockAllDay && ex.startTime && ex.endTime)
      .map((ex) => [parseHm(ex.startTime!), parseHm(ex.endTime!)] as const);

    for (const rule of dayRules) {
      const winStart = parseHm(rule.startTime);
      const winEnd = parseHm(rule.endTime);
      for (
        let start = winStart;
        start + args.durationMinutes <= winEnd;
        start += increment
      ) {
        const end = start + args.durationMinutes;
        // Local-minute overlap with a partial-day block.
        if (partialBlocks.some(([bs, be]) => start < be && bs < end)) continue;

        const startAt = zonedWallToUtc(date, start, tz);
        if (startAt.getTime() <= nowMs) continue;
        const endAt = zonedWallToUtc(date, end, tz);

        const startMs = startAt.getTime();
        const endMs = endAt.getTime();
        // Interval overlap with an existing booking.
        if (bookedRanges.some(([bs, be]) => startMs < be && bs < endMs)) continue;

        byStart.set(startMs, { startAt, endAt });
      }
    }
  }

  return [...byStart.values()].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
}

/**
 * Re-validates that a specific requested startAt is a genuinely open slot for
 * the chosen duration. Returns the matching slot (with computed endAt) or null.
 * Used by createBooking before the transactional insert.
 */
export async function findOpenSlot(args: {
  providerId: string;
  serviceId: string;
  durationMinutes: number;
  startAt: Date;
  now: Date;
}): Promise<Slot | null> {
  const prov = await loadProviderAndOption(
    args.providerId,
    args.serviceId,
    args.durationMinutes,
  );
  const date = localDateOf(args.startAt, prov.timezone);
  const slots = await getAvailableSlots({
    providerId: args.providerId,
    serviceId: args.serviceId,
    durationMinutes: args.durationMinutes,
    from: date,
    to: date,
    now: args.now,
  });
  const target = args.startAt.getTime();
  return slots.find((s) => s.startAt.getTime() === target) ?? null;
}

/**
 * Finds the earliest open slot strictly after `after`, rolling forward across
 * days up to the booking horizon. Used to propose an alternative when a patient
 * loses a race for their chosen slot. Returns null if nothing is open in range.
 */
export async function findNextOpenSlot(args: {
  providerId: string;
  serviceId: string;
  durationMinutes: number;
  after: Date;
  now: Date;
}): Promise<Slot | null> {
  const prov = await loadProviderAndOption(
    args.providerId,
    args.serviceId,
    args.durationMinutes,
  );
  const afterMs = args.after.getTime();
  const horizonMs = args.now.getTime() + BOOKING_HORIZON_DAYS * DAY_MS;
  // Last provider-local date worth scanning — never propose past what
  // createBooking would accept.
  const horizonDate = localDateOf(new Date(horizonMs), prov.timezone);

  let from = localDateOf(args.after, prov.timezone);
  while (from <= horizonDate) {
    let to = addDaysLocal(from, SEARCH_WINDOW_DAYS - 1);
    if (to > horizonDate) to = horizonDate;
    const slots = await getAvailableSlots({
      providerId: args.providerId,
      serviceId: args.serviceId,
      durationMinutes: args.durationMinutes,
      from,
      to,
      now: args.now,
    });
    const next = slots.find(
      (s) => s.startAt.getTime() > afterMs && s.startAt.getTime() <= horizonMs,
    );
    if (next) return next;
    from = addDaysLocal(to, 1);
  }
  return null;
}

// Add `days` to a "YYYY-MM-DD" calendar date (timezone-independent).
function addDaysLocal(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!) + days * DAY_MS);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}
