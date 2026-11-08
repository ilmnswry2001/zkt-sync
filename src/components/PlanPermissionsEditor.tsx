import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PLAN_PERMISSION_SPECIALTIES, usePlanStaffingPermission } from "@/lib/plan-permissions";

export function PlanPermissionsEditor({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = usePlanStaffingPermission(userId);
  const [canRequest, setCanRequest] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [canStaffAll, setCanStaffAll] = useState(false);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCanRequest(!!data?.can_request);
    setCanApprove(!!data?.can_approve);
    setCanStaffAll(!!data?.can_staff_all);
    setSpecialties(data?.specialties ?? []);
  }, [data]);

  const options = [...new Set([...PLAN_PERMISSION_SPECIALTIES, ...specialties])];
  const toggle = (s: string, on: boolean) =>
    setSpecialties((c) => (on ? [...new Set([...c, s])] : c.filter((x) => x !== s)));

  const save = async () => {
    setBusy(true);
    const extras = extra.split(/[،,\n]/).map((s) => s.trim()).filter(Boolean);
    const { error } = await (supabase as any).from("plan_staffing_permissions").upsert({
      user_id: userId,
      can_request: canRequest,
      can_approve: canApprove,
      can_staff_all: canStaffAll,
      specialties: [...new Set([...specialties, ...extras])],
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setExtra("");
    qc.invalidateQueries({ queryKey: ["plan-staffing-permission", userId] });
    toast.success("تم حفظ صلاحيات الخطط");
  };

  return (
    <div className="md:col-span-2 rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
      <p className="font-semibold">صلاحيات خطط العمل</p>
      <p className="mb-3 text-xs text-muted-foreground">
        حدد إمكانية طلب الخطة، والتخصصات التي يملأ الحساب أسماء كوادرها (مثلاً قسم السلامة: HSE).
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={canRequest} onCheckedChange={(v) => setCanRequest(v === true)} />
              يستطيع طلب خطة
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={canApprove} onCheckedChange={(v) => setCanApprove(v === true)} />
              يستطيع الموافقة على الخطط
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={canStaffAll} onCheckedChange={(v) => setCanStaffAll(v === true)} />
              إدراج الكوادر لجميع التخصصات
            </label>
          </div>
          {!canStaffAll && (
            <>
              <p className="mb-2 text-sm font-medium">التخصصات المسموح بإدراج أسمائها</p>
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {options.map((s) => (
                  <label key={s} className="flex items-center gap-2 rounded-lg border bg-background p-2 text-sm">
                    <Checkbox checked={specialties.includes(s)} onCheckedChange={(v) => toggle(s, v === true)} />
                    {s}
                  </label>
                ))}
              </div>
              <Input
                className="mt-2"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="تخصصات إضافية مفصولة بفاصلة"
              />
            </>
          )}
          <Button className="mt-3" size="sm" disabled={busy} onClick={save}>
            {busy ? "جارٍ الحفظ..." : "حفظ صلاحيات الخطط"}
          </Button>
        </>
      )}
    </div>
  );
}
