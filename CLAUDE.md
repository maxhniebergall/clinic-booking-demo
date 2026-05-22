# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout note

The git repository and all code live in `my-better-t-app/` (a sibling of this parent workspace). Run all commands below from `my-better-t-app/`.

## Commands

Package manager is **pnpm** (v9.15) with Turborepo. Run from the repo root:

- `pnpm dev` — start everything in dev (web on http://localhost:3001)
- `pnpm dev:web` — start only the web app
- `pnpm build` — build all
- `pnpm check-types` — typecheck all packages (there is no separate lint setup; `turbo lint` exists but no package defines a lint script)
- `pnpm db:push` — push Drizzle schema to Postgres (no migration files)
- `pnpm db:generate` — generate SQL migrations into `packages/db/src/migrations`
- `pnpm db:migrate` — apply migrations
- `pnpm db:studio` — open Drizzle Studio

There is no test runner configured in this project.

To add shared shadcn/ui primitives: `npx shadcn@latest add <component> -c packages/ui` (run from repo root). App-specific blocks: run shadcn from `apps/web`.

## Architecture

Better-T-Stack monorepo: a single Next.js app (`apps/web`) backed by workspace packages. There is **no standalone backend server** — the API runs inside Next.js route handlers ("self" backend).

**Request flow (oRPC):**
- `apps/web/src/app/api/rpc/[[...rest]]/route.ts` is the single catch-all entry point. It runs the oRPC `RPCHandler` first (prefix `/api/rpc`), then falls back to the `OpenAPIHandler` which serves a Scalar API reference at `/api/rpc/api-reference`.
- `packages/api` defines the API. `src/index.ts` creates `publicProcedure` and `protectedProcedure` (the latter via a `requireAuth` middleware that throws `UNAUTHORIZED` if no session). `src/context.ts` builds per-request `Context` by reading the Better-Auth session from request headers. `src/routers/index.ts` is the `appRouter` and exports `AppRouter` / `AppRouterClient` types.
- The client side (`apps/web/src/utils/orpc.ts`) builds a type-safe `client` from `AppRouterClient` plus TanStack Query utils (`orpc`). It is isomorphic: in the browser it calls `/api/rpc` with credentials; server-side it forwards `next/headers`.

End-to-end type safety comes from `appRouter`'s type flowing into the web client — no codegen step. To add an endpoint, add a procedure to `appRouter` in `packages/api/src/routers/index.ts`.

**Auth (`packages/auth`):** Better-Auth with the Drizzle adapter (Postgres) and email/password enabled. `auth` is the server instance; `apps/web/src/lib/auth-client.ts` exposes the React `authClient`. Auth HTTP routes are mounted at `apps/web/src/app/api/auth/[...all]/route.ts`. Auth tables live in `packages/db/src/schema/auth.ts`.

**Database (`packages/db`):** Drizzle ORM over `node-postgres`. `createDb()` / exported `db` read `DATABASE_URL`. Schema is in `src/schema/` (re-exported from `src/schema/index.ts`). Note `drizzle.config.ts` reads env from `apps/web/.env`, so the web app's `.env` is the single source of DB config.

**Env (`packages/env`):** Type-safe env via `@t3-oss/env`. `@my-better-t-app/env/server` validates `DATABASE_URL`, `BETTER_AUTH_SECRET` (min 32 chars), `BETTER_AUTH_URL`, `CORS_ORIGIN`, `NODE_ENV`. Import server env from this package rather than reading `process.env` directly.

**UI (`packages/ui`):** Shared shadcn/ui primitives, imported as `@my-better-t-app/ui/components/<name>`. Design tokens / global styles in `src/styles/globals.css`. Built on `@base-ui/react`, Tailwind v4, `next-themes`.

## Conventions

- Workspace packages are named `@my-better-t-app/*` and reference each other with `workspace:*`.
- Shared dependency versions are pinned in the pnpm **catalog** (`pnpm-workspace.yaml`); reference them as `"catalog:"` in package.json instead of hardcoding versions.
- Packages export raw TypeScript source (`./src/*.ts`) — there is no build step for internal packages; Next.js / Turbo consume the `.ts` directly.
- Zod v4 is used (note oRPC imports from `@orpc/zod/zod4`).
- TS config extends `@my-better-t-app/config/tsconfig.base.json`.
- The web app uses the React Compiler (`babel-plugin-react-compiler`).
