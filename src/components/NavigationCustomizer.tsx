import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatErrorMessage } from "@/lib/error-message";
import { toast } from "sonner";
import { RotateCcw, Save, SlidersHorizontal } from "lucide-react";

type NavGroupOption = { key: string; label: string };
type NavItemOption = { to: string; label: string; groupKey: string };

export function NavigationCustomizer({
  groups,
  items,
  initialLabels,
  onClose,
  updatedBy,
}: {
  groups: NavGroupOption[];
  items: NavItemOption[];
  initialLabels: Record<string, string>;
  onClose: () => void;
  updatedBy: string | null;
}) {
  const client = useQueryClient();
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((group) => [group.key, initialLabels[group.key] ?? group.label])),
  );
  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.to, item.groupKey])),
  );

  const saveConfig = useMutation({
    mutationFn: async (payload: {
      labels: Record<string, string>;
      assignments: Record<string, string>;
    }) => {
      const { error } = await (supabase as any).from("navigation_settings").upsert({
        id: "default",
        labels: payload.labels,
        assignments: payload.assignments,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حفظ تخصيص القائمة");
      await client.invalidateQueries({ queryKey: ["navigation-settings"] });
      onClose();
    },
    onError: (error: Error) => {
      const message = formatErrorMessage(error);
      toast.error(
        /navigation_settings|relation|does not exist/i.test(message)
          ? "جدول تخصيص القائمة غير موجود. طبّق ترحيل 20261019160000_navigation_settings.sql أولاً."
          : `تعذر حفظ التخصيص: ${message}`,
      );
    },
  });

  const handleSave = () => {
    const labelOverrides: Record<string, string> = {};
    for (const group of groups) {
      const value = labels[group.key]?.trim();
      if (value && value !== group.label) labelOverrides[group.key] = value;
    }
    const nextAssignments: Record<string, string> = {};
    for (const item of items) {
      nextAssignments[item.to] = assignments[item.to] || item.groupKey;
    }
    saveConfig.mutate({ labels: labelOverrides, assignments: nextAssignments });
  };

  const handleReset = () => {
    saveConfig.mutate({ labels: {}, assignments: {} });
  };

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" /> تخصيص القائمة الجانبية
          </DialogTitle>
          <DialogDescription>
            أعد تسمية المجموعات أو انقل الأقسام بينها. يظهر التخصيص لجميع المستخدمين.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-bold">أسماء المجموعات</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((group) => (
                <div key={group.key} className="space-y-1.5">
                  <Label htmlFor={`group-${group.key}`} className="text-xs text-muted-foreground">
                    {group.label}
                  </Label>
                  <Input
                    id={`group-${group.key}`}
                    value={labels[group.key] ?? ""}
                    onChange={(event) =>
                      setLabels((current) => ({ ...current, [group.key]: event.target.value }))
                    }
                    placeholder={group.label}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold">توزيع الأقسام</h3>
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.to}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2"
                >
                  <span className="text-sm font-medium">{item.label}</span>
                  <Select
                    value={assignments[item.to] || item.groupKey}
                    onValueChange={(value) =>
                      setAssignments((current) => ({ ...current, [item.to]: value }))
                    }
                  >
                    <SelectTrigger className="h-9 w-52">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group.key} value={group.key}>
                          {labels[group.key]?.trim() || group.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={handleReset} disabled={saveConfig.isPending}>
            <RotateCcw className="ml-2 h-4 w-4" /> استعادة الافتراضي
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="button" onClick={handleSave} disabled={saveConfig.isPending}>
              <Save className="ml-2 h-4 w-4" /> {saveConfig.isPending ? "جارٍ الحفظ…" : "حفظ التخصيص"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
