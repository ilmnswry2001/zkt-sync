import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type MetricTone = "primary" | "success" | "warning" | "destructive" | "info";

/** Shared statistical readout. Accent denotes category/status, never a fabricated trend. */
export function MetricCard({
  title,
  value,
  icon: Icon,
  detail,
  loading = false,
  tone = "primary",
  className,
}: {
  title: string;
  value: number | string;
  icon?: LucideIcon;
  detail?: ReactNode;
  loading?: boolean;
  tone?: MetricTone;
  className?: string;
}) {
  return (
    <Card className={cn("erp-metric min-w-0", className)} data-tone={tone} aria-busy={loading}>
      <CardContent className="erp-metric-content">
        <div className="erp-metric-heading">
          <p className="erp-metric-label">{title}</p>
          {Icon && (
            <span className="erp-metric-icon" aria-hidden="true">
              <Icon className="h-5 w-5" />
            </span>
          )}
        </div>
        {loading ? (
          <div
            aria-label="جارٍ التحميل"
            className="my-3 h-10 w-28 animate-pulse rounded-md bg-muted"
          />
        ) : (
          <p className="erp-metric-value">{value}</p>
        )}
        {!loading && detail && <div className="erp-metric-detail">{detail}</div>}
        <div className="erp-metric-rule" aria-hidden="true" />
      </CardContent>
    </Card>
  );
}
