import { auth } from "@my-better-t-app/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import ClinicianDashboard from "./clinician-dashboard";

export default async function ClinicianPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // Must be signed in. The clinician *role* is enforced inside the dashboard
  // (and on every admin procedure) — a signed-in patient lands on a prompt to
  // become a clinician rather than a hard redirect.
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 md:py-14">
      <header className="mb-8 flex flex-col gap-2">
        <span className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
          Clinician
        </span>
        <h1 className="font-display text-3xl text-foreground md:text-4xl">
          Practice settings
        </h1>
        <p className="text-muted-foreground">
          Manage your profile and availability, and review upcoming
          appointments.
        </p>
      </header>
      <ClinicianDashboard />
    </div>
  );
}
