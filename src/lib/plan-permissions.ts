import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PlanStaffingPermission = {
  user_id: string;
  can_request: boolean;
  can_approve: boolean;
  can_staff_all: boolean;
  specialties: string[];
};

export const PLAN_PERMISSION_SPECIALTIES = [
  "عامل بناء", "حداد", "نجار", "كهربائي", "سباك", "عامل تجهيز", "مقاول/مشرف",
  "مشرف موقع", "مهندس موقع", "آليات ثقيلة", "عامل خراطة", "مدخل بيانات",
  "HSE", "QC", "كوسورجي", "ريكر", "إطفائي",
];

/** Roles that can request plans and staff every specialty without an explicit grant. */
export const PLAN_FULL_ROLES = ["admin", "hr", "supervisor", "department_manager", "planning_officer"];

export function usePlanStaffingPermission(userId?: string | null) {
  return useQuery({
    queryKey: ["plan-staffing-permission", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("plan_staffing_permissions")
        .select("user_id, can_request, can_approve, can_staff_all, specialties")
        .eq("user_id", userId)
        .maybeSingle();
      return (data ?? null) as PlanStaffingPermission | null;
    },
  });
}

export function canStaffSpecialty(
  roles: string[],
  perm: PlanStaffingPermission | null | undefined,
  specialty: string,
) {
  if (roles.some((r) => PLAN_FULL_ROLES.includes(r))) return true;
  if (perm?.can_staff_all) return true;
  return (perm?.specialties ?? []).some((s) => s.trim() === specialty.trim());
}
