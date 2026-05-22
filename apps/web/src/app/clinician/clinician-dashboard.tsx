"use client";

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
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import ProviderCrest from "@/components/provider-crest";
import { authClient } from "@/lib/auth-client";
import { orpc, queryClient } from "@/utils/orpc";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const DURATION_PRESETS = [15, 30, 45, 60, 90] as const;

function invalidateMyProvider() {
  queryClient.invalidateQueries({ queryKey: orpc.admin.myProvider.key() });
}

// Shown to a signed-in user who isn't a clinician yet. Dev-only promotion.
function BecomeClinicianPanel() {
  const become = useMutation(orpc.dev.becomeClinician.mutationOptions());
  return (
    <Card>
      <CardHeader>
        <CardTitle>You’re not set up as a clinician</CardTitle>
        <p className="text-muted-foreground pt-1 text-sm">
          In this local build you can promote your account to a clinician and
          get linked to a provider to manage.
        </p>
      </CardHeader>
      <CardFooter>
        <Button
          disabled={become.isPending}
          onClick={async () => {
            await become.mutateAsync({});
            // Role lives on the session — refresh it, then load the provider.
            await authClient.getSession({ query: { disableCookieCache: true } });
            invalidateMyProvider();
            // Ensure useSession consumers re-read the new role.
            window.location.reload();
          }}
        >
          {become.isPending ? "Setting up…" : "Become a clinician (dev)"}
        </Button>
      </CardFooter>
    </Card>
  );
}

type RuleRow = { dayOfWeek: number; startTime: string; endTime: string };

function AvailabilityRulesEditor({
  providerId,
  initialRules,
}: {
  providerId: string;
  initialRules: RuleRow[];
}) {
  const [rules, setRules] = useState<RuleRow[]>(
    [...initialRules].sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    ),
  );
  const save = useMutation(orpc.admin.setAvailabilityRules.mutationOptions());

  function update(i: number, patch: Partial<RuleRow>) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setRules((rs) => rs.filter((_, idx) => idx !== i));
  }
  function add() {
    setRules((rs) => [...rs, { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }]);
  }

  const invalid = rules.some((r) => r.startTime >= r.endTime);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Weekly availability</CardTitle>
        <p className="text-muted-foreground pt-1 text-sm">
          Recurring windows in {`the provider's timezone`}. Add a row per day
          and time range.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">No windows yet.</p>
        ) : (
          rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                className="h-11 rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                value={r.dayOfWeek}
                onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })}
              >
                {DAYS.map((d, idx) => (
                  <option key={idx} value={idx}>
                    {d}
                  </option>
                ))}
              </select>
              <Input
                type="time"
                className="w-32"
                value={r.startTime}
                onChange={(e) => update(i, { startTime: e.target.value })}
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="time"
                className="w-32"
                value={r.endTime}
                onChange={(e) => update(i, { endTime: e.target.value })}
              />
              <Button size="xs" variant="ghost" onClick={() => remove(i)}>
                Remove
              </Button>
            </div>
          ))
        )}
        <div>
          <Button size="sm" variant="outline" onClick={add}>
            Add window
          </Button>
        </div>
        {invalid ? (
          <p className="text-destructive text-sm">
            Each window’s start must be before its end.
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button
          size="sm"
          disabled={save.isPending || invalid}
          onClick={async () => {
            await save.mutateAsync({ providerId, rules });
            invalidateMyProvider();
          }}
        >
          {save.isPending ? "Saving…" : "Save schedule"}
        </Button>
      </CardFooter>
    </Card>
  );
}

type ExceptionRow = {
  id: string;
  date: string;
  blockAllDay: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
};

