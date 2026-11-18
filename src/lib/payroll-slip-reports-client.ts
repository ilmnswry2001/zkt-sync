import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type PayrollSlipRow = {
  employee: { full_name: string; employee_no: string; departments?: { name: string } | null };
  payroll: { basePay: number; overtimeHours: number; overtimePay: number };
  additions: number;
  deductions: number;
  total: number;
  summary: { presentDays: number };
  penalties: Array<{ deduction_amount: number | null; notes: string | null }>;
};

type PayrollSlipReport = {
  month: string;
  revision: string;
  generated_at: string;
  employee_count: number;
  matching_count: number;
  rows: PayrollSlipRow[];
};

type PayrollSlipSchema = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      read_latest_payroll_slips: {
        Args: { p_page: number; p_search: string };
        Returns: PayrollSlipReport | null;
      };
      save_payroll_slips: { Args: { p_month: string; p_rows: PayrollSlipRow[] }; Returns: undefined };
      delete_payroll_slips: { Args: { p_revision: string }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export const payrollSlipReportsDb = supabase as unknown as SupabaseClient<PayrollSlipSchema>;
