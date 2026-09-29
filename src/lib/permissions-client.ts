import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

type DepartmentAssignment = {
  id: string;
  user_id: string;
  department_id: string;
  created_at: string;
};

type DepartmentManagerAssignment = {
  id: string;
  user_id: string;
  department_id: string;
  created_at: string;
};

type PermissionDatabase = {
  public: {
    Tables: {
      user_departments: {
        Row: DepartmentAssignment;
        Insert: { id?: string; user_id: string; department_id: string; created_at?: string };
        Update: Partial<DepartmentAssignment>;
        Relationships: [];
      };
      department_managers: {
        Row: DepartmentManagerAssignment;
        Insert: { id?: string; user_id: string; department_id: string; created_at?: string };
        Update: Partial<DepartmentManagerAssignment>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type UserDepartment = DepartmentAssignment;
export const permissionsDb = supabase as unknown as SupabaseClient<PermissionDatabase>;
