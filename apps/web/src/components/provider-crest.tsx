import { getSpecialty } from "@/lib/specialties";

/**
 * A deterministic "stamp" crest logo generated for each provider: their
 * initials inside a filled circle tinted to their specialty, with the
 * specialty + credential curving around a dotted ring. No images, no DB
 * field — derived entirely from the provider's name and care type.
 */

function initialsFromName(name: string): string {
  // Drop honorifics (and any trailing dot), then keep only words that start
  // with a letter so a stray "." from "Dr." never becomes an initial.
  const words = name
    .replace(/\b(dr|mr|mrs|ms|prof)\b\.?/gi, "")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "RH";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  // First letter of the first and last meaningful word.
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function ProviderCrest({
  name,
  careType,
  size = 96,
  className,
}: {
  name: string;
  careType: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const specialty = getSpecialty(careType);
  const initials = initialsFromName(name);
  const pathId = `crest-ring-${slug(name)}-${specialty.careType}`;
  const ringText =
    `${specialty.label} · ${specialty.abbrev} · Riverbend · `.toUpperCase();

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={`${name}, ${specialty.credential}`}
      style={{ color: specialty.color }}
    >
      <defs>
        {/* Full-circle path (clockwise from top) for the ring text. */}
        <path
          id={pathId}
          fill="none"
          d="M 50,12 A 38,38 0 1 1 49.99,12"
        />
      </defs>

      {/* Dotted outer ring */}
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="0.5 3"
        strokeLinecap="round"
        opacity="0.6"
      />

      {/* Curved ring text */}
      <text
        fill="currentColor"
        fontSize="6.4"
        fontWeight="600"
        letterSpacing="1.1"
        style={{ textTransform: "uppercase" }}
      >
        <textPath href={`#${pathId}`} startOffset="0%">
          {ringText}
        </textPath>
      </text>

      {/* Inner filled disc */}
      <circle cx="50" cy="50" r="29" fill="currentColor" />
      <circle
        cx="50"
        cy="50"
        r="29"
        fill="none"
        stroke="white"
        strokeWidth="1"
        opacity="0.35"
      />

      {/* Initials */}
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="22"
        fontWeight="500"
        fontFamily="var(--font-fraunces), Georgia, serif"
        letterSpacing="0.5"
      >
        {initials}
      </text>
    </svg>
  );
}

export default ProviderCrest;
