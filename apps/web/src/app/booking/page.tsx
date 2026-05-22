import { auth } from "@my-better-t-app/auth";
import { headers } from "next/headers";
import Link from "next/link";

import { Button } from "@my-better-t-app/ui/components/button";

import BookingCalendar from "./booking-calendar";

export default async function BookingPage() {
  // Booking is open to anonymous patients — login is optional and only used to
  // prefill contact details and associate the booking with an account.
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 md:py-14">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
            Book an appointment
          </span>
          <h1 className="font-display text-3xl text-foreground md:text-4xl">
            {session?.user
              ? `Let’s find a time, ${session.user.name.split(" ")[0]}`
              : "Let’s find a time that works for you"}
          </h1>
        </div>
        <Button
          render={<Link href="/booking/manage" />}
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex"
        >
          My bookings
        </Button>
      </header>
      <BookingCalendar
        patientName={session?.user.name ?? ""}
        patientEmail={session?.user.email ?? ""}
      />
    </div>
  );
}
