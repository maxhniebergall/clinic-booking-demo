# Drizzle in this repo (drizzle-orm 0.45.x, drizzle-kit 0.31.x, node-postgres)

Postgres via `node-postgres` (`pg`). The `db` instance and `createDb()` live in `packages/db/src/index.ts`; schema lives in `packages/db/src/schema/` and is re-exported from `schema/index.ts`.

## Contents
- [Where schema lives & the db instance](#where-schema-lives--the-db-instance)
- [Defining a table](#defining-a-table)
- [Relations](#relations)
- [Wiring a new table in](#wiring-a-new-table-in)
- [Querying](#querying)
- [Schema changes: push vs generate/migrate](#schema-changes-push-vs-generatemigrate)

## Where schema lives & the db instance

```ts
// packages/db/src/index.ts
import { env } from "@my-better-t-app/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema });
}
export const db = createDb();   // import { db } from "@my-better-t-app/db"
```

The `{ schema }` option is what powers the relational query API (`db.query.*`). `DATABASE_URL` is validated by `@my-better-t-app/env/server` — never read `process.env` directly.

`schema/index.ts` re-exports every table file:

```ts
export * from "./auth";
// add: export * from "./todo";
```

Import tables in app code via the package subpath: `import { todo } from "@my-better-t-app/db/schema"`.

## Defining a table

Columns and helpers come from `drizzle-orm/pg-core`. Follow the existing style in `schema/auth.ts`. The Better Auth tables use `text("id")` PKs; for your own tables you can use those or identity columns.

```ts
// packages/db/src/schema/todo.ts
import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const todo = pgTable(
  "todo",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    completed: boolean("completed").default(false).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("todo_userId_idx").on(table.userId)],  // ← ARRAY form, not object
);
```

Key points:
- **Indexes use the array form**: the second arg returns `[index(...).on(...)]`. The old object-return form is deprecated.
- Modifiers: `.notNull()`, `.default(v)`, `.defaultNow()`, `.$onUpdate(() => ...)`, `.primaryKey()`, `.unique()`, `.references(() => other.id, { onDelete: "cascade" })`.
- `text("id").primaryKey()` matches the Better Auth tables. If you prefer auto IDs, `integer("id").primaryKey().generatedAlwaysAsIdentity()` is the modern Postgres choice (`serial` also works but is older style).

## Relations

`relations` imports from `drizzle-orm` (not `pg-core`). Define both sides, like `schema/auth.ts`:

```ts
export const todoRelations = relations(todo, ({ one }) => ({
  user: one(user, { fields: [todo.userId], references: [user.id] }),
}));

// and on the user side (extend in auth.ts or a new relations file):
// todos: many(todo)
```

## Wiring a new table in

1. Create `packages/db/src/schema/<name>.ts`.
2. Add `export * from "./<name>";` to `packages/db/src/schema/index.ts`.
3. Run `pnpm db:push` from the repo root to apply it to Postgres.

That's it — `db.query.<name>` and the table object are now typed everywhere.

## Querying

Operators (`eq`, `and`, `or`, …) import from `drizzle-orm`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@my-better-t-app/db";
import { todo } from "@my-better-t-app/db/schema";

// select
const rows = await db.select().from(todo).where(eq(todo.userId, userId));

// insert + returning  (remember noUncheckedIndexedAccess → row is `Todo | undefined`)
const [row] = await db.insert(todo).values({ id, text, userId }).returning();

// update
await db.update(todo).set({ completed: true }).where(eq(todo.id, id));

// delete
await db.delete(todo).where(and(eq(todo.id, id), eq(todo.userId, userId)));

// relational query API (needs { schema } at init — it's set)
const withUser = await db.query.todo.findMany({ with: { user: true } });
```

`.returning()` is Postgres-specific (works on insert/update/delete here). Postgres 18's `RETURNING OLD/NEW` is **not** exposed by Drizzle yet — don't try to author it via the query builder.

## Schema changes: push vs generate/migrate

`packages/db/drizzle.config.ts` reads `DATABASE_URL` from `apps/web/.env` (the single source of DB config) and points `schema` at `./src/schema`, `out` at `./src/migrations`.

| Command | What it does | When |
| --- | --- | --- |
| `pnpm db:push` | Diffs schema against the live DB and applies DDL immediately. No files. | Dev / rapid iteration (this repo's default). |
| `pnpm db:generate` | Writes timestamped SQL migration files into `src/migrations`. | When you want versioned migrations. |
| `pnpm db:migrate` | Applies generated migration files in order. | Production-style apply. |
| `pnpm db:studio` | Opens Drizzle Studio to browse tables. | Inspecting data. |

For everyday schema edits in this repo, `pnpm db:push` is the workflow.
