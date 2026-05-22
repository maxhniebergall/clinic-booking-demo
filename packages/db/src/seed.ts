/**
 * Seeds the booking tables with demo data so the real selectors on the
 * `/booking` page render against a populated database.
 *
 * Run AFTER `pnpm db:push` has created the tables:
 *
 *   pnpm --filter @my-better-t-app/db db:seed
 *
 * The script is idempotent-ish: it clears the booking tables first in
 * FK-safe order, then re-inserts a fixed demo dataset.
 *
 * Env is loaded from apps/web/.env (the single source of DB config), matching
 * packages/db/src/migrate-booking-constraints.ts. dotenv must run before the
 * db client is imported, because importing it eagerly validates DATABASE_URL.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import dotenv from "dotenv";
import { Pool } from "pg";

import {
  appointment,
  availabilityException,
  availabilityRule,
  provider,
  providerServiceOption,
  service,
} from "./schema/booking.ts";

dotenv.config({ path: "../../apps/web/.env" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (expected in apps/web/.env)");
  }

  // Build a standalone drizzle instance over a pg Pool, mirroring
  // migrate-booking-constraints.ts. We deliberately do NOT import ./index.ts:
  // its `import * as schema from "./schema"` is an extensionless directory
  // import that raw Node ESM (--experimental-strip-types) cannot resolve.
  // ./schema/booking.ts only imports external drizzle packages, so it loads.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // Clear in FK-safe order (children before parents).
  await db.delete(appointment);
  await db.delete(availabilityException);
  await db.delete(availabilityRule);
  await db.delete(providerServiceOption);
  await db.delete(provider);
  await db.delete(service);

  // Services
  const services = await db
    .insert(service)
    .values([
      { careType: "physical_therapy", name: "Physiotherapy assessment" },
      { careType: "chiropractic", name: "Chiropractic adjustment" },
    ])
    .returning();
  const physioService = services.find((s) => s.careType === "physical_therapy");
  const chiroService = services.find((s) => s.careType === "chiropractic");
  if (!physioService || !chiroService) {
    throw new Error("Failed to insert services");
  }

  // Providers
  const providers = await db
    .insert(provider)
    .values([
      {
        name: "Dr. Alice Nguyen",
        timezone: "America/Toronto",
        slotIncrementMinutes: 15,
      },
      {
        name: "Dr. Bertrand Okafor",
        timezone: "America/Toronto",
        slotIncrementMinutes: 15,
      },
      {
        name: "Dr. Carmen Silva",
        timezone: "America/Toronto",
        slotIncrementMinutes: 15,
      },
    ])
    .returning();

  // Link each provider to service(s). Alice does physio, Bertrand does chiro,
  // Carmen does both. Each link offers durations [30, 45, 60].
  const durations = [30, 45, 60];
  const linkPlan: Array<{ providerId: string; serviceId: string }> = [];
  const [alice, bertrand, carmen] = providers;
  if (!alice || !bertrand || !carmen) {
    throw new Error("Failed to insert providers");
  }
  linkPlan.push({ providerId: alice.id, serviceId: physioService.id });
  linkPlan.push({ providerId: bertrand.id, serviceId: chiroService.id });
  linkPlan.push({ providerId: carmen.id, serviceId: physioService.id });
  linkPlan.push({ providerId: carmen.id, serviceId: chiroService.id });

  const optionRows = linkPlan.flatMap(({ providerId, serviceId }) =>
    durations.map((durationMinutes) => ({
      providerId,
      serviceId,
      durationMinutes,
    })),
  );
  const insertedOptions = await db
    .insert(providerServiceOption)
    .values(optionRows)
    .returning();

  // Weekday availability (Mon–Fri, 09:00–17:00) for each provider.
  const ruleRows = providers.flatMap((p) =>
    [1, 2, 3, 4, 5].map((dayOfWeek) => ({
      providerId: p.id,
      dayOfWeek,
      startTime: "09:00",
      endTime: "17:00",
    })),
  );
  const insertedRules = await db
    .insert(availabilityRule)
    .values(ruleRows)
    .returning();

  console.log("Seed complete:");
  console.log(`  services:               ${services.length}`);
  console.log(`  providers:              ${providers.length}`);
  console.log(`  providerServiceOptions: ${insertedOptions.length}`);
  console.log(`  availabilityRules:      ${insertedRules.length}`);

  await pool.end();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
