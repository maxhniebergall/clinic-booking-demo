/**
 * Detects the Postgres errors that signal a losing race on the appointment
 * no-overlap guarantee. node-postgres surfaces the SQLSTATE on `err.code`:
 *   23P01 = exclusion_violation (our GIST `appointment_no_overlap` constraint)
 *   23505 = unique_violation    (defensive: e.g. confirmation-token collision)
 *
 * Drizzle wraps query failures (e.g. `DrizzleQueryError`) and keeps the original
 * pg error on `.cause`, so we walk the cause chain rather than only checking the
 * top-level error.
 */
export function isOverlapViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (code === "23P01" || code === "23505") return true;
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}
