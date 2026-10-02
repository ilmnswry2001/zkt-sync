import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AppRole =
  | "admin"
  | "hr"
  | "supervisor"
  | "data_entry"
  | "site_admin"
  | "department_manager"
  | "engineer";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null);
  const [isCompanyManager, setIsCompanyManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchRoles = async (uid: string) => {
      setPermissionsLoading(true);
      const [rolesResult, formRolesResult, profileResult] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("form_role_assignments").select("role").eq("user_id", uid).eq("role", "ceo"),
        supabase.from("profiles").select("allowed_sections").eq("id", uid).maybeSingle(),
      ]);
      if (!mounted) return;
      setRoles((rolesResult.data ?? []).map((role: any) => role.role));
      setIsCompanyManager((formRolesResult.data ?? []).some((role) => role.role === "ceo"));
      const sections = (profileResult.data as any)?.allowed_sections as string[] | null | undefined;
      setAllowedSections(sections && sections.length ? sections : null);
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
        setAllowedSections(null);
        setIsCompanyManager(false);
        setPermissionsLoading(false);
      }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const isAdmin = roles.includes("admin");
  const isEngineer = roles.includes("engineer") && !isAdmin;
  // null = no restriction. Engineers are limited to planning.
  const sections = isAdmin ? null : isEngineer ? ["/planning"] : allowedSections;

  return {
    user,
    roles,
    loading,
    permissionsLoading,
    isAdmin,
    isEngineer,
    allowedSections: sections,
    canAccessSection: (path: string) => !sections || sections.includes(path),
    isCompanyManager,
    isHR: roles.includes("hr") || isAdmin,
    canManageEmployees: roles.some((r) => ["admin", "hr", "data_entry", "department_manager", "site_admin"].includes(r)),
    isDepartmentManager: roles.includes("department_manager"),
    isSiteAdmin: roles.includes("site_admin"),
    canCreateTasks: roles.some((r) => ["admin", "hr", "data_entry", "site_admin"].includes(r)) && !roles.includes("department_manager"),
    signOut: () => supabase.auth.signOut(),
  };
}
