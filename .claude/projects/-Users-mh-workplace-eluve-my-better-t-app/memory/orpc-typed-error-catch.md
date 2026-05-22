---
name: orpc-typed-error-catch
description: Reading oRPC typed errors in a try/catch — isDefinedError collapses to never; use instanceof ORPCError
metadata:
  type: reference
---

In oRPC client 1.x, `isDefinedError(err)` is typed `isDefinedError<T>(error: T): error is Extract<T, ORPCError<any,any>>`. In a `try/catch`, `err` is `unknown`, so `Extract<unknown, …>` collapses to `never` and `err.code` / `err.data` fail to typecheck.

To read a typed error thrown by a TanStack `mutateAsync` call, check `err instanceof ORPCError` (imported from `@orpc/client`) and cast `err.data` to the known shape. To get full type inference instead, wrap the *direct* client call: `safe(client.createBooking({…}))` — `safe` preserves the `TError` union from the call (but loses the TanStack mutation's `isPending` state).

Defined on the procedure with `.errors({ CODE: { message, data: zodSchema } })`, thrown via the handler's `errors` arg: `errors.CODE({ data })`. See `createBooking` in `packages/api/src/routers/booking.ts` (SLOT_TAKEN). Related: [[drizzle-error-cause-chain]].
