import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AdvanceClosureAction = "waive" | "complete";
export type AdvanceClosure = {
  advance_id: string;
  action: AdvanceClosureAction;
  reason: string;
  amount: number;
  closed_at: string;
  closed_by: string | null;
};

type AdvanceClosureSchema = {
  public: {
    Tables: {
      employee_advance_closures: {
        Row: AdvanceClosure;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      close_employee_advance: {
        Args: { p_advance_id: string; p_action: AdvanceClosureAction; p_reason: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export const advanceClosuresDb = supabase as unknown as SupabaseClient<AdvanceClosureSchema>;

export const advanceInstallmentStatus: Record<string, string> = {
  scheduled: "مجدول",
  deducted: "مخصوم",
  waived: "متنازل عنه",
  settled_outside_payroll: "مسوّى خارج الرواتب",
};
