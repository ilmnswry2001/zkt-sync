import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatErrorMessage } from "@/lib/error-message";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Candidate = {
  id: string;
  full_name: string;
  employee_no: string;
  attendance_device_id: string | null;
};

export function AssignDevicePinDialog({
  record,
  close,
}: {
  record: { id: string; pin: string };
  close: () => void;
}) {
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const term = search.trim();
  const candidates = useQuery({
    queryKey: ["device-pin-employee-search", term],
    enabled: !!term,
    queryFn: async ({ signal }) => {
      const pattern = JSON.stringify(`%${term}%`);
      const { data, error } = await supabase
        .from("employees")
        .select("id,full_name,employee_no,attendance_device_id")
        .or(`full_name.ilike.${pattern},employee_no.ilike.${pattern}`)
        .order("full_name")
        .order("id")
        .limit(40)
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const assign = useMutation({
    mutationFn: async (employee: Candidate) => {
      const { data, error } = await supabase.rpc("assign_unmatched_device_pin", {
        p_record_id: record.id,
        p_employee_id: employee.id,
        p_previous_pin: employee.attendance_device_id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (count, employee) => {
      for (const key of [
        ["employee-profile", employee.id],
        ["employees"],
        ["employee-profile-search"],
        ["device-pin-employee-search"],
        ["device-sync-records"],
        ["zkteco-sync-status"],
        ["devices"],
      ]) {
        void cache.invalidateQueries({ queryKey: key });
      }
      toast.success(`تم تنسيب الرقم إلى ${employee.full_name} ومعالجة ${count} حركة`);
      close();
    },
    onError: (error) => toast.error(formatErrorMessage(error)),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !assign.isPending) close();
      }}
    >
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-auto">
        <DialogTitle>
          تنسيب رقم البصمة <bdi>{record.pin}</bdi> لموظف
        </DialogTitle>
        <DialogDescription>
          يُحفظ الرقم في ملف الموظف وتُطابق حركاته غير المطابقة بهذا الرقم على جميع الأجهزة.
        </DialogDescription>
        <label className="grid gap-2">
          اسم الموظف أو رقمه الوظيفي
          <Input
            autoFocus
            value={search}
            disabled={assign.isPending}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
            }}
          />
        </label>
        <div className="max-h-60 space-y-1 overflow-auto">
          {term &&
            (candidates.isPending ? (
              <p>جارٍ البحث…</p>
            ) : candidates.isError ? (
              <Button variant="outline" onClick={() => candidates.refetch()}>
                تعذر البحث · إعادة المحاولة
              </Button>
            ) : !candidates.data?.length ? (
              <p>لا يوجد موظف مطابق للبحث.</p>
            ) : (
              candidates.data.map((employee) => (
                <Button
                  key={employee.id}
                  disabled={assign.isPending}
                  aria-pressed={selected?.id === employee.id}
                  variant={selected?.id === employee.id ? "default" : "outline"}
                  className="h-auto min-h-10 w-full justify-start whitespace-normal"
                  onClick={() => setSelected(employee)}
                >
                  {employee.full_name} · <bdi>{employee.employee_no}</bdi>
                </Button>
              ))
            ))}
        </div>
        {selected && (
          <p>
            الموظف المختار: {selected.full_name}
            {selected.attendance_device_id && selected.attendance_device_id !== record.pin && (
              <>
                {" "}
                · سيُستبدل رقم البصمة الحالي <bdi>{selected.attendance_device_id}</bdi> بالرقم{" "}
                <bdi>{record.pin}</bdi>.
              </>
            )}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            disabled={!selected || assign.isPending}
            onClick={() => selected && assign.mutate(selected)}
          >
            {assign.isPending ? "جارٍ التنسيب…" : "تأكيد التنسيب"}
          </Button>
          <Button variant="outline" disabled={assign.isPending} onClick={close}>
            إلغاء
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
