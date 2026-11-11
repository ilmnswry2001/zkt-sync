import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const labels = {
  employees: "الملف الشخصي",
  attendance_day_status: "الحضور",
  vehicle_monthly_operations: "تشغيل المركبة",
  machinery_monthly_operations: "تشغيل الآلية",
};
type Entry = {
  id: number;
  source: keyof typeof labels;
  actor_name: string;
  subject_name: string;
  effective_date: string | null;
  action: string;
  created_at: string;
};

export function EmployeeReportHistory({
  employeeId,
  month,
}: {
  employeeId?: string;
  month?: string;
}) {
  const [page, setPage] = useState(0);
  const history = useQuery({
    queryKey: [
      month ? "monthly" : "employee-profile",
      ...(month ? ["history", month, employeeId] : [employeeId, "history"]),
      page,
    ],
    queryFn: async (): Promise<Entry[]> => {
      let query = (supabase as any)
        .from("employee_report_history")
        .select("id,source,actor_name,subject_name,effective_date,action,created_at");
      if (employeeId) query = query.eq("subject_id", employeeId);
      if (month) {
        const [year, m] = month.split("-").map(Number);
        query = query
          .gte("effective_date", month + "-01")
          .lt("effective_date", new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 10));
      }
      const { data, error } = await query
        .order("id", { ascending: false })
        .range(page * 20, page * 20 + 20);
      if (error) throw error;
      return data;
    },
  });
  return (
    <section dir="rtl" className="space-y-3 rounded-xl border bg-card p-4">
      <h3 className="font-semibold">سجل التغييرات</h3>
      {history.isLoading
        ? "جارٍ تحميل السجل…"
        : history.isError
          ? "تعذر تحميل سجل التغييرات"
          : !history.data?.length
            ? "لا توجد تغييرات مسجلة"
            : history.data.slice(0, 20).map((row) => (
                <p key={row.id} className="border-b pb-2 text-sm">
                  <b>{row.actor_name}</b> ·{" "}
                  {row.action === "DELETE" ? "حذف" : row.action === "INSERT" ? "إضافة" : "تعديل"}{" "}
                  {labels[row.source]} · {row.subject_name} {row.effective_date}{" "}
                  <span className="block text-muted-foreground">
                    {new Date(row.created_at).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" })}
                  </span>
                </p>
              ))}
      {page > 0 && (
        <Button variant="outline" onClick={() => setPage(page - 1)}>
          السابق
        </Button>
      )}
      {(history.data?.length ?? 0) > 20 && (
        <Button variant="outline" onClick={() => setPage(page + 1)}>
          التالي
        </Button>
      )}
    </section>
  );
}
