import Link from "next/link";

import { CLINIC_NAME, ClinicLogo } from "./clinic-logo";

const columns = [
  {
    heading: "Care",
    links: [
      { label: "Book an appointment", href: "/booking" },
      { label: "Physiotherapy", href: "/booking" },
      { label: "Chiropractic", href: "/booking" },
    ],
  },
  {
    heading: "Patients",
    links: [
      { label: "My bookings", href: "/booking/manage" },
      { label: "Sign in", href: "/login" },
    ],
  },
] as const;

export default function Footer() {
  return (
    <footer className="border-t border-border/70 bg-secondary/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 md:grid-cols-[1.5fr_1fr_1fr_1.2fr]">
        <div className="flex flex-col gap-3">
          <ClinicLogo />
          <p className="max-w-xs text-sm text-muted-foreground">
            Physiotherapy and chiropractic care in a calm, welcoming space.
            Same-week appointments, online booking, direct insurance billing.
          </p>
        </div>

        {columns.map((col) => (
          <nav key={col.heading} className="flex flex-col gap-3 text-sm">
            <span className="font-medium text-foreground">{col.heading}</span>
            {col.links.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-muted-foreground transition-colors hover:text-primary"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        ))}

        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Visit us</span>
          <span>118 Riverbend Way, Suite 200</span>
          <span>Mon–Fri · 9:00am – 5:00pm</span>
          <a
            href="tel:+15551234567"
            className="transition-colors hover:text-primary"
          >
            (555) 123-4567
          </a>
        </div>
      </div>

      <div className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {CLINIC_NAME}. All rights reserved.
          </span>
          <span className="flex gap-4">
            <span className="cursor-default">Privacy Policy</span>
            <span className="cursor-default">Terms of Use</span>
            <span className="cursor-default">Accessibility</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
