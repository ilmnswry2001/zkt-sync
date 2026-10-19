import { cn } from "@/lib/utils";
import { CarFront, Fuel, ShieldAlert } from "lucide-react";

export const DEFAULT_VEHICLE_IMAGE = "/vehicles/minivan.png";

type VehicleDiagramData = {
  plate: string;
  vehicleClass: "light" | "heavy";
  lastFuelDate: string | null;
  permitExpiry: string | null;
  imageUrl: string | null;
};

function formatArabicDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("ar-IQ", { day: "numeric", month: "long", year: "numeric" });
}

function daysUntil(value: string | null) {
  if (!value) return null;
  const target = new Date(`${value}T12:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function relativeDays(days: number | null) {
  if (days === null) return null;
  if (days === 0) return "اليوم";
  if (days > 0) return `خلال ${days} يوم`;
  return `منذ ${Math.abs(days)} يوم`;
}

function CalloutChip({
  icon: Icon,
  label,
  value,
  hint,
  hintTone,
  className,
}: {
  icon: typeof Fuel;
  label: string;
  value: string;
  hint?: string | null;
  hintTone?: string;
  className?: string;
}) {
  return (
    <div className={cn("glass-card rounded-2xl p-3 shadow-lg shadow-slate-950/10", className)}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2 text-sm font-bold leading-snug">{value}</p>
      {hint && <p className={cn("mt-1 text-[11px] font-medium", hintTone)}>{hint}</p>}
    </div>
  );
}

export function VehicleDiagram({ data }: { data: VehicleDiagramData }) {
  const fuelDays = daysUntil(data.lastFuelDate);
  const permitDays = daysUntil(data.permitExpiry);

  const fuelTone =
    fuelDays !== null && fuelDays >= 0 ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400";
  const permitTone =
    permitDays === null
      ? "text-muted-foreground"
      : permitDays < 0
        ? "text-destructive"
        : permitDays <= 30
          ? "text-amber-600 dark:text-amber-400"
          : "text-emerald-600 dark:text-emerald-400";

  const callouts = [
    {
      icon: CarFront,
      label: "رقم اللوحة",
      value: data.plate || "غير مسجل",
      hint: data.vehicleClass === "light" ? "مركبة خفيفة" : "مركبة ثقيلة",
      hintTone: "text-muted-foreground",
    },
    {
      icon: Fuel,
      label: "آخر تعبئة وقود",
      value: formatArabicDate(data.lastFuelDate) ?? "غير مسجل",
      hint: relativeDays(fuelDays),
      hintTone: fuelTone,
    },
    {
      icon: ShieldAlert,
      label: "انتهاء التصريح الأمني",
      value: formatArabicDate(data.permitExpiry) ?? "غير مسجل",
      hint: permitDays === null ? null : permitDays < 0 ? `منتهي ${relativeDays(permitDays)}` : relativeDays(permitDays),
      hintTone: permitTone,
    },
  ] as const;

  const imageSrc = data.imageUrl?.trim() ? data.imageUrl.trim() : DEFAULT_VEHICLE_IMAGE;

  return (
    <div className="space-y-4">
      <div className="glass-card relative overflow-hidden rounded-3xl">
        <div className="vehicle-stage-glow pointer-events-none absolute inset-0" />
        <div className="relative aspect-[1672/940]">
          <img
            src={imageSrc}
            alt="شكل المركبة"
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain"
            onError={(event) => {
              const image = event.currentTarget;
              if (image.src.endsWith(DEFAULT_VEHICLE_IMAGE)) return;
              image.src = DEFAULT_VEHICLE_IMAGE;
            }}
          />

          {/* hotspots on the vehicle */}
          <span className="vehicle-hotspot" style={{ left: "4.5%", top: "72%" }} aria-hidden="true" />
          <span className="vehicle-hotspot" style={{ left: "75.7%", top: "53%" }} aria-hidden="true" />
          <span className="vehicle-hotspot" style={{ left: "28.5%", top: "36%" }} aria-hidden="true" />

          {/* connector lines (desktop) */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
            aria-hidden="true"
          >
            <line x1={4.5} y1={72} x2={13} y2={82} className="vehicle-connector" vectorEffect="non-scaling-stroke" />
            <line x1={75.7} y1={53} x2={83} y2={16} className="vehicle-connector" vectorEffect="non-scaling-stroke" />
            <line x1={28.5} y1={36} x2={13} y2={14} className="vehicle-connector" vectorEffect="non-scaling-stroke" />
          </svg>

          {/* callout chips (desktop) */}
          <CalloutChip
            icon={CarFront}
            label="رقم اللوحة"
            value={data.plate || "غير مسجل"}
            hint={data.vehicleClass === "light" ? "مركبة خفيفة" : "مركبة ثقيلة"}
            hintTone="text-muted-foreground"
            className="absolute bottom-[6%] left-[3%] z-10 hidden w-44 lg:block"
          />
          <CalloutChip
            icon={Fuel}
            label="آخر تعبئة وقود"
            value={formatArabicDate(data.lastFuelDate) ?? "غير مسجل"}
            hint={relativeDays(fuelDays)}
            hintTone={fuelTone}
            className="absolute right-[3%] top-[6%] z-10 hidden w-44 lg:block"
          />
          <CalloutChip
            icon={ShieldAlert}
            label="انتهاء التصريح الأمني"
            value={formatArabicDate(data.permitExpiry) ?? "غير مسجل"}
            hint={permitDays === null ? null : permitDays < 0 ? `منتهي ${relativeDays(permitDays)}` : relativeDays(permitDays)}
            hintTone={permitTone}
            className="absolute left-[3%] top-[6%] z-10 hidden w-44 lg:block"
          />
        </div>
      </div>

      {/* callout cards (mobile / stacked) */}
      <div className="grid gap-3 sm:grid-cols-3 lg:hidden">
        {callouts.map((callout) => (
          <CalloutChip key={callout.label} {...callout} />
        ))}
      </div>
    </div>
  );
}
