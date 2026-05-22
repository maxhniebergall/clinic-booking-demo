"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { Calendar } from "@my-better-t-app/ui/components/calendar";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@my-better-t-app/ui/components/dialog";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { cn } from "@my-better-t-app/ui/lib/utils";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, startOfDay } from "date-fns";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import ProviderCrest from "@/components/provider-crest";
import { rememberBookingToken } from "@/lib/booking-tokens";
import {
  ALL_SPECIALTIES,
  type CareType,
  getSpecialty,
} from "@/lib/specialties";
import { orpc, queryClient } from "@/utils/orpc";

function formatSlotTime(startAt: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startAt));
}

// "Wed, May 27" in the provider's timezone — used to flag a different-day slot.
function formatSlotDate(startAt: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(startAt));
}

// Provider-local calendar date ("YYYY-MM-DD") for an instant, to compare days.
function localDay(startAt: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(startAt));
}

function isCareType(value: unknown): value is CareType {
  return (
    value === "physical_therapy" || value === "chiropractic"
  );
}

// Persisted selection so returning patients resume their last specialty /
// clinician without re-clicking. Date and slot are intentionally not persisted.
const SELECTION_STORAGE_KEY = "booking:selection";

type Step = "browse" | "clinician" | "time" | "details" | "confirmation";

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: "browse", label: "Specialty" },
  { key: "clinician", label: "Clinician" },
  { key: "time", label: "Time" },
  { key: "details", label: "Details" },
];

