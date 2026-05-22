"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { cn } from "@my-better-t-app/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import ProviderCrest from "@/components/provider-crest";
import { authClient } from "@/lib/auth-client";
import {
  forgetBookingToken,
  loadBookingTokens,
  rememberBookingToken,
} from "@/lib/booking-tokens";
import { getSpecialty } from "@/lib/specialties";
import { orpc, queryClient } from "@/utils/orpc";

function formatRange(
  startAt: string,
  endAt: string,
  timeZone: string | undefined,
): string {
  const day = new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(startAt));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  return `${day}, ${time(startAt)} – ${time(endAt)}`;
}

function invalidateBookingQueries() {
  queryClient.invalidateQueries({ queryKey: orpc.listMyBookings.key() });
  queryClient.invalidateQueries({ queryKey: orpc.getBooking.key() });
  queryClient.invalidateQueries({ queryKey: orpc.getAvailability.key() });
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    booked: {
      label: "Booked",
      className: "bg-primary/10 text-primary",
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-destructive/10 text-destructive",
    },
    completed: {
      label: "Completed",
      className: "bg-muted text-muted-foreground",
    },
  };
  const s = map[status] ?? { label: status, className: "bg-muted" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}

type BookingView = {
  serviceName: string;
  providerName: string;
  providerTimezone: string;
  careType: string;
  status: string;
  startAt: string;
  endAt: string;
  notes: string | null;
};

// Shared presentational card for a single booking, used by both the
// signed-in list and the token-lookup path.
function BookingCard({
  booking,
  onCancel,
  cancelling,
}: {
  booking: BookingView;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const specialty = getSpecialty(booking.careType);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          <ProviderCrest
            name={booking.providerName}
            careType={booking.careType}
            size={56}
            className="shrink-0"
          />
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-base">
              {booking.serviceName} with {booking.providerName}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {formatRange(booking.startAt, booking.endAt, booking.providerTimezone)}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <StatusPill status={booking.status} />
              <Badge
                variant="soft"
                style={{ background: specialty.tint, color: specialty.color }}
              >
                {specialty.label}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      {booking.notes ? (
        <CardContent className="text-sm">
          <span className="text-muted-foreground">Notes: </span>
          {booking.notes}
        </CardContent>
      ) : null}
      {booking.status === "booked" && onCancel ? (
        <CardFooter>
          <Button
            variant="destructive"
            size="sm"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? "Cancelling…" : "Cancel appointment"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

// One booking looked up by its confirmation token (the anonymous path).
function TokenBookingCard({ token }: { token: string }) {
  const query = useQuery(
    orpc.getBooking.queryOptions({ input: { confirmationToken: token } }),
  );
  const cancel = useMutation(orpc.cancelBooking.mutationOptions());

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="py-4 text-muted-foreground">
          Loading booking…
        </CardContent>
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <span className="break-all text-muted-foreground">
            No booking found for code {token.slice(0, 8)}…
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              forgetBookingToken(token);
              query.refetch();
            }}
          >
            Remove
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <BookingCard
      booking={query.data}
      cancelling={cancel.isPending}
      onCancel={async () => {
        await cancel.mutateAsync({ confirmationToken: token });
        invalidateBookingQueries();
      }}
    />
  );
}

function MyBookingsList() {
  const query = useQuery(orpc.listMyBookings.queryOptions());
  const cancel = useMutation(orpc.cancelBooking.mutationOptions());

  if (query.isLoading) {
    return <p className="text-muted-foreground">Loading your bookings…</p>;
  }
  const bookings = query.data ?? [];
  if (bookings.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-8 text-center">
          <p className="text-muted-foreground">You have no bookings yet.</p>
          <Button render={<Link href="/booking" />} size="sm">
            Book an appointment
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {bookings.map((b) => (
        <BookingCard
          key={b.id}
          booking={b}
          cancelling={cancel.isPending}
          onCancel={async () => {
            await cancel.mutateAsync({ confirmationToken: b.confirmationToken });
            invalidateBookingQueries();
          }}
        />
      ))}
    </div>
  );
}

// Lets a signed-out patient receive a (mocked) magic link to see all bookings
// tied to their email. The link is printed to the server console in this build.
function MagicLinkSignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: "/booking/manage",
    });
    setPending(false);
    if (error) {
      setError(error.message ?? "Could not send the link.");
      return;
    }
    setSent(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">See all my bookings</CardTitle>
        <p className="pt-1 text-sm text-muted-foreground">
          Sign in with your email to view every booking made under it.
        </p>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="magic-email">Email</Label>
          <Input
            id="magic-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          {sent ? (
            <p className="text-sm text-muted-foreground">
              Link sent. In this local build it’s printed to the server console
              — open it to sign in.
            </p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" size="sm" disabled={pending || !email}>
            {pending ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function TokenLookup() {
  // Tokens remembered in this browser, plus any the patient pastes in.
  const [tokens, setTokens] = useState<string[]>([]);
  const [entry, setEntry] = useState("");

  useEffect(() => {
    setTokens(loadBookingTokens());
  }, []);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const token = entry.trim();
    if (!token) return;
    rememberBookingToken(token);
    setTokens(loadBookingTokens());
    setEntry("");
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleAdd} className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="token-entry">Look up by confirmation code</Label>
          <Input
            id="token-entry"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            placeholder="Paste your confirmation code"
          />
        </div>
        <Button type="submit" size="default" disabled={!entry.trim()}>
          Find
        </Button>
      </form>
      {tokens.length > 0 ? (
        tokens.map((t) => <TokenBookingCard key={t} token={t} />)
      ) : (
        <p className="text-sm text-muted-foreground">
          No saved confirmation codes in this browser.
        </p>
      )}
    </div>
  );
}

export default function ManageBookings() {
  const { data: session, isPending } = authClient.useSession();

  return (
    <div className="flex flex-col gap-10">
      {isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : session?.user ? (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl text-foreground">
            Bookings for {session.user.email}
          </h2>
          <MyBookingsList />
        </section>
      ) : (
        <section>
          <MagicLinkSignIn />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl text-foreground">
            Find a booking by code
          </h2>
          <p className="text-sm text-muted-foreground">
            Booked without signing in? Use the confirmation code you received.
          </p>
        </div>
        <TokenLookup />
      </section>
    </div>
  );
}
