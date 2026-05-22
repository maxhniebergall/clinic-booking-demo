// Anonymous bookings are only retrievable via their confirmationToken. We keep
// the tokens created in this browser in localStorage so the "My bookings" page
// can surface them without an account. Logged-in patients don't need this —
// their bookings are listed by userId server-side — but it's harmless to keep.

const TOKENS_STORAGE_KEY = "booking:tokens";

export function loadBookingTokens(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TOKENS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string");
  } catch {
    return [];
  }
}

export function rememberBookingToken(token: string): void {
  if (typeof window === "undefined") return;
  const existing = loadBookingTokens();
  if (existing.includes(token)) return;
  window.localStorage.setItem(
    TOKENS_STORAGE_KEY,
    JSON.stringify([token, ...existing]),
  );
}

export function forgetBookingToken(token: string): void {
  if (typeof window === "undefined") return;
  const next = loadBookingTokens().filter((t) => t !== token);
  window.localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(next));
}
