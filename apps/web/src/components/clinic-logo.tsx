import { cn } from "@my-better-t-app/ui/lib/utils";

export const CLINIC_NAME = "Riverbend Health Collective";

/** The circular emblem — a stylized river bend. Reused at any size. */
export function ClinicMark({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Riverbend Health Collective"
    >
      <circle cx="24" cy="24" r="23" className="fill-primary" />
      <g
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.95"
      >
        <path d="M13 18 C 20 12, 28 24, 35 18" />
        <path d="M13 24 C 20 18, 28 30, 35 24" />
        <path d="M13 30 C 20 24, 28 36, 35 30" />
      </g>
    </svg>
  );
}

export function ClinicLogo({
  className,
  markSize = 36,
  tone = "default",
}: {
  className?: string;
  markSize?: number;
  tone?: "default" | "inverted";
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <ClinicMark size={markSize} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-display text-[1.05rem] font-medium tracking-[0.06em] uppercase",
            tone === "inverted" ? "text-background" : "text-primary",
          )}
        >
          Riverbend
        </span>
        <span
          className={cn(
            "text-[0.6rem] font-medium tracking-[0.22em] uppercase",
            tone === "inverted"
              ? "text-background/70"
              : "text-muted-foreground",
          )}
        >
          Health Collective
        </span>
      </span>
    </span>
  );
}

export default ClinicLogo;
