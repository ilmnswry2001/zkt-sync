import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getPenaltyTotals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(input),
  )
  .handler(async ({ data: { month }, context: { supabase } }) => {
    const [year, number] = month.split("-").map(Number);
    const end = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
    const totals = { total: 0, absence: 0, deduction: 0, warning: 0, amount: 0 };
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase
        .from("employee_penalties")
        .select("penalty_type, deduction_amount")
        .gte("penalty_date", month + "-01")
        .lt("penalty_date", end)
        .order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      for (const row of data) {
        totals.total++;
        const type = row.penalty_type;
        if (type === "absence" || type === "deduction" || type === "warning") totals[type]++;
        totals.amount += Number(row.deduction_amount || 0);
      }
      if (data.length < 500) return totals;
    }
  });
