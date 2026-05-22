import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

const requireClinician = o.middleware(async ({ context, next }) => {
  const user = context.session?.user;
  if (!user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  // `role` rides along on the session via Better Auth's user.additionalFields.
  if ((user as { role?: string }).role !== "clinician") {
    throw new ORPCError("FORBIDDEN", {
      message: "Clinician access required",
    });
  }
  return next({
    context: {
      session: context.session,
      user,
    },
  });
});

export const clinicianProcedure = publicProcedure.use(requireClinician);