function ExceptionsEditor({
  providerId,
  exceptions,
}: {
  providerId: string;
  exceptions: ExceptionRow[];
}) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const create = useMutation(orpc.admin.createAvailabilityException.mutationOptions());
  const remove = useMutation(orpc.admin.deleteAvailabilityException.mutationOptions());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Time off / blackouts</CardTitle>
        <p className="text-muted-foreground pt-1 text-sm">
          Block whole days that subtract from your weekly availability.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {exceptions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No blackouts.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {[...exceptions]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {e.date}
                    {e.reason ? (
                      <span className="text-muted-foreground"> — {e.reason}</span>
                    ) : null}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={async () => {
                      await remove.mutateAsync({ id: e.id });
                      invalidateMyProvider();
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exc-date">Date</Label>
            <Input
              id="exc-date"
              type="date"
              className="w-44"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="exc-reason">Reason (optional)</Label>
            <Input
              id="exc-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Vacation"
            />
          </div>
          <Button
            size="sm"
            disabled={!date || create.isPending}
            onClick={async () => {
              await create.mutateAsync({
                providerId,
                date,
                blockAllDay: true,
                reason: reason.trim() === "" ? undefined : reason,
              });
              setDate("");
              setReason("");
              invalidateMyProvider();
            }}
          >
            {create.isPending ? "Adding…" : "Add blackout"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type ServiceOptionRow = { serviceId: string; durationMinutes: number };

function ServiceDurationsEditor({
  providerId,
  serviceOptions,
}: {
  providerId: string;
  serviceOptions: ServiceOptionRow[];
}) {
  const services = useQuery(orpc.listServices.queryOptions({ input: {} }));
  const save = useMutation(orpc.admin.setProviderServiceOptions.mutationOptions());

  // Selected durations per service, seeded from current options.
  const [selected, setSelected] = useState<Record<string, Set<number>>>(() => {
    const map: Record<string, Set<number>> = {};
    for (const o of serviceOptions) {
      (map[o.serviceId] ??= new Set()).add(o.durationMinutes);
    }
    return map;
  });

  function toggle(serviceId: string, minutes: number) {
    setSelected((prev) => {
      const next = new Set(prev[serviceId] ?? []);
      if (next.has(minutes)) next.delete(minutes);
      else next.add(minutes);
      return { ...prev, [serviceId]: next };
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Services &amp; durations</CardTitle>
        <p className="text-muted-foreground pt-1 text-sm">
          Pick the appointment lengths you offer for each service.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {services.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading services…</p>
        ) : (
          services.data?.map((s) => {
            const chosen = selected[s.id] ?? new Set<number>();
            return (
              <div key={s.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Button
                    size="xs"
                    disabled={save.isPending || chosen.size === 0}
                    onClick={async () => {
                      await save.mutateAsync({
                        providerId,
                        serviceId: s.id,
                        durationMinutes: [...chosen],
                      });
                      invalidateMyProvider();
                    }}
                  >
                    Save
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_PRESETS.map((d) => (
                    <Button
                      key={d}
                      size="xs"
                      variant={chosen.has(d) ? "default" : "outline"}
                      onClick={() => toggle(s.id, d)}
                    >
                      {d} min
                    </Button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function todayLocalIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function UpcomingAppointments({
  providerId,
  timezone,
}: {
  providerId: string;
  timezone: string;
}) {
  const from = todayLocalIso();
  const to = addDaysIso(from, 14);
  const query = useQuery(
    orpc.admin.listAppointments.queryOptions({
      input: { providerId, from, to },
    }),
  );

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  const booked = (query.data ?? []).filter((a) => a.status === "booked");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Next 14 days</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading appointments…</p>
        ) : booked.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No upcoming appointments.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {booked.map((a) => (
              <li key={a.id} className="flex flex-col">
                <span className="font-medium">{fmt(a.startAt)}</span>
                <span className="text-muted-foreground">
                  {a.patientName} · {a.patientEmail} · {a.durationMinutes} min
                </span>
                {a.notes ? (
                  <span className="text-muted-foreground">Note: {a.notes}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderProfileEditor({
  provider,
}: {
  provider: {
    id: string;
    name: string;
    timezone: string;
    slotIncrementMinutes: number;
    active: boolean;
  };
}) {
  const [name, setName] = useState(provider.name);
  const [timezone, setTimezone] = useState(provider.timezone);
  const [slot, setSlot] = useState(String(provider.slotIncrementMinutes));
  const [active, setActive] = useState(provider.active);
  const save = useMutation(orpc.admin.updateProvider.mutationOptions());

  const slotNum = Number(slot);
  const invalid =
    name.trim() === "" ||
    timezone.trim() === "" ||
    !Number.isFinite(slotNum) ||
    slotNum < 5 ||
    slotNum > 240;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
        <p className="pt-1 text-sm text-muted-foreground">
          Your public name, timezone, and the slot grid availability snaps to.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prov-name">Display name</Label>
            <Input
              id="prov-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prov-tz">Timezone (IANA)</Label>
            <Input
              id="prov-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/Toronto"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prov-slot">Slot grid (minutes)</Label>
            <Input
              id="prov-slot"
              type="number"
              min={5}
              max={240}
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2.5 self-end pb-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Accepting new bookings
          </label>
        </div>
        {invalid ? (
          <p className="text-sm text-destructive">
            Name and timezone are required; slot grid must be 5–240 minutes.
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button
          size="sm"
          disabled={save.isPending || invalid}
          onClick={async () => {
            await save.mutateAsync({
              id: provider.id,
              name: name.trim(),
              timezone: timezone.trim(),
              slotIncrementMinutes: slotNum,
              active,
            });
            invalidateMyProvider();
          }}
        >
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ProviderManager() {
  const myProvider = useQuery(orpc.admin.myProvider.queryOptions());

  if (myProvider.isLoading) {
    return <p className="text-muted-foreground">Loading your provider…</p>;
  }
  const provider = myProvider.data;
  if (!provider) {
    return (
      <p className="text-muted-foreground">
        Your account isn’t linked to a provider yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <ProviderCrest name={provider.name} careType={null} size={64} />
        <div>
          <h2 className="font-display text-2xl text-foreground">
            {provider.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {provider.timezone} · {provider.slotIncrementMinutes}-minute slot
            grid
          </p>
        </div>
      </div>
      <ProviderProfileEditor
        provider={{
          id: provider.id,
          name: provider.name,
          timezone: provider.timezone,
          slotIncrementMinutes: provider.slotIncrementMinutes,
          active: provider.active,
        }}
      />
      <AvailabilityRulesEditor
        providerId={provider.id}
        initialRules={provider.availabilityRules.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime,
        }))}
      />
      <ExceptionsEditor
        providerId={provider.id}
        exceptions={provider.availabilityExceptions}
      />
      <ServiceDurationsEditor
        providerId={provider.id}
        serviceOptions={provider.serviceOptions.map((o) => ({
          serviceId: o.serviceId,
          durationMinutes: o.durationMinutes,
        }))}
      />
      <UpcomingAppointments
        providerId={provider.id}
        timezone={provider.timezone}
      />
    </div>
  );
}

export default function ClinicianDashboard() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "clinician") {
    return <BecomeClinicianPanel />;
  }
  return <ProviderManager />;
}
