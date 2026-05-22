# Monorepo conventions

The plumbing that's specific to this repo: dependency management, env, scripts, shadcn/ui, and TypeScript config. Getting these right keeps changes consistent with the rest of the codebase.

## Contents
- [Workspace packages](#workspace-packages)
- [Dependencies & the pnpm catalog](#dependencies--the-pnpm-catalog)
- [Environment variables](#environment-variables)
- [Scripts & Turborepo](#scripts--turborepo)
- [shadcn/ui](#shadcnui)
- [TypeScript config](#typescript-config)

## Workspace packages

Packages are named `@my-better-t-app/*` and reference each other with `workspace:*`:

- `@my-better-t-app/api`, `/auth`, `/db`, `/env`, `/ui`, `/config`.

**Internal packages export raw TypeScript** (`./src/*.ts`) — there is **no build step** for them; Next.js / Turbo consume the `.ts` directly. So:
- Don't add a build script or `dist/` to internal packages.
- Import via the subpaths declared in each package's `exports` (e.g. `@my-better-t-app/db/schema`, `@my-better-t-app/env/server`, `@my-better-t-app/ui/components/button`).
- When you add a new source file you want to import across packages, make sure the package's `exports` map covers it (most use `"./*": "./src/*.ts"`).

## Dependencies & the pnpm catalog

Shared dependency versions are pinned **once** in the pnpm **catalog** in `pnpm-workspace.yaml`. Packages reference them as `"catalog:"` instead of hardcoding a version:

```jsonc
// in a package.json
"dependencies": { "zod": "catalog:", "better-auth": "catalog:" }
```

To add or bump a shared dep:
1. Add/update the version under `catalog:` in `pnpm-workspace.yaml`.
2. Reference it as `"catalog:"` in the relevant package.json files.
3. `pnpm install` from the root.

For a dep used by only one package and not shared, a normal pinned version in that package.json is fine (e.g. `drizzle-orm`, `pg` in `packages/db`). When in doubt, match what neighboring deps do.

Current catalog highlights: `next ^16.2.0`, `react ^19.2.6`, `zod ^4.1.13`, `@orpc/* ^1.13.14`, `better-auth 1.6.11`, `tailwindcss ^4.1.18`.

## Environment variables

Env is validated with `@t3-oss/env` (Zod v4) — **import from `@my-better-t-app/env/server`, never read `process.env` directly**.

- Server schema: `packages/env/src/server.ts` validates `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥32 chars), `BETTER_AUTH_URL`, `CORS_ORIGIN`, `NODE_ENV`.
- To add a server env var: add it to the `server: {}` block there (using Zod v4 — `z.url()`, `z.string().min(1)`, etc.), then add the actual value to `apps/web/.env`.
- `apps/web/.env` is the **single source of env** — both the app and `drizzle.config.ts` read from it.
- Client-exposed vars go in `packages/env/src/web.ts` (`@t3-oss/env-nextjs`), and must be prefixed `NEXT_PUBLIC_`.

## Scripts & Turborepo

Run from the repo root:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start everything (web on **http://localhost:3001**). |
| `pnpm dev:web` | Web app only. |
| `pnpm build` | Build all. |
| `pnpm check-types` | Typecheck all packages (**the** correctness gate — no test/lint setup). |
| `pnpm db:push` / `db:generate` / `db:migrate` / `db:studio` | Drizzle (see `references/drizzle.md`). |

Notes:
- There is **no test runner and no working lint script** (`turbo lint` exists but no package defines `lint`). `pnpm check-types` is what catches mistakes.
- Turbo task config is in `turbo.json`; `dev`/`db:*` are non-cached/persistent. Add a new package script there if it needs orchestration or caching.

## shadcn/ui

Shared primitives live in `packages/ui` (built on `@base-ui/react`, Tailwind v4, `next-themes`); style is `base-lyra`, base color `neutral`, icons `lucide`.

- **Add a shared primitive** (from repo root): `npx shadcn@latest add <component> -c packages/ui`
- **Import**: `import { Button } from "@my-better-t-app/ui/components/button";`
- **App-specific blocks** (not shared): run the shadcn CLI from `apps/web` instead.
- Design tokens / global styles: `packages/ui/src/styles/globals.css`.
- Two `components.json` exist (`apps/web` and `packages/ui`) — they set the aliases above; keep them consistent if you change conventions.

## TypeScript config

All packages extend `packages/config/tsconfig.base.json`. The settings that most affect day-to-day code:

- **`verbatimModuleSyntax: true`** — use `import type { X }` for type-only imports; mixing types into value imports is a compile error.
- **`noUncheckedIndexedAccess: true`** — indexed/array access yields `T | undefined`; narrow before use (notably `const [row] = ...returning()`).
- **`noUnusedLocals` / `noUnusedParameters`** — remove unused imports/params or the typecheck fails.
- **`strict: true`**, `moduleResolution: "bundler"`, `isolatedModules: true`, ESM (`"type": "module"`).

Match the import style and patterns of the file you're editing — the existing code already complies with all of the above.
