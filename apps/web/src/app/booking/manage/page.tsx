import Link from "next/link";

import { Button } from "@my-better-t-app/ui/components/button";

import ManageBookings from "./manage-bookings";

export default function ManageBookingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 md:py-14">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
            My bookings
          </span>
          <h1 className="font-display text-3xl text-foreground md:text-4xl">
            Your appointments
          </h1>
        </div>
        <Button render={<Link href="/booking" />} variant="outline" size="sm">
          Book new
        </Button>
      </header>
      <ManageBookings />
    </div>
  );
}
