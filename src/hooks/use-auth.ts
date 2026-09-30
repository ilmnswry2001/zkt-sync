import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "admin" | "hr" | "supervisor" | "data_entry" | "site_admin" | "department_manager";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isCompanyManager, setIsCompanyManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchRoles = async (uid: string) => {
      setPermissionsLoading(true);
      const [rolesResult, formRolesResult] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("form_role_assignments").select("role").eq("user_id", uid).eq("role", "ceo"),
      ]);
      if (!mounted) return;
      setRoles((rolesResult.data ?? []).map((role: any) => role.role));
      setIsCompanyManager((formRolesResult.data ?? []).some((role) => role.role === "ceo"));
      setPermissionsLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      if (data.session?.user) fetchRoles(data.session.user.id);
      else setPermissionsLoading(false);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchRoles(session.user.id);
      else {
        setRoles([]);
        setIsCompanyManager(false);
        setPermissionsLoading(false);
      }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  return {
    user,
    roles,
    loading,
    permissionsLoading,
    isAdmin: roles.includes("admin"),
    isCompanyManager,
    isHR: roles.includes("hr") || roles.includes("admin"),
    canManageEmployees: roles.some((r) => ["admin", "hr", "data_entry", "department_manager", "site_admin"].includes(r)),
    isDepartmentManager: roles.includes("department_manager"),
    isSiteAdmin: roles.includes("site_admin"),
    canCreateTasks: roles.some((r) => ["admin", "hr", "data_entry", "site_admin"].includes(r)) && !roles.includes("department_manager"),
    signOut: () => supabase.auth.signOut(),
  };
}
