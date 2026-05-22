/**
 * Adds out-of-band constraints to the booking tables:
 *
 *   1. `appointment_no_overlap` — a GIST exclusion constraint Drizzle's schema
 *      DSL cannot express.
 *   2. The `provider.user_id` / `appointment.user_id` foreign keys to `user`.
 *      These live here (not as `.references()` in the schema) so booking.ts
 *      stays free of a cross-schema import — the seed runs under Node's
 *      type-stripping, which can't resolve the extensionless `./auth` import.
 *
 * Run AFTER `pnpm db:push` has created the tables:
 *
 *   pnpm --filter @my-better-t-app/db db:booking-constraints
 *
 * The script is idempotent — safe to run repeatedly. Note that a subsequent
 * `db:push` will not manage these constraints; if drizzle-kit ever offers to
 * drop them, decline, then re-run this script.
 */
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: "../../apps/web/.env" });

const DDL = `
-- Equality operator class for non-range columns inside a GIST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_no_overlap'
  ) THEN
    ALTER TABLE appointment
      ADD CONSTRAINT appointment_no_overlap
      EXCLUDE USING gist (
        provider_id WITH =,
        tstzrange(start_at, end_at) WITH &&
      ) WHERE (status = 'booked');
  END IF;

  -- Column-based checks (not name-based): an earlier db:push may already have
  -- created these FKs under Drizzle's auto-generated names. Skip if any FK on
  -- the user_id column already exists so this stays a safe no-op.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'provider'::regclass
      AND a.attname = 'user_id'
  ) THEN
    ALTER TABLE provider
      ADD CONSTRAINT provider_user_id_fk
      FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'appointment'::regclass
      AND a.attname = 'user_id'
  ) THEN
    ALTER TABLE appointment
      ADD CONSTRAINT appointment_user_id_fk
      FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE SET NULL;
  END IF;
END $$;
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (expected in apps/web/.env)");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(DDL);
    console.log("✓ appointment_no_overlap exclusion constraint is in place");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
