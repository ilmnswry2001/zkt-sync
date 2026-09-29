import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole = "admin" | "hr" | "supervisor" | "data_entry" | "site_admin" | "department_manager";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchRoles = async (uid: string) => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      if (mounted) setRoles((data ?? []).map((r: any) => r.role));
    };
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      if (data.session?.user) fetchRoles(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchRoles(session.user.id);
      else setRoles([]);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  return {
    user,
    roles,
    loading,
    isAdmin: roles.includes("admin"),
    isHR: roles.includes("hr") || roles.includes("admin"),
    canManageEmployees: roles.some((r) => ["admin", "hr", "data_entry", "department_manager", "site_admin"].includes(r)),
    isDepartmentManager: roles.includes("department_manager"),
    isSiteAdmin: roles.includes("site_admin"),
    canCreateTasks: roles.some((r) => ["admin", "hr", "data_entry", "site_admin"].includes(r)) && !roles.includes("department_manager"),
    signOut: () => supabase.auth.signOut(),
  };
}
