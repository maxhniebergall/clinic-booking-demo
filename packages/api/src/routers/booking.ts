import { randomBytes } from "node:crypto";

import { db } from "@my-better-t-app/db";
import { appointment } from "@my-better-t-app/db/schema/booking";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, publicProcedure } from "../index";
import { findNextOpenSlot, findOpenSlot } from "../lib/availability";
import { isOverlapViolation } from "../lib/errors";
import { rateLimit } from "../middleware/rate-limit";

const DAY_MS = 86_400_000;
const BOOKING_HORIZON_DAYS = 60;

export const bookingRouter = {
  // Anonymous booking. The patient supplies their own contact details and gets
  // back a secret confirmationToken used to view/cancel the booking later.
  createBooking: publicProcedure
    .use(rateLimit({ key: "createBooking", limit: 5, windowMs: 60_000 }))
    .errors({
      SLOT_TAKEN: {
        status: 409,
        message: "That time was just booked by someone else.",
        data: z.object({
          nextSlot: z
            .object({
              startAt: z.iso.datetime(),
              endAt: z.iso.datetime(),
            })
            .nullable(),
        }),
      },
    })
    .input(
      z.object({
        providerId: z.string().min(1),
        serviceId: z.string().min(1),
        durationMinutes: z.int().positive().max(600),
        startAt: z.iso.datetime(),
        patientName: z.string().min(1).max(120),
        patientEmail: z.email().max(254),
        patientPhone: z
          .string()
          .min(7)
          .max(32)
          .regex(/^[0-9+\-() ]+$/, { error: "Invalid phone number" }),
        notes: z.string().max(1000).optional(),
      }),
    )
    .handler(async ({ input, context, errors }) => {
      const now = new Date();
      // Associate the booking with the patient's account when they're logged
      // in. Anonymous bookings (userId null) are managed via confirmationToken.
      const userId = context.session?.user?.id ?? null;
      const startAt = new Date(input.startAt);
      if (startAt.getTime() <= now.getTime()) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Start time must be in the future",
        });
      }
      if (startAt.getTime() > now.getTime() + BOOKING_HORIZON_DAYS * DAY_MS) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Cannot book more than ${BOOKING_HORIZON_DAYS} days ahead`,
        });
      }

      // Builds the SLOT_TAKEN conflict, attaching the next open slot (if any)
      // so the client can offer it. Used both when the slot is already gone by
      // submit time and when a concurrent insert wins the exclusion-constraint
      // race below.
      async function slotTaken(after: Date) {
        const next = await findNextOpenSlot({
          providerId: input.providerId,
          serviceId: input.serviceId,
          durationMinutes: input.durationMinutes,
          after,
          now,
        });
        return errors.SLOT_TAKEN({
          data: {
            nextSlot: next
              ? {
                  startAt: next.startAt.toISOString(),
                  endAt: next.endAt.toISOString(),
                }
              : null,
          },
        });
      }

      // Re-validate server-side that this is a genuinely open, on-grid slot.
      // A miss here is the common case: someone else booked it before this
      // patient submitted (the slot is gone from a now-stale availability list).
      const slot = await findOpenSlot({
        providerId: input.providerId,
        serviceId: input.serviceId,
        durationMinutes: input.durationMinutes,
        startAt,
        now,
      });
      if (!slot) {
        throw await slotTaken(startAt);
      }

      const confirmationToken = randomBytes(32).toString("base64url");

      try {
        const row = await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(appointment)
            .values({
              providerId: input.providerId,
              serviceId: input.serviceId,
              userId,
              status: "booked",
              startAt: slot.startAt,
              endAt: slot.endAt,
              durationMinutes: input.durationMinutes,
              patientName: input.patientName,
              patientEmail: input.patientEmail,
              patientPhone: input.patientPhone,
              notes: input.notes ?? null,
              confirmationToken,
            })
            .returning();
          return inserted;
        });
        if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
        return {
          id: row.id,
          confirmationToken: row.confirmationToken,
          status: row.status,
          startAt: row.startAt.toISOString(),
          endAt: row.endAt.toISOString(),
        };
      } catch (err) {
        // The no-overlap exclusion constraint adjudicates concurrent bookings:
        // the loser lands here and gets a clean conflict instead of a 500.
        if (isOverlapViolation(err)) {
          throw await slotTaken(slot.startAt);
        }
        throw err;
      }
    }),

  // Look up a booking by its secret token (the capability to view it).
  getBooking: publicProcedure
    .use(rateLimit({ key: "getBooking", limit: 20, windowMs: 60_000 }))
    .input(z.object({ confirmationToken: z.string().min(1) }))
    .handler(async ({ input }) => {
      const row = await db.query.appointment.findFirst({
        where: eq(appointment.confirmationToken, input.confirmationToken),
        with: {
          provider: { columns: { name: true, timezone: true } },
          service: { columns: { name: true, careType: true } },
        },
      });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Booking not found" });
      }
      return {
        id: row.id,
        providerId: row.providerId,
        serviceId: row.serviceId,
        status: row.status,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        durationMinutes: row.durationMinutes,
        patientName: row.patientName,
        patientEmail: row.patientEmail,
        patientPhone: row.patientPhone,
        notes: row.notes,
        providerName: row.provider.name,
        providerTimezone: row.provider.timezone,
        serviceName: row.service.name,
        careType: row.service.careType,
      };
    }),

  // Cancel a booking by its token. Frees the slot (the exclusion constraint only
  // covers status = 'booked'), so the time becomes re-bookable.
  cancelBooking: publicProcedure
    .use(rateLimit({ key: "cancelBooking", limit: 20, windowMs: 60_000 }))
    .input(z.object({ confirmationToken: z.string().min(1) }))
    .handler(async ({ input }) => {
      const row = await db.query.appointment.findFirst({
        where: eq(appointment.confirmationToken, input.confirmationToken),
      });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Booking not found" });
      }
      if (row.status !== "booked") {
        throw new ORPCError("BAD_REQUEST", {
          message: `Cannot cancel a ${row.status} appointment`,
        });
      }
      const [updated] = await db
        .update(appointment)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(appointment.id, row.id))
        .returning();
      if (!updated) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return { id: updated.id, status: updated.status };
    }),

  // All bookings belonging to the logged-in patient. First "claims" any past
  // anonymous bookings made with this user's email (userId null) so bookings
  // placed before signing in — including via the magic link — show up here.
  listMyBookings: protectedProcedure.handler(async ({ context }) => {
    const { id: userId, email } = context.session.user;

    await db
      .update(appointment)
      .set({ userId })
      .where(
        and(eq(appointment.patientEmail, email), isNull(appointment.userId)),
      );

    const rows = await db.query.appointment.findMany({
      where: eq(appointment.userId, userId),
      orderBy: [desc(appointment.startAt)],
      with: {
        provider: { columns: { name: true, timezone: true } },
        service: { columns: { name: true, careType: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      durationMinutes: r.durationMinutes,
      notes: r.notes,
      confirmationToken: r.confirmationToken,
      providerName: r.provider.name,
      providerTimezone: r.provider.timezone,
      serviceName: r.service.name,
      careType: r.service.careType,
    }));
  }),
};
