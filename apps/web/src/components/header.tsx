"use client";
import { cn } from "@my-better-t-app/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import ClinicLogo from "./clinic-logo";
import UserMenu from "./user-menu";

export default function Header() {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const isClinician =
    (session?.user as { role?: string } | undefined)?.role === "clinician";

  const links: { to: Route; label: string }[] = [
    { to: "/", label: "Home" },
    { to: "/booking", label: "Book" },
    { to: "/booking/manage", label: "My bookings" },
    ...(isClinician
      ? [{ to: "/clinician" as Route, label: "Clinician" }]
      : []),
  ];

  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname.startsWith(to);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" className="shrink-0" aria-label="Riverbend Health home">
          <ClinicLogo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              href={to}
              className={cn(
                "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                isActive(to)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <UserMenu />
        </div>
      </div>

      {/* Mobile nav: a compact scrollable row of the same links. */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-border/60 px-4 py-2 md:hidden">
        {links.map(({ to, label }) => (
          <Link
            key={to}
            href={to}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              isActive(to)
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
