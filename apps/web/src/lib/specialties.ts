import { Activity, Bone, type LucideIcon, Stethoscope } from "lucide-react";

/**
 * Single source of truth for how each care type ("specialty") is presented:
 * its display label, the practitioner credential, an icon, and the accent
 * colors (defined as CSS variables in packages/ui/src/styles/globals.css).
 *
 * Consumed by the provider crest, specialty/service cards, badges, and the
 * per-step theming of the booking flow. Extend this map if the careType enum
 * in packages/db/src/schema/booking.ts grows.
 */

export type CareType = "physical_therapy" | "chiropractic";

export type Specialty = {
  careType: CareType;
  /** Short label shown in UI, e.g. "Physiotherapy". */
  label: string;
  /** Practitioner credential, used in crest ring text. */
  credential: string;
  /** Letter abbreviation for the crest ring, e.g. "RPT". */
  abbrev: string;
  /** One-line description for cards. */
  blurb: string;
  Icon: LucideIcon;
  /** Solid accent color (CSS var). */
  color: string;
  /** Light tint background (CSS var). */
  tint: string;
};

export const SPECIALTIES: Record<CareType, Specialty> = {
  physical_therapy: {
    careType: "physical_therapy",
    label: "Physiotherapy",
    credential: "Registered Physiotherapist",
    abbrev: "RPT",
    blurb:
      "Movement assessments and hands-on rehabilitation to get you back to doing what you love.",
    Icon: Activity,
    color: "var(--specialty-pt)",
    tint: "var(--specialty-pt-tint)",
  },
  chiropractic: {
    careType: "chiropractic",
    label: "Chiropractic",
    credential: "Doctor of Chiropractic",
    abbrev: "DC",
    blurb:
      "Spinal and joint adjustments to relieve pain, restore mobility, and support whole-body wellness.",
    Icon: Bone,
    color: "var(--specialty-chiro)",
    tint: "var(--specialty-chiro-tint)",
  },
};

/** Resolve a specialty by careType, with a safe fallback for unknown values. */
export function getSpecialty(careType: string | null | undefined): Specialty {
  if (careType && careType in SPECIALTIES) {
    return SPECIALTIES[careType as CareType];
  }
  return {
    careType: "physical_therapy",
    label: "Care",
    credential: "Clinician",
    abbrev: "RHC",
    blurb: "Personalized care from our practitioners.",
    Icon: Stethoscope,
    color: "var(--primary)",
    tint: "var(--accent)",
  };
}

export const ALL_SPECIALTIES: Specialty[] = Object.values(SPECIALTIES);
