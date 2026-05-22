# Better Auth in this repo (better-auth 1.6.x)

Better Auth runs as part of the Next.js app. Its REST endpoints are mounted at `/api/auth/*`, and the same `auth` instance is used server-side (in oRPC context) to verify sessions. Email/password is enabled; the Drizzle adapter persists to Postgres.

## Contents
- [The server instance](#the-server-instance)
- [How sessions reach oRPC](#how-sessions-reach-orpc)
- [The HTTP route](#the-http-route)
- [The React client](#the-react-client)
- [Protecting an endpoint](#protecting-an-endpoint)
- [Session caching (if asked)](#session-caching-if-asked)
- [Adding plugins / changing the schema](#adding-plugins--changing-the-schema)

## The server instance

`packages/auth/src/index.ts`:

```ts
import { createDb } from "@my-better-t-app/db";
import * as schema from "@my-better-t-app/db/schema/auth";
import { env } from "@my-better-t-app/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

export function createAuth() {
  const db = createDb();
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [nextCookies()],   // ← MUST stay last in the array
  });
}
export const auth = createAuth();
```

- The Drizzle adapter import is **`better-auth/adapters/drizzle`** (it ships inside core `better-auth`, not a separate package).
- **`nextCookies()` must be the last plugin.** It processes the final response to set cookies; if another plugin is added after it, server-side sign-in won't persist the session cookie.
- `secret` / `baseURL` / `trustedOrigins` come from validated env (`packages/env/src/server.ts`): `BETTER_AUTH_SECRET` (≥32 chars), `BETTER_AUTH_URL`, `CORS_ORIGIN`.

## How sessions reach oRPC

There is **no interception** between Better Auth and oRPC. The only thing crossing between them is the signed session cookie:

1. Sign-in (via `/api/auth/*`) sets the cookie (the `nextCookies()` plugin handles this).
2. On each oRPC request, `createContext` (`packages/api/src/context.ts`) calls `auth.api.getSession({ headers: req.headers })`, which reads the cookie, verifies it, looks up the session/user in Postgres via the Drizzle adapter, and returns `{ session, user }` or `null`.
3. That return value becomes `context.session`, which the `requireAuth` middleware checks.

`getSession` returns `{ session, user } | null` on the **server**. (The *client* `authClient.getSession()` wraps it as `{ data, error }` — different shape.) To force a fresh DB lookup bypassing any cookie cache: `getSession({ headers, query: { disableCookieCache: true } })`.

Note: `next/headers`' `headers()` is **async** — `await headers()` if you call it directly. The existing `createContext` uses `req.headers` off a `NextRequest`, which is already a `Headers` object, so no await is needed there.

## The HTTP route

`apps/web/src/app/api/auth/[...all]/route.ts` — keep the catch-all `[...all]` so every auth sub-route resolves:

```ts
import { auth } from "@my-better-t-app/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

## The React client

`apps/web/src/lib/auth-client.ts`:

```ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({});   // baseURL inferred (same origin)
```

`createAuthClient` is from **`better-auth/react`**. `baseURL` can be omitted because the auth server is same-origin; you'd only set it if auth lived on a different domain or a non-default path. Methods:

```ts
await authClient.signIn.email({ email, password });
await authClient.signUp.email({ email, password, name });
await authClient.signOut();
const { data: session, isPending } = authClient.useSession();
```

## Protecting an endpoint

Use `protectedProcedure` (see `references/orpc.md`). It runs the `requireAuth` middleware, so inside the handler `context.session.user` is guaranteed:

```ts
me: protectedProcedure.handler(({ context }) => context.session.user),
```

If `context.session?.user` is missing, the middleware throws `ORPCError("UNAUTHORIZED")` before the handler runs.

## Session caching (if asked)

Lookups currently hit Postgres on every request — there's no caching layer. To add one, edit the `betterAuth({...})` config in `packages/auth/src/index.ts`:

- **Cookie cache (no new deps)** — stores a signed, short-lived session copy in the cookie so `getSession` skips the DB:
  ```ts
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  ```
  Trade-off: a revoked session stays valid until `maxAge` expires (bypass per-call with `disableCookieCache: true`).
- **Secondary storage (Redis, needs a dep + instance)** — add a `secondaryStorage: { get, set, delete }` adapter for a shared server-side cache across instances. Requires adding a Redis client to `packages/auth/package.json` (pin via the pnpm catalog) and running Redis.

Neither touches `context.ts` — `getSession` uses them transparently.

## Adding plugins / changing the schema

When you add a plugin that needs new columns/tables, regenerate the Better Auth schema, then apply it with Drizzle:

```bash
npx @better-auth/cli@latest generate --config packages/auth/src/index.ts --output packages/db/src/schema/auth.ts
pnpm db:push
```

(Newer Better Auth also exposes `npx auth@latest generate`; the `@better-auth/cli` form above is the safe fallback.) The Drizzle `migrate` built into Better Auth's CLI only supports its Kysely adapter — since this repo uses Drizzle, **always apply schema changes with `pnpm db:push` / `db:generate`**, not the auth CLI's migrate.

The core tables (`user`, `session`, `account`, `verification`) and their relations already exist in `packages/db/src/schema/auth.ts`.
