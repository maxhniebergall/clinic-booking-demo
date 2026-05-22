# oRPC in this repo (@orpc/* v1.x)

The API is a plain object of procedures (`appRouter`) whose **type** flows into the web client — adding a procedure is all it takes to get a type-safe client method. No codegen, no registration step.

## Contents
- [The procedure builders](#the-procedure-builders)
- [Adding an endpoint](#adding-an-endpoint)
- [Input/output validation (Zod v4)](#inputoutput-validation-zod-v4)
- [Typed errors](#typed-errors)
- [The context](#the-context)
- [Calling endpoints from the client](#calling-endpoints-from-the-client)
- [The entry handler (rarely edited)](#the-entry-handler-rarely-edited)

## The procedure builders

`packages/api/src/index.ts` defines the two builders every endpoint starts from:

```ts
import { ORPCError, os } from "@orpc/server";
import type { Context } from "./context";

export const o = os.$context<Context>();   // binds the per-request context type
export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context: { session: context.session } });  // narrows session to non-null downstream
});

export const protectedProcedure = publicProcedure.use(requireAuth);
```

- `publicProcedure` — no auth required.
- `protectedProcedure` — runs `requireAuth`; inside its handlers, `context.session.user` is guaranteed present.
- Middleware **must** `return next()`. To add/narrow context, pass `next({ context: {...} })`.

## Adding an endpoint

Endpoints are properties on `appRouter` in `packages/api/src/routers/index.ts`. Import the builders from `../index`.

```ts
import type { RouterClient } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../index";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => "OK"),

  // public, no input
  privateData: protectedProcedure.handler(({ context }) => ({
    message: "This is private",
    user: context.session?.user,
  })),

  // public, validated input — input is typed & parsed before the handler runs
  greet: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .handler(({ input }) => `Hello ${input.name}`),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
```

**Nesting** is just nested objects — `appRouter.todos.create` comes from `{ todos: { create: publicProcedure... } }`. The client mirrors the shape: `client.todos.create(...)`.

**Handler arg**: a single destructured object `{ input, context, errors }`. The field is `context` (not `ctx`). There is **no `.query()`/`.mutation()`** — only `.handler()`.

A protected mutation with a DB write (see `references/drizzle.md` for the schema side):

```ts
import { db } from "@my-better-t-app/db";
import { todo } from "@my-better-t-app/db/schema";

createTodo: protectedProcedure
  .input(z.object({ text: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const [row] = await db
      .insert(todo)
      .values({ text: input.text, userId: context.session.user.id })
      .returning();
    return row;   // note: with noUncheckedIndexedAccess, row is `Todo | undefined`
  }),
```

## Input/output validation (Zod v4)

`.input(schema)` sits between the procedure and `.handler`; the parsed, typed value arrives as `input`. `.output(schema)` validates the return value. This repo uses **Zod v4** — use top-level formats (`z.email()`, `z.url()`), and the `error` key for messages:

```ts
.input(z.object({
  email: z.email(),
  age: z.number().int().min(0, { error: "must be non-negative" }),
}))
```

The OpenAPI/Scalar reference is generated from these schemas via the `@orpc/zod/zod4` converter wired up in the entry route — no extra work needed; new validated endpoints show up in the Scalar UI automatically.

## Typed errors

Throw `ORPCError` with a string code (positional):

```ts
import { ORPCError } from "@orpc/server";
throw new ORPCError("NOT_FOUND", { message: "No such todo" });
```

A plain `throw new Error()` becomes `INTERNAL_SERVER_ERROR`. For errors the *client* should see as typed, define them with `.errors({...})` on the procedure and throw via the `errors` arg — only reach for that if the client needs to branch on error shape.

## The context

`packages/api/src/context.ts` builds the per-request context. It reads the Better Auth session from request headers (see `references/better-auth.md`):

```ts
import { auth } from "@my-better-t-app/auth";
import type { NextRequest } from "next/server";

export async function createContext(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  return { auth: null, session };
}
export type Context = Awaited<ReturnType<typeof createContext>>;
```

To make something available to every handler (e.g. the `db` instance, a request id), add it here and it becomes typed on `context` everywhere.

## Calling endpoints from the client

`apps/web/src/utils/orpc.ts` exports two things:

- `client` — a direct, typed client. Call procedures as functions: `await client.greet({ name })`, `await client.todos.create({ text })`.
- `orpc` — TanStack Query utils from `createTanstackQueryUtils(client)`.

In components:

```ts
import { useQuery, useMutation } from "@tanstack/react-query";
import { orpc, queryClient } from "@/utils/orpc";

// query
const { data } = useQuery(orpc.greet.queryOptions({ input: { name: "Max" } }));

// mutation + invalidation
const m = useMutation(orpc.createTodo.mutationOptions({
  onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.privateData.key() }),
}));
m.mutate({ text: "ship it" });
```

The link is isomorphic (`apps/web/src/utils/orpc.ts`): in the browser it calls `/api/rpc` with `credentials: "include"`; server-side it forwards `next/headers`. You don't need to touch it to add endpoints.

## The entry handler (rarely edited)

`apps/web/src/app/api/rpc/[[...rest]]/route.ts` runs the `RPCHandler` first (prefix `/api/rpc`), then falls back to the `OpenAPIHandler` (Scalar UI at `/api/rpc/api-reference`). `handle()` returns `{ matched, response }`; the route checks `result.response` and falls through to a 404 if nothing matched. You normally only edit this file to add interceptors or plugins, not to add endpoints.
