import type { Award } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  icon: typeof Award;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
