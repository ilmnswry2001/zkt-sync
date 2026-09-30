import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function StaffNameChips({
  names,
  onRemove,
}: {
  names: string[];
  onRemove?: (name: string) => void;
}) {
  if (!names.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {names.map((name, index) => (
        <Badge
          key={`${name}-${index}`}
          variant="secondary"
          className="min-h-10 gap-1 rounded-full px-3 py-1"
        >
          <span dir="auto">{name}</span>
          {onRemove && (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`حذف ${name}`}
              onClick={() => onRemove(name)}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </Badge>
      ))}
    </div>
  );
}