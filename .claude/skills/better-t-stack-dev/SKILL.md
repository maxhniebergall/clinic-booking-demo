---
name: better-t-stack-dev
description: >-
  Authoring guide for THIS Better-T-Stack monorepo (my-better-t-app): a single
  Next.js 16 app with a "self" backend exposing a type-safe oRPC API, Better
  Auth (Drizzle/Postgres), Drizzle ORM, Zod v4, Turborepo + pnpm catalog, and
  shadcn/ui. Use this skill whenever working in this repo and the task touches
  any of: adding/editing an oRPC procedure or router, defining or changing
  Drizzle schema/tables/migrations, configuring or calling Better Auth (sign-in,
  sessions, getSession, plugins), env vars via @t3-oss/env, the pnpm catalog or
  workspace packages, Turborepo tasks/scripts, or adding shadcn/ui components.
  Trigger it even when the user names a library casually ("add an endpoint",
  "new table", "protect this route", "wire up login") without saying "oRPC" or
  "Drizzle" — because these libraries move fast and have version-specific APIs
  (oRPC 1.x, Better Auth 1.6, Drizzle 0.45, Zod v4) that are easy to get wrong
  from memory. Reach for it before writing code against this stack.
---

# Working in my-better-t-app (Better-T-Stack)

This repo is a **single Next.js 16 app** (`apps/web`) with **no separate backend server** — the API runs inside Next.js route handlers (the "self" backend). Workspace packages provide the API, auth, db, env, and UI. End-to-end type safety flows from the server router type into the client with **no codegen step**.

Run all commands from the repo root (`my-better-t-app/`). Package manager is **pnpm 9.15** with **Turborepo**.

## Orientation: where things live

| Concern | Path |
| --- | --- |
| API entry (oRPC handler) | `apps/web/src/app/api/rpc/[[...rest]]/route.ts` |
| Auth HTTP routes | `apps/web/src/app/api/auth/[...all]/route.ts` |
| Procedures (`publicProcedure`/`protectedProcedure`) | `packages/api/src/index.ts` |
| Per-request context (session) | `packages/api/src/context.ts` |
| The router (`appRouter`) — **add endpoints here** | `packages/api/src/routers/index.ts` |
| Better Auth server instance | `packages/auth/src/index.ts` |
| Drizzle db + `createDb()` | `packages/db/src/index.ts` |
| Drizzle schema (add tables here) | `packages/db/src/schema/` (re-export from `index.ts`) |
| drizzle-kit config | `packages/db/drizzle.config.ts` |
| Env validation | `packages/env/src/server.ts` (and `web.ts`) |
| oRPC client + TanStack Query utils | `apps/web/src/utils/orpc.ts` |
| Better Auth React client | `apps/web/src/lib/auth-client.ts` |
| Shared UI primitives | `packages/ui/src/components/` |

## Read the reference for the task at hand

This SKILL.md covers the cross-cutting gotchas. For the actual API patterns of a given task, read the matching file — they contain version-correct, copy-ready snippets grounded in this repo's style:

- **Adding/editing an API endpoint** → `references/orpc.md`
- **Database schema, queries, migrations** → `references/drizzle.md`
- **Auth: config, sessions, sign-in/out, protecting routes** → `references/better-auth.md`
- **Monorepo plumbing: deps/catalog, env, Turbo scripts, shadcn, tsconfig** → `references/conventions.md`

## Critical version-specific facts (easy to get wrong from memory)

These libraries changed their APIs recently. Getting these wrong produces code that *looks* right but fails to compile or run. Internalize these before writing:

1. **Zod is v4 here.** Use top-level string formats: `z.email()`, `z.url()`, `z.uuid()` — not `z.string().email()`. Custom messages use the unified `error` key: `z.string().min(1, { error: "Required" })`, not `message:`/`required_error:`. (See `packages/env/src/server.ts`, which already uses `z.url()`.)

2. **oRPC + Zod v4 needs the `@orpc/zod/zod4` subpath.** The OpenAPI converter is imported as `import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4"` (already done in `route.ts`). The plain `@orpc/zod` import is the *Zod 3* converter and is wrong here.

3. **oRPC handlers take one destructured arg** `{ input, context, errors }` — the field is `context`, not `ctx`. Procedures have **no `.query()`/`.mutation()` split** (unlike tRPC) — there's only `.handler()`. Whether something is a query or mutation is decided client-side by which TanStack util you call.

4. **`handler.handle()` returns `{ matched, response }`** and does **not** auto-404 — the entry route checks `rpcResult.response` and falls through. Don't assume it throws.

5. **Better Auth: `nextCookies()` must be the LAST plugin** in the `plugins` array, or server-side sign-in won't set cookies. (See `packages/auth/src/index.ts`.)

6. **`next/headers` `headers()` is async.** When verifying sessions, `await auth.api.getSession({ headers: await headers() })`. The existing `createContext` passes `req.headers` (a `NextRequest`'s headers), which is already a `Headers` object — but anywhere you reach for `next/headers`, await it.

7. **Drizzle index syntax is the array form**: the second arg to `pgTable` returns an **array**: `(table) => [index("...").on(table.col)]`, not an object. (See `packages/db/src/schema/auth.ts`.)

8. **Schema changes need `pnpm db:push`** (dev) to take effect. There are no migration files unless you run `pnpm db:generate`.

## TypeScript strictness gotchas (from the shared tsconfig)

`packages/config/tsconfig.base.json` sets these, and they bite:

- **`verbatimModuleSyntax: true`** → type-only imports MUST use `import type`. Mixing a type into a value import is a compile error. Match the existing files (e.g. `import type { Context } from "./context"`).
- **`noUncheckedIndexedAccess: true`** → array/index access is `T | undefined`. After `const [row] = await db.insert(...).returning()`, `row` is possibly `undefined` — narrow it before use.
- **`noUnusedLocals` / `noUnusedParameters`** → unused imports/params fail the typecheck.

## Always verify before declaring done

There is **no test runner and no lint script** in this repo. The check that matters is the typechecker, which catches the strictness issues above and any stale-API mistakes:

```bash
pnpm check-types          # turbo check-types across all packages
pnpm db:push              # only if you changed Drizzle schema
```

If you started the dev server to verify a change, it's on **http://localhost:3001** (note: 3001, not 3000). The Scalar API reference is at `http://localhost:3001/api/rpc/api-reference`.
