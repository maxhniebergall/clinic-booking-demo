import { auth } from "@my-better-t-app/auth";
import type { NextRequest } from "next/server";

function clientIp(headers: Headers): string {
  // x-forwarded-for is a comma-separated list; the first entry is the client.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
}

export async function createContext(req: NextRequest) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });
  return {
    auth: null,
    session,
    // Used by the rate-limit middleware. On localhost these headers are usually
    // absent, so this falls back to "unknown" (one shared bucket) — fine for dev.
    ip: clientIp(req.headers),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
