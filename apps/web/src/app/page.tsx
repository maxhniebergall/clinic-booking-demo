"use client";
import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { Skeleton } from "@my-better-t-app/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Clock, MapPin, ShieldCheck } from "lucide-react";
import Link from "next/link";

import ProviderCrest from "@/components/provider-crest";
import { ALL_SPECIALTIES, type Specialty } from "@/lib/specialties";
import { orpc } from "@/utils/orpc";

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Soft layered background — gradient mesh, not a flat block. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 70% at 12% 0%, var(--specialty-pt-tint) 0%, transparent 60%), radial-gradient(50% 60% at 95% 20%, var(--specialty-chiro-tint) 0%, transparent 55%), linear-gradient(180deg, var(--background) 40%, var(--secondary) 100%)",
        }}
      />
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-[1.1fr_0.9fr] md:items-center md:py-28">
        <div className="flex flex-col gap-6">
          <Badge variant="soft" className="w-fit">
            <ShieldCheck /> Accepting new patients
          </Badge>
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Care that meets you{" "}
            <span className="text-primary italic">where you are.</span>
          </h1>
          <p className="max-w-md text-lg text-muted-foreground">
            Physiotherapy and chiropractic care in a calm, unhurried space.
            Book online in under a minute and see a practitioner who listens.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button render={<Link href="/booking" />} size="lg">
              <CalendarCheck /> Book an appointment
            </Button>
            <Button
              render={<Link href="/booking/manage" />}
              variant="outline"
              size="lg"
            >
              Manage a booking
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="size-4 text-primary" /> Same-week appointments
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4 text-primary" /> Riverbend, downtown
            </span>
          </div>
        </div>

        {/* Crest cluster as the hero visual. */}
        <div className="relative hidden min-h-[22rem] md:block">
          <div className="absolute top-4 left-6 rotate-[-6deg]">
            <ProviderCrest name="Dr. Alice Nguyen" careType="physical_therapy" size={170} />
          </div>
          <div className="absolute right-4 bottom-2 rotate-[5deg]">
            <ProviderCrest name="Dr. Bertrand Okafor" careType="chiropractic" size={150} />
          </div>
          <div className="absolute top-28 right-28">
            <ProviderCrest name="Dr. Carmen Silva" careType="physical_therapy" size={110} />
          </div>
        </div>
      </div>
    </section>
  );
}

function SpecialtiesSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-10 flex flex-col gap-2">
        <span className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
          What we treat
        </span>
        <h2 className="font-display text-3xl text-foreground">
          Two specialties, one calm clinic
        </h2>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {ALL_SPECIALTIES.map((s) => (
          <article
            key={s.careType}
            className="group flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-7 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            style={{ borderTopColor: s.color, borderTopWidth: 3 }}
          >
            <span
              className="flex size-12 items-center justify-center rounded-xl"
              style={{ background: s.tint, color: s.color }}
            >
              <s.Icon className="size-6" />
            </span>
            <div>
              <h3 className="font-display text-xl text-foreground">{s.label}</h3>
              <p className="text-sm text-muted-foreground/80">{s.credential}</p>
            </div>
            <p className="text-muted-foreground">{s.blurb}</p>
            <Link
              href="/booking"
              className="mt-auto text-sm font-medium text-primary hover:underline"
              style={{ color: s.color }}
            >
              Book {s.label.toLowerCase()} →
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function PractitionerCards({ specialty }: { specialty: Specialty }) {
  const providers = useQuery(
    orpc.listProviders.queryOptions({
      input: { careType: specialty.careType },
    }),
  );

  if (providers.isLoading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    );
  }

  const list = providers.data ?? [];
  if (list.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No {specialty.label.toLowerCase()} practitioners listed yet.
      </p>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((p) => (
        <article
          key={p.id}
          className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <ProviderCrest
            name={p.name}
            careType={specialty.careType}
            size={72}
            className="shrink-0"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="font-display text-lg leading-tight text-foreground">
              {p.name}
            </h3>
            <Badge
              variant="soft"
              className="w-fit"
              style={{ background: specialty.tint, color: specialty.color }}
            >
              {specialty.label}
            </Badge>
            <Link
              href={{ pathname: "/booking", query: { provider: p.id } }}
              className="mt-1 text-sm font-medium text-primary hover:underline"
            >
              Book with {p.name.split(" ").slice(-1)[0]} →
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

function PractitionersSection() {
  return (
    <section className="bg-secondary/40">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-10 flex flex-col gap-2">
          <span className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
            Our practitioners
          </span>
          <h2 className="font-display text-3xl text-foreground">
            Meet the people you’ll see
          </h2>
        </div>
        <div className="flex flex-col gap-12">
          {ALL_SPECIALTIES.map((s) => (
            <div key={s.careType} className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <s.Icon className="size-5" style={{ color: s.color }} />
                <h3 className="font-display text-xl text-foreground">
                  {s.label}
                </h3>
              </div>
              <PractitionerCards specialty={s} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustBand() {
  const items = [
    {
      Icon: CalendarCheck,
      title: "Online booking",
      body: "Pick a real open slot and confirm in seconds — no phone tag.",
    },
    {
      Icon: ShieldCheck,
      title: "Direct billing",
      body: "We bill most major insurers directly so you pay less up front.",
    },
    {
      Icon: Clock,
      title: "On-time care",
      body: "Generous appointment lengths mean we’re rarely running behind.",
    },
  ];
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="grid gap-8 sm:grid-cols-3">
        {items.map(({ Icon, title, body }) => (
          <div key={title} className="flex flex-col gap-2">
            <Icon className="size-6 text-primary" />
            <h3 className="font-display text-lg text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col">
      <Hero />
      <SpecialtiesSection />
      <PractitionersSection />
      <TrustBand />
    </div>
  );
}
