import { db } from "@my-better-t-app/db";
import {
  appointment,
  availabilityException,
  availabilityRule,
  provider,
  providerServiceOption,
  service,
} from "@my-better-t-app/db/schema/booking";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";

import { clinicianProcedure } from "../index";

const DAY_MS = 86_400_000;
const careTypeSchema = z.enum(["physical_therapy", "chiropractic"]);
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Expected HH:MM (24h)" });

const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      // Throws RangeError for an invalid IANA zone.
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { error: "Invalid IANA timezone" },
);

function endOfDayExclusiveUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) + DAY_MS);
}
function startOfDayUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

// Throws unless `userId` owns the given provider. The clinician role gates the
// procedures; this second check keeps one clinician from editing another's
// provider by passing a foreign providerId.
async function assertOwnsProvider(userId: string, providerId: string) {
  const row = await db.query.provider.findFirst({
    where: eq(provider.id, providerId),
    columns: { userId: true },
  });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Provider not found" });
  }
  if (row.userId !== userId) {
    throw new ORPCError("FORBIDDEN", {
      message: "You do not manage this provider",
    });
  }
}

export const adminRouter = {
  // The provider this clinician manages, with its current schedule config.
  // Returns null if the clinician hasn't been linked to a provider yet.
  myProvider: clinicianProcedure.handler(async ({ context }) => {
    const row = await db.query.provider.findFirst({
      where: eq(provider.userId, context.user.id),
      with: {
        availabilityRules: true,
        availabilityExceptions: true,
        serviceOptions: { with: { service: true } },
      },
    });
    return row ?? null;
  }),

  createProvider: clinicianProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        timezone: timezoneSchema,
        slotIncrementMinutes: z.int().min(5).max(240),
      }),
    )
    .handler(async ({ input, context }) => {
      // The creating clinician owns the new provider.
      const [row] = await db
        .insert(provider)
        .values({ ...input, userId: context.user.id })
        .returning();
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return row;
    }),

  updateProvider: clinicianProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        timezone: timezoneSchema.optional(),
        slotIncrementMinutes: z.int().min(5).max(240).optional(),
        active: z.boolean().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const { id, ...patch } = input;
      await assertOwnsProvider(context.user.id, id);
      const [row] = await db
        .update(provider)
        .set(patch)
        .where(eq(provider.id, id))
        .returning();
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Provider not found" });
      return row;
    }),

  createService: clinicianProcedure
    .input(
      z.object({
        careType: careTypeSchema,
        name: z.string().min(1).max(120),
      }),
    )
    .handler(async ({ input }) => {
      const [row] = await db.insert(service).values(input).returning();
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return row;
    }),

  updateService: clinicianProcedure
    .input(
      z.object({
        id: z.string().min(1),
        careType: careTypeSchema.optional(),
        name: z.string().min(1).max(120).optional(),
        active: z.boolean().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { id, ...patch } = input;
      const [row] = await db
        .update(service)
        .set(patch)
        .where(eq(service.id, id))
        .returning();
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Service not found" });
      return row;
    }),

  // Replace the full set of offered lengths for a provider+service.
  setProviderServiceOptions: clinicianProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
        serviceId: z.string().min(1),
        durationMinutes: z.array(z.int().positive().max(600)).min(1),
      }),
    )
    .handler(async ({ input, context }) => {
      await assertOwnsProvider(context.user.id, input.providerId);
      const unique = [...new Set(input.durationMinutes)];
      await db.transaction(async (tx) => {
        await tx
          .delete(providerServiceOption)
          .where(
            and(
              eq(providerServiceOption.providerId, input.providerId),
              eq(providerServiceOption.serviceId, input.serviceId),
            ),
          );
        await tx.insert(providerServiceOption).values(
          unique.map((durationMinutes) => ({
            providerId: input.providerId,
            serviceId: input.serviceId,
            durationMinutes,
          })),
        );
      });
      return { providerId: input.providerId, serviceId: input.serviceId, durationMinutes: unique };
    }),

  // Replace the provider's full weekly availability schedule.
  setAvailabilityRules: clinicianProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
        rules: z
          .array(
            z
              .object({
                dayOfWeek: z.int().min(0).max(6),
                startTime: hhmm,
                endTime: hhmm,
              })
              .refine((r) => r.startTime < r.endTime, {
                error: "startTime must be before endTime",
              }),
          )
          .max(50),
      }),
    )
    .handler(async ({ input, context }) => {
      await assertOwnsProvider(context.user.id, input.providerId);
      await db.transaction(async (tx) => {
        await tx
          .delete(availabilityRule)
          .where(eq(availabilityRule.providerId, input.providerId));
        if (input.rules.length > 0) {
          await tx.insert(availabilityRule).values(
            input.rules.map((r) => ({
              providerId: input.providerId,
              dayOfWeek: r.dayOfWeek,
              startTime: r.startTime,
              endTime: r.endTime,
            })),
          );
        }
      });
      return { providerId: input.providerId, count: input.rules.length };
    }),

  createAvailabilityException: clinicianProcedure
    .input(
      z
        .object({
          providerId: z.string().min(1),
          date: z.iso.date(),
          blockAllDay: z.boolean().default(true),
          startTime: hhmm.optional(),
          endTime: hhmm.optional(),
          reason: z.string().max(200).optional(),
        })
        .refine(
          (v) =>
            v.blockAllDay ||
            (v.startTime !== undefined && v.endTime !== undefined),
          { error: "Partial blocks require startTime and endTime" },
        ),
    )
    .handler(async ({ input, context }) => {
      await assertOwnsProvider(context.user.id, input.providerId);
      const [row] = await db
        .insert(availabilityException)
        .values({
          providerId: input.providerId,
          date: input.date,
          blockAllDay: input.blockAllDay,
          startTime: input.startTime ?? null,
          endTime: input.endTime ?? null,
          reason: input.reason ?? null,
        })
        .returning();
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return row;
    }),

  deleteAvailabilityException: clinicianProcedure
    .input(z.object({ id: z.string().min(1) }))
    .handler(async ({ input, context }) => {
      const existing = await db.query.availabilityException.findFirst({
        where: eq(availabilityException.id, input.id),
        columns: { providerId: true },
      });
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Exception not found" });
      }
      await assertOwnsProvider(context.user.id, existing.providerId);
      const [row] = await db
        .delete(availabilityException)
        .where(eq(availabilityException.id, input.id))
        .returning();
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Exception not found" });
      return { id: row.id };
    }),

  // The provider's schedule for a date range — includes patient PII, hence protected.
  listAppointments: clinicianProcedure
    .input(
      z
        .object({
          providerId: z.string().min(1),
          from: z.iso.date(),
          to: z.iso.date(),
        })
        .refine((v) => v.from <= v.to, {
          error: "`from` must be on or before `to`",
        }),
    )
    .handler(async ({ input, context }) => {
      await assertOwnsProvider(context.user.id, input.providerId);
      const rows = await db
        .select()
        .from(appointment)
        .where(
          and(
            eq(appointment.providerId, input.providerId),
            gte(appointment.startAt, startOfDayUtc(input.from)),
            lt(appointment.startAt, endOfDayExclusiveUtc(input.to)),
          ),
        )
        .orderBy(asc(appointment.startAt));
      return rows.map((r) => ({
        ...r,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    }),
};
