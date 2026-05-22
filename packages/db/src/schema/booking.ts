import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Care types offered by the clinic. Drives the `service.careType` filter.
export const careTypeEnum = pgEnum("care_type", [
  "physical_therapy",
  "chiropractic",
]);

// The overlap exclusion constraint (added out-of-band, see
// packages/db/src/migrate-booking-constraints.ts) only excludes rows where
// status = 'booked', so cancelled/completed appointments free their time.
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "booked",
  "cancelled",
  "completed",
]);

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

export const provider = pgTable("provider", {
  id: id(),
  // The clinician account (user.id) that owns/manages this provider. Nullable
  // so demo providers can exist unowned until a clinician claims one. The FK to
  // `user` is added out-of-band (see migrate-booking-constraints.ts) to keep
  // this file free of a cross-schema import — the seed runs under Node's
  // type-stripping, which can't resolve the extensionless `./auth` import.
  userId: text("user_id"),
  name: text("name").notNull(),
  // IANA timezone, e.g. "America/New_York". Availability rules are authored in
  // this zone's wall-clock time and converted to UTC instants when computing slots.
  timezone: text("timezone").notNull(),
  // Spacing (minutes) between candidate appointment start times, e.g. 15.
  slotIncrementMinutes: integer("slot_increment_minutes").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const service = pgTable(
  "service",
  {
    id: id(),
    careType: careTypeEnum("care_type").notNull(),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("service_care_type_idx").on(table.careType)],
);

// The set of appointment lengths a provider offers for a service. A provider
// "offers" a service iff it has at least one option row here.
export const providerServiceOption = pgTable(
  "provider_service_option",
  {
    id: id(),
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    durationMinutes: integer("duration_minutes").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("provider_service_option_unique_idx").on(
      table.providerId,
      table.serviceId,
      table.durationMinutes,
    ),
    index("provider_service_option_provider_service_idx").on(
      table.providerId,
      table.serviceId,
    ),
  ],
);

// Recurring weekly availability windows, in provider-local wall-clock time.
export const availabilityRule = pgTable(
  "availability_rule",
  {
    id: id(),
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.id, { onDelete: "cascade" }),
    // 0 = Sunday .. 6 = Saturday (matches Date#getUTCDay()).
    dayOfWeek: integer("day_of_week").notNull(),
    // "HH:MM" 24h, provider-local.
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("availability_rule_provider_idx").on(table.providerId)],
);

// Date-specific time-off / blackouts that subtract from the weekly rules.
export const availabilityException = pgTable(
  "availability_exception",
  {
    id: id(),
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.id, { onDelete: "cascade" }),
    // "YYYY-MM-DD" provider-local date.
    date: text("date").notNull(),
    blockAllDay: boolean("block_all_day").default(true).notNull(),
    // Optional partial-day block window ("HH:MM"), used when blockAllDay = false.
    startTime: text("start_time"),
    endTime: text("end_time"),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("availability_exception_provider_date_idx").on(
      table.providerId,
      table.date,
    ),
  ],
);

export const appointment = pgTable(
  "appointment",
  {
    id: id(),
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "restrict" }),
    // The patient account (user.id) this booking belongs to, when booked (or
    // later claimed) by a logged-in user. Null for purely anonymous bookings,
    // which are managed via confirmationToken instead. FK added out-of-band
    // (see migrate-booking-constraints.ts), as with provider.userId above.
    userId: text("user_id"),
    status: appointmentStatusEnum("status").default("booked").notNull(),
    // UTC instants. startAt sits on the provider's candidate grid.
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    patientName: text("patient_name").notNull(),
    patientEmail: text("patient_email").notNull(),
    patientPhone: text("patient_phone").notNull(),
    notes: text("notes"),
    // High-entropy secret; possession authorizes viewing/cancelling this booking.
    confirmationToken: text("confirmation_token").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("appointment_confirmation_token_idx").on(
      table.confirmationToken,
    ),
    // Drives the availability subtraction query (booked ranges per provider).
    index("appointment_provider_status_start_idx").on(
      table.providerId,
      table.status,
      table.startAt,
    ),
    // Drives "my bookings" lookups for a logged-in patient.
    index("appointment_user_idx").on(table.userId),
    // NOTE: the no-overlap guarantee is a GIST exclusion constraint that Drizzle
    // cannot express; it is added by packages/db/src/migrate-booking-constraints.ts.
  ],
);

export const providerRelations = relations(provider, ({ many }) => ({
  serviceOptions: many(providerServiceOption),
  availabilityRules: many(availabilityRule),
  availabilityExceptions: many(availabilityException),
  appointments: many(appointment),
}));

export const serviceRelations = relations(service, ({ many }) => ({
  providerOptions: many(providerServiceOption),
  appointments: many(appointment),
}));

export const providerServiceOptionRelations = relations(
  providerServiceOption,
  ({ one }) => ({
    provider: one(provider, {
      fields: [providerServiceOption.providerId],
      references: [provider.id],
    }),
    service: one(service, {
      fields: [providerServiceOption.serviceId],
      references: [service.id],
    }),
  }),
);

export const availabilityRuleRelations = relations(
  availabilityRule,
  ({ one }) => ({
    provider: one(provider, {
      fields: [availabilityRule.providerId],
      references: [provider.id],
    }),
  }),
);

export const availabilityExceptionRelations = relations(
  availabilityException,
  ({ one }) => ({
    provider: one(provider, {
      fields: [availabilityException.providerId],
      references: [provider.id],
    }),
  }),
);

export const appointmentRelations = relations(appointment, ({ one }) => ({
  provider: one(provider, {
    fields: [appointment.providerId],
    references: [provider.id],
  }),
  service: one(service, {
    fields: [appointment.serviceId],
    references: [service.id],
  }),
}));
