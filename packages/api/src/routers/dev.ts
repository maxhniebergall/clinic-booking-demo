import { db } from "@my-better-t-app/db";
import { user } from "@my-better-t-app/db/schema/auth";
import { provider } from "@my-better-t-app/db/schema/booking";
import { env } from "@my-better-t-app/env/server";
import { ORPCError } from "@orpc/server";
import { eq, isNull } from "drizzle-orm";

import { protectedProcedure } from "../index";

/**
 * Local-only helpers. Promoting yourself to a clinician would be a privilege-
 * escalation hole in production, so every procedure here refuses to run unless
 * NODE_ENV is "development". Real deployments would seed clinicians out-of-band.
 */
function assertDev() {
  if (env.NODE_ENV !== "development") {
    throw new ORPCError("FORBIDDEN", {
      message: "Dev-only endpoint",
    });
  }
}

export const devRouter = {
  // Promote the current user to a clinician and link them to a provider so the
  // /clinician page has something to manage. Claims the first unowned demo
  // provider, or creates a fresh one if none are free.
  becomeClinician: protectedProcedure.handler(async ({ context }) => {
    assertDev();
    const userId = context.session.user.id;

    await db.update(user).set({ role: "clinician" }).where(eq(user.id, userId));

    const existing = await db.query.provider.findFirst({
      where: eq(provider.userId, userId),
    });
    if (existing) {
      return { providerId: existing.id, providerName: existing.name };
    }

    const unowned = await db.query.provider.findFirst({
      where: isNull(provider.userId),
    });
    if (unowned) {
      await db
        .update(provider)
        .set({ userId })
        .where(eq(provider.id, unowned.id));
      return { providerId: unowned.id, providerName: unowned.name };
    }

    const [created] = await db
      .insert(provider)
      .values({
        userId,
        name: `${context.session.user.name}'s practice`,
        timezone: "America/Toronto",
        slotIncrementMinutes: 15,
      })
      .returning();
    if (!created) throw new ORPCError("INTERNAL_SERVER_ERROR");
    return { providerId: created.id, providerName: created.name };
  }),
};
