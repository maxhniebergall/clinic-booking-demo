import { createDb } from "@my-better-t-app/db";
import * as schema from "@my-better-t-app/db/schema/auth";
import { env } from "@my-better-t-app/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        // "patient" | "clinician". `input: false` keeps clients from setting
        // their own role at sign-up — promotion happens server-side.
        role: {
          type: "string",
          required: false,
          defaultValue: "patient",
          input: false,
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [
      // Lets anonymous patients sign in by email so they can see all their
      // bookings. Email delivery is MOCKED for this local build: the link is
      // printed to the server console instead of being sent. Swap the body of
      // sendMagicLink for a real email provider in production.
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          console.log(
            `\n[mock magic-link] Sign-in link for ${email}:\n  ${url}\n`,
          );
        },
      }),
      // nextCookies() MUST stay last so it can set the session cookie on the
      // final response.
      nextCookies(),
    ],
  });
}

export const auth = createAuth();