function StepIndicator({
  step,
  accent,
  canNavigate,
  onNavigate,
}: {
  step: Step;
  accent: string;
  canNavigate: (target: Step) => boolean;
  onNavigate: (target: Step) => void;
}) {
  const activeIndex =
    step === "confirmation"
      ? STEP_LABELS.length
      : STEP_LABELS.findIndex((s) => s.key === step);

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {STEP_LABELS.map((s, i) => {
        const done = i < activeIndex;
        const current = i === activeIndex;
        const enabled = canNavigate(s.key) && !current;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!enabled}
              onClick={() => onNavigate(s.key)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full transition-opacity",
                enabled
                  ? "cursor-pointer hover:opacity-80"
                  : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  done || current
                    ? "text-white"
                    : "bg-muted text-muted-foreground",
                )}
                style={done || current ? { background: accent } : undefined}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  current
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </button>
            {i < STEP_LABELS.length - 1 ? (
              <span className="mx-1 h-px w-5 bg-border" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function BookingCalendar({
  patientName,
  patientEmail,
}: {
  patientName: string;
  patientEmail: string;
}) {
  const today = startOfDay(new Date());

  const [step, setStep] = useState<Step>("browse");
  const [careType, setCareType] = useState<CareType | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [selectedStartAt, setSelectedStartAt] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");

  // Restore persisted selection / honor a deep link on mount (in an effect so
  // SSR and first client render match). Deep link (?provider=&careType=) wins.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const linkProvider = params.get("provider");
    const linkCareType = params.get("careType");
    if (linkProvider && isCareType(linkCareType)) {
      setCareType(linkCareType);
      setProviderId(linkProvider);
      setStep("time");
      setHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          careType?: unknown;
          providerId?: unknown;
          serviceId?: unknown;
          durationMinutes?: unknown;
        };
        if (isCareType(parsed.careType)) setCareType(parsed.careType);
        if (typeof parsed.providerId === "string")
          setProviderId(parsed.providerId);
        if (typeof parsed.serviceId === "string") setServiceId(parsed.serviceId);
        if (typeof parsed.durationMinutes === "number")
          setDurationMinutes(parsed.durationMinutes);
        if (isCareType(parsed.careType) && typeof parsed.providerId === "string")
          setStep("time");
      }
    } catch {
      /* ignore malformed storage */
    }
    setHydrated(true);
  }, []);

  // Debounce the clinician search input.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 250);
    return () => clearTimeout(id);
  }, [searchTerm]);

  // Patient form (name/email prefilled from session, editable).
  const [name, setName] = useState(patientName);
  const [email, setEmail] = useState(patientEmail);
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [bookingResult, setBookingResult] = useState<{
    id: string;
    confirmationToken: string;
    status: string;
    startAt: string;
    endAt: string;
  } | null>(null);

  // Set when a booking loses a race; drives the conflict dialog. `nextSlot` is
  // the alternative the server proposes (null if nothing is open in range).
  const [conflict, setConflict] = useState<{
    attemptedStartAt: string;
    nextSlot: { startAt: string; endAt: string } | null;
  } | null>(null);

  // --- Queries ---
  const searchQuery = useQuery(
    orpc.searchProviders.queryOptions({
      input: { query: debouncedTerm },
      enabled: step === "browse" && debouncedTerm.length >= 2,
    }),
  );

  const providersQuery = useQuery(
    orpc.listProviders.queryOptions({
      input: { careType: careType ?? undefined },
      enabled: careType !== null,
    }),
  );

  const servicesQuery = useQuery(
    orpc.listServices.queryOptions({
      input: { careType: careType ?? undefined },
      enabled: careType !== null,
    }),
  );

  const durationsQuery = useQuery(
    orpc.listDurations.queryOptions({
      input: { providerId: providerId ?? "", serviceId: serviceId ?? "" },
      enabled: providerId !== null && serviceId !== null,
    }),
  );

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const availabilityEnabled =
    providerId !== null && serviceId !== null && durationMinutes !== null;

  const availabilityQuery = useQuery(
    orpc.getAvailability.queryOptions({
      input: {
        providerId: providerId ?? "",
        serviceId: serviceId ?? "",
        durationMinutes: durationMinutes ?? 0,
        from: dateStr,
        to: dateStr,
      },
      enabled: availabilityEnabled,
    }),
  );

  const createBooking = useMutation(orpc.createBooking.mutationOptions());

  const specialty = getSpecialty(careType);
  const accent = specialty.color;
  const selectedService = servicesQuery.data?.find((s) => s.id === serviceId);
  const selectedProvider = providersQuery.data?.find((p) => p.id === providerId);
  const providerTimezone = selectedProvider?.timezone;

  // Persist selection after hydration.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({ careType, providerId, serviceId, durationMinutes }),
    );
  }, [hydrated, careType, providerId, serviceId, durationMinutes]);

  // Auto-pick the only/first service for the chosen specialty.
  if (
    servicesQuery.data &&
    servicesQuery.data.length > 0 &&
    (serviceId === null || !servicesQuery.data.some((s) => s.id === serviceId))
  ) {
    setServiceId(servicesQuery.data[0]!.id);
    setDurationMinutes(null);
  }

  // Default duration to the first available once durations load.
  if (
    durationsQuery.data &&
    durationsQuery.data.length > 0 &&
    (durationMinutes === null || !durationsQuery.data.includes(durationMinutes))
  ) {
    setDurationMinutes(durationsQuery.data[0]!);
  }

  // --- Navigation handlers ---
  function resetBelowSpecialty() {
    setProviderId(null);
    setServiceId(null);
    setDurationMinutes(null);
    setSelectedStartAt(null);
  }

  function selectSpecialty(ct: CareType) {
    setCareType(ct);
    resetBelowSpecialty();
    setStep("clinician");
  }

  function selectProvider(id: string) {
    setProviderId(id);
    setServiceId(null);
    setDurationMinutes(null);
    setSelectedStartAt(null);
    setSelectedDate(today);
    setStep("time");
  }

  function selectProviderFromSearch(r: {
    id: string;
    careTypes: string[];
  }) {
    const ct = r.careTypes.find(isCareType) ?? null;
    setCareType(ct);
    setProviderId(r.id);
    setServiceId(null);
    setDurationMinutes(null);
    setSelectedStartAt(null);
    setSelectedDate(today);
    setStep("time");
  }

  function handleSelectDate(date: Date | undefined) {
    if (!date) return;
    setSelectedDate(startOfDay(date));
    setSelectedStartAt(null);
  }

  // Books `startAt` with the current form data. Pass startAt explicitly so the
  // "book the proposed slot" path doesn't depend on an async setState landing.
  async function submitBooking(startAt: string) {
    if (!providerId || !serviceId || !durationMinutes) return;
    try {
      const result = await createBooking.mutateAsync({
        providerId,
        serviceId,
        durationMinutes,
        startAt,
        patientName: name,
        patientEmail: email,
        patientPhone: phone,
        notes: notes.trim() === "" ? undefined : notes,
      });
      setConflict(null);
      setBookingResult(result);
      setStep("confirmation");
      rememberBookingToken(result.confirmationToken);
      queryClient.invalidateQueries({ queryKey: orpc.getAvailability.key() });
    } catch (err) {
      // Lost the race: surface the conflict dialog with the proposed alternative.
      // Form state is left intact so the patient never re-types their details.
      if (err instanceof ORPCError && err.code === "SLOT_TAKEN") {
        const { nextSlot } = err.data as {
          nextSlot: { startAt: string; endAt: string } | null;
        };
        setConflict({ attemptedStartAt: startAt, nextSlot });
      }
      availabilityQuery.refetch();
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (selectedStartAt) submitBooking(selectedStartAt);
  }

  // Patient accepted the proposed slot — book it immediately, keeping their data.
  function acceptProposedSlot(nextStartAt: string) {
    setSelectedStartAt(nextStartAt);
    setSelectedDate(startOfDay(new Date(nextStartAt)));
    submitBooking(nextStartAt);
  }

  function dismissConflictToTimes() {
    setConflict(null);
    setSelectedStartAt(null);
    setStep("time");
  }

  function handleBookAnother() {
    setBookingResult(null);
    setSelectedStartAt(null);
    setPhone("");
    setNotes("");
    setStep("browse");
  }

  // A step is reachable once its prerequisites are chosen, letting the patient
  // jump back (or forward) via the step indicator.
  function canNavigate(target: Step): boolean {
    switch (target) {
      case "browse":
        return true;
      case "clinician":
        return careType !== null;
      case "time":
        return careType !== null && providerId !== null;
      case "details":
        return selectedStartAt !== null;
      default:
        return false;
    }
  }

  const slots = availabilityQuery.data?.slots ?? [];
  const showStepIndicator = step !== "confirmation";

  return (
    <div className="flex flex-col gap-8">
      {showStepIndicator ? (
        <StepIndicator
          step={step}
          accent={accent}
          canNavigate={canNavigate}
          onNavigate={setStep}
        />
      ) : null}

      {/* ---------- Step 1: Browse (specialty or clinician search) ---------- */}
      {step === "browse" ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl text-foreground">
              What brings you in?
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {ALL_SPECIALTIES.map((s) => (
                <button
                  key={s.careType}
                  type="button"
                  onClick={() => selectSpecialty(s.careType)}
                  className="group flex cursor-pointer items-start gap-4 rounded-2xl border border-border/70 bg-card p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  style={{ borderTopColor: s.color, borderTopWidth: 3 }}
                >
                  <span
                    className="flex size-12 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: s.tint, color: s.color }}
                  >
                    <s.Icon className="size-6" />
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="font-display text-xl text-foreground">
                      {s.label}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {s.blurb}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-sm text-muted-foreground">
                or find your clinician
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="relative">
              <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name, e.g. “Nguyen”"
                className="pl-10"
                aria-label="Search clinicians by name"
              />
            </div>
            {debouncedTerm.length >= 2 ? (
              <div className="flex flex-col gap-2">
                {searchQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Searching…</p>
                ) : (searchQuery.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No clinicians match “{debouncedTerm}”.
                  </p>
                ) : (
                  searchQuery.data?.map((r) => {
                    const sp = getSpecialty(r.careTypes[0]);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => selectProviderFromSearch(r)}
                        className="flex cursor-pointer items-center gap-4 rounded-xl border border-border/70 bg-card p-3 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                      >
                        <ProviderCrest
                          name={r.name}
                          careType={r.careTypes[0]}
                          size={48}
                        />
                        <span className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {r.name}
                          </span>
                          <span className="flex flex-wrap gap-1.5 pt-0.5">
                            {r.careTypes.map((ct) => {
                              const cs = getSpecialty(ct);
                              return (
                                <Badge
                                  key={ct}
                                  variant="soft"
                                  style={{ background: cs.tint, color: cs.color }}
                                >
                                  {cs.label}
                                </Badge>
                              );
                            })}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ---------- Step 2: Choose clinician ---------- */}
      {step === "clinician" ? (
        <div className="flex flex-col gap-5">
          <button
            type="button"
            onClick={() => setStep("browse")}
            className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to specialties
          </button>
          <div className="flex items-center gap-2">
            <specialty.Icon className="size-5" style={{ color: accent }} />
            <h2 className="font-display text-2xl text-foreground">
              Choose your {specialty.label.toLowerCase()} clinician
            </h2>
          </div>
          {providersQuery.isLoading ? (
            <p className="text-muted-foreground">Loading clinicians…</p>
          ) : (providersQuery.data?.length ?? 0) === 0 ? (
            <p className="text-muted-foreground">
              No clinicians available for this specialty right now.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {providersQuery.data?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p.id)}
                  className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-border/70 bg-card p-6 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <ProviderCrest
                    name={p.name}
                    careType={careType}
                    size={96}
                  />
                  <span className="font-display text-lg text-foreground">
                    {p.name}
                  </span>
                  <Badge
                    variant="soft"
                    style={{ background: specialty.tint, color: accent }}
                  >
                    {specialty.credential}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ---------- Step 3: Pick a time ---------- */}
      {step === "time" ? (
        <div className="flex flex-col gap-5">
          <button
            type="button"
            onClick={() =>
              setStep(careType ? "clinician" : "browse")
            }
            className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Change clinician
          </button>

          {/* Provider summary header */}
          <div
            className="flex items-center gap-4 rounded-2xl border border-border/70 p-5"
            style={{ background: specialty.tint }}
          >
            <ProviderCrest
              name={selectedProvider?.name ?? "Riverbend Health"}
              careType={careType}
              size={64}
            />
            <div className="flex flex-col">
              <span className="font-display text-xl text-foreground">
                {selectedProvider?.name ?? "Loading…"}
              </span>
              <span className="text-sm" style={{ color: accent }}>
                {specialty.label}
              </span>
            </div>
          </div>

          {/* Service + duration selectors */}
          <div className="flex flex-col gap-4">
            {servicesQuery.data && servicesQuery.data.length > 1 ? (
              <div className="flex flex-col gap-2">
                <Label>Service</Label>
                <div className="flex flex-wrap gap-2">
                  {servicesQuery.data.map((s) => (
                    <Button
                      key={s.id}
                      size="sm"
                      variant={s.id === serviceId ? "default" : "outline"}
                      onClick={() => {
                        setServiceId(s.id);
                        setDurationMinutes(null);
                        setSelectedStartAt(null);
                      }}
                    >
                      {s.name}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {durationsQuery.data && durationsQuery.data.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Label>Appointment length</Label>
                <div className="flex flex-wrap gap-2">
                  {durationsQuery.data.map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      variant={d === durationMinutes ? "default" : "outline"}
                      onClick={() => {
                        setDurationMinutes(d);
                        setSelectedStartAt(null);
                      }}
                    >
                      <Clock /> {d} min
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {availabilityEnabled ? (
            <div className="grid gap-5 md:grid-cols-[auto_1fr]">
              <Card size="sm">
                <CardContent>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleSelectDate}
                    disabled={{ before: today }}
                  />
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle>
                    {format(selectedDate, "EEEE, MMMM d, yyyy")}
                  </CardTitle>
                  {providerTimezone ? (
                    <p className="pt-1 text-sm text-muted-foreground">
                      Times shown in {providerTimezone}
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {availabilityQuery.isLoading ? (
                    <p className="text-muted-foreground">Loading times…</p>
                  ) : slots.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {slots.map((slot) => {
                        const isSelected = slot.startAt === selectedStartAt;
                        return (
                          <Button
                            key={slot.startAt}
                            size="sm"
                            variant={isSelected ? "default" : "outline"}
                            onClick={() => {
                              setSelectedStartAt(slot.startAt);
                              setStep("details");
                            }}
                          >
                            {formatSlotTime(slot.startAt, providerTimezone)}
                          </Button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-1 py-4">
                      <p className="text-muted-foreground">
                        No times available on this day.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Try selecting another date on the calendar.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="text-muted-foreground">
              Loading availability for {selectedProvider?.name ?? "this clinician"}…
            </p>
          )}
        </div>
      ) : null}

      {/* ---------- Step 4: Patient details ---------- */}
      {step === "details" && selectedStartAt ? (
        <Card>
          <CardHeader>
            <CardTitle>Confirm your details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {/* Summary */}
            <div
              className="flex items-center gap-4 rounded-xl p-4"
              style={{ background: specialty.tint }}
            >
              <ProviderCrest
                name={selectedProvider?.name ?? "Riverbend Health"}
                careType={careType}
                size={52}
              />
              <div className="flex flex-col text-sm">
                <span className="font-medium text-foreground">
                  {selectedService?.name} with {selectedProvider?.name}
                </span>
                <span className="text-muted-foreground">
                  {format(selectedDate, "EEEE, MMMM d")} at{" "}
                  {formatSlotTime(selectedStartAt, providerTimezone)} ·{" "}
                  {durationMinutes} min
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="patient-name">Name</Label>
                  <Input
                    id="patient-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="patient-phone">Phone</Label>
                  <Input
                    id="patient-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    required
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="patient-email">Email</Label>
                <Input
                  id="patient-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="patient-notes">
                  Anything we should know? (optional)
                </Label>
                <Input
                  id="patient-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. recent injury, accessibility needs"
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedStartAt(null);
                    setStep("time");
                  }}
                >
                  <ArrowLeft /> Back
                </Button>
                <Button type="submit" disabled={createBooking.isPending}>
                  {createBooking.isPending ? "Booking…" : "Confirm booking"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- Step 5: Confirmation ---------- */}
      {step === "confirmation" && bookingResult ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <span
                className="flex size-14 items-center justify-center rounded-full"
                style={{ background: specialty.tint, color: accent }}
              >
                <CheckCircle2 className="size-8" />
              </span>
              <CardTitle className="text-2xl">You’re booked!</CardTitle>
              <p className="text-muted-foreground">
                A confirmation has been saved to this browser.
              </p>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div
              className="flex items-center gap-4 rounded-xl p-4"
              style={{ background: specialty.tint }}
            >
              <ProviderCrest
                name={selectedProvider?.name ?? "Riverbend Health"}
                careType={careType}
                size={56}
              />
              <div className="flex flex-col text-sm">
                <span className="font-medium text-foreground">
                  {selectedService?.name ?? "Appointment"} with{" "}
                  {selectedProvider?.name ?? "your clinician"}
                </span>
                <span className="text-muted-foreground">
                  {formatSlotTime(bookingResult.startAt, providerTimezone)} –{" "}
                  {formatSlotTime(bookingResult.endAt, providerTimezone)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Confirmation code</Label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
                <code className="flex-1 truncate text-sm">
                  {bookingResult.confirmationToken}
                </code>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  type="button"
                  aria-label="Copy confirmation code"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(bookingResult.confirmationToken)
                      .then(() => toast.success("Confirmation code copied"))
                      .catch(() => undefined);
                  }}
                >
                  <Copy />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Keep this code — you can view or cancel from{" "}
                <Link href="/booking/manage" className="text-primary underline">
                  My bookings
                </Link>
                .
              </p>
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button onClick={handleBookAnother} variant="outline">
              Book another
            </Button>
            <Button render={<Link href="/booking/manage" />}>
              Manage my bookings
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {/* ---------- Booking conflict (race lost) ---------- */}
      <Dialog
        open={conflict !== null}
        // Force an explicit choice — don't dismiss on an outside click.
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
      >
        {conflict ? (
          <DialogPopup>
            {(() => {
              const next = conflict.nextSlot;
              const differentDay =
                next !== null &&
                localDay(next.startAt, providerTimezone) !==
                  localDay(conflict.attemptedStartAt, providerTimezone);
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>That time was just booked</DialogTitle>
                    <DialogDescription>
                      Someone else grabbed{" "}
                      {formatSlotTime(conflict.attemptedStartAt, providerTimezone)}{" "}
                      a moment before you. Your details are saved — just pick a new
                      time.
                    </DialogDescription>
                  </DialogHeader>

                  {next ? (
                    <div
                      className="flex flex-col gap-1 rounded-xl p-4"
                      style={{ background: specialty.tint }}
                    >
                      <span className="text-sm text-muted-foreground">
                        Next available time
                      </span>
                      {differentDay ? (
                        <Badge
                          variant="soft"
                          className="w-fit"
                          style={{ background: accent, color: "#fff" }}
                        >
                          Different day — {formatSlotDate(next.startAt, providerTimezone)}
                        </Badge>
                      ) : null}
                      <span className="font-display text-xl text-foreground">
                        {differentDay
                          ? `${formatSlotDate(next.startAt, providerTimezone)}, ${formatSlotTime(next.startAt, providerTimezone)}`
                          : formatSlotTime(next.startAt, providerTimezone)}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      There are no other openings with{" "}
                      {selectedProvider?.name ?? "this clinician"} in the next 60
                      days. Try another clinician or check back later.
                    </p>
                  )}

                  <DialogFooter>
                    <Button variant="outline" onClick={dismissConflictToTimes}>
                      Pick another time
                    </Button>
                    {next ? (
                      <Button
                        disabled={createBooking.isPending}
                        onClick={() => acceptProposedSlot(next.startAt)}
                      >
                        {createBooking.isPending
                          ? "Booking…"
                          : `Book ${formatSlotTime(next.startAt, providerTimezone)} instead`}
                      </Button>
                    ) : null}
                  </DialogFooter>
                </>
              );
            })()}
          </DialogPopup>
        ) : null}
      </Dialog>
    </div>
  );
}
