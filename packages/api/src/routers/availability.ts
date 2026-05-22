import { db } from "@my-better-t-app/db";
import {
  provider,
  providerServiceOption,
  service,
} from "@my-better-t-app/db/schema/booking";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { z } from "zod";

import { publicProcedure } from "../index";
import { getAvailableSlots } from "../lib/availability";
import { rateLimit } from "../middleware/rate-limit";

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 14;
const BOOKING_HORIZON_DAYS = 60;

const careTypeSchema = z.enum(["physical_therapy", "chiropractic"]);

function rangeDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (
    Math.round(
      (Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / DAY_MS,
    ) + 1
  );
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysUtc(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export const availabilityRouter = {
  // Care types / services offered, optionally filtered by care type.
  listServices: publicProcedure
    .use(rateLimit({ key: "listServices", limit: 60, windowMs: 60_000 }))
    .input(z.object({ careType: careTypeSchema.optional() }))
    .handler(async ({ input }) => {
      const filters = [eq(service.active, true)];
      if (input.careType) filters.push(eq(service.careType, input.careType));
      return db
        .select({
          id: service.id,
          careType: service.careType,
          name: service.name,
        })
        .from(service)
        .where(and(...filters));
    }),

  // Active providers, optionally restricted to those offering a service / care type.
  listProviders: publicProcedure
    .use(rateLimit({ key: "listProviders", limit: 60, windowMs: 60_000 }))
    .input(
      z.object({
        serviceId: z.string().min(1).optional(),
        careType: careTypeSchema.optional(),
      }),
    )
    .handler(async ({ input }) => {
      let providerIds: string[] | null = null;

      if (input.serviceId || input.careType) {
        let serviceIds: string[];
        if (input.serviceId) {
          serviceIds = [input.serviceId];
        } else {
          const svc = await db
            .select({ id: service.id })
            .from(service)
            .where(
              and(
                eq(service.active, true),
                eq(service.careType, input.careType!),
              ),
            );
          serviceIds = svc.map((s) => s.id);
        }
        if (serviceIds.length === 0) return [];

        const opts = await db
          .selectDistinct({ providerId: providerServiceOption.providerId })
          .from(providerServiceOption)
          .where(inArray(providerServiceOption.serviceId, serviceIds));
        providerIds = opts.map((o) => o.providerId);
        if (providerIds.length === 0) return [];
      }

      const filters = [eq(provider.active, true)];
      if (providerIds) filters.push(inArray(provider.id, providerIds));
      return db
        .select({
          id: provider.id,
          name: provider.name,
          timezone: provider.timezone,
        })
        .from(provider)
        .where(and(...filters));
    }),

  // Free-text search for active providers by name, with their care types so the
  // UI can show the right specialty badge/crest. Optional careType narrows it.
  searchProviders: publicProcedure
    .use(rateLimit({ key: "searchProviders", limit: 60, windowMs: 60_000 }))
    .input(
      z.object({
        query: z.string().trim().min(1).max(100),
        careType: careTypeSchema.optional(),
      }),
    )
    .handler(async ({ input }) => {
      // Escape LIKE wildcards in user input (default escape char is backslash).
      const term = input.query.replace(/[%_\\]/g, "\\$&");
      const matched = await db
        .select({
          id: provider.id,
          name: provider.name,
          timezone: provider.timezone,
        })
        .from(provider)
        .where(
          and(eq(provider.active, true), ilike(provider.name, `%${term}%`)),
        );
      if (matched.length === 0) return [];

      const ids = matched.map((p) => p.id);
      const careRows = await db
        .selectDistinct({
          providerId: providerServiceOption.providerId,
          careType: service.careType,
        })
        .from(providerServiceOption)
        .innerJoin(service, eq(service.id, providerServiceOption.serviceId))
        .where(
          and(
            inArray(providerServiceOption.providerId, ids),
            eq(service.active, true),
          ),
        );

      const careByProvider = new Map<string, string[]>();
      for (const row of careRows) {
        const list = careByProvider.get(row.providerId) ?? [];
        if (!list.includes(row.careType)) list.push(row.careType);
        careByProvider.set(row.providerId, list);
      }

      const result = matched.map((p) => ({
        ...p,
        careTypes: careByProvider.get(p.id) ?? [],
      }));

      return input.careType
        ? result.filter((p) => p.careTypes.includes(input.careType!))
        : result;
    }),

  // Appointment lengths a provider offers for a service (so the patient can pick).
  listDurations: publicProcedure
    .use(rateLimit({ key: "listDurations", limit: 60, windowMs: 60_000 }))
    .input(
      z.object({
        providerId: z.string().min(1),
        serviceId: z.string().min(1),
      }),
    )
    .handler(async ({ input }) => {
      const rows = await db
        .select({ durationMinutes: providerServiceOption.durationMinutes })
        .from(providerServiceOption)
        .where(
          and(
            eq(providerServiceOption.providerId, input.providerId),
            eq(providerServiceOption.serviceId, input.serviceId),
          ),
        );
      return rows.map((r) => r.durationMinutes).sort((a, b) => a - b);
    }),

  // Computed open slots for a provider/service/duration over a local date range.
  getAvailability: publicProcedure
    .use(rateLimit({ key: "getAvailability", limit: 60, windowMs: 60_000 }))
    .input(
      z
        .object({
          providerId: z.string().min(1),
          serviceId: z.string().min(1),
          durationMinutes: z.int().positive().max(600),
          from: z.iso.date(),
          to: z.iso.date(),
        })
        .refine((v) => v.from <= v.to, {
          error: "`from` must be on or before `to`",
        })
        .refine((v) => rangeDays(v.from, v.to) <= MAX_RANGE_DAYS, {
          error: `Date range may not exceed ${MAX_RANGE_DAYS} days`,
        })
        .refine((v) => v.to >= todayUtc(), {
          error: "`to` is in the past",
        })
        .refine((v) => v.from <= addDaysUtc(todayUtc(), BOOKING_HORIZON_DAYS), {
          error: `Cannot look more than ${BOOKING_HORIZON_DAYS} days ahead`,
        }),
    )
    .handler(async ({ input }) => {
      const slots = await getAvailableSlots({
        providerId: input.providerId,
        serviceId: input.serviceId,
        durationMinutes: input.durationMinutes,
        from: input.from,
        to: input.to,
        now: new Date(),
      });
      return {
        providerId: input.providerId,
        serviceId: input.serviceId,
        durationMinutes: input.durationMinutes,
        slots: slots.map((s) => ({
          startAt: s.startAt.toISOString(),
          endAt: s.endAt.toISOString(),
        })),
      };
    }),
};
