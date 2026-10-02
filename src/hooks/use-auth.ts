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
  const [profileName, setProfileName] = useState<string | null>(null);
  const [isCompanyManager, setIsCompanyManager] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchRoles = async (uid: string) => {
      setPermissionsLoading(true);
      const [rolesResult, formRolesResult, profileResult] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("form_role_assignments").select("role").eq("user_id", uid).eq("role", "ceo"),
        supabase.from("profiles").select("full_name, allowed_sections").eq("id", uid).maybeSingle(),
      ]);
      if (!mounted) return;
      const failed = !!(rolesResult.error || formRolesResult.error || profileResult.error);
      setPermissionError(failed);
      setRoles(failed ? [] : (rolesResult.data ?? []).map((role: any) => role.role));
      setProfileName(profileResult.data?.full_name?.trim() || null);
      setIsCompanyManager(!failed && (formRolesResult.data ?? []).some((role) => role.role === "ceo"));
      const sections = (profileResult.data as any)?.allowed_sections as string[] | null | undefined;
      setAllowedSections(failed ? [] : sections && sections.length ? sections : null);
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
        setProfileName(null);
        setIsCompanyManager(false);
        setPermissionError(false);
        setPermissionsLoading(false);
      }
    });
    const onProfileNameUpdated = (event: Event) => {
      const name = (event as CustomEvent<string>).detail?.trim();
      if (name) setProfileName(name);
    };
    window.addEventListener("profile-name-updated", onProfileNameUpdated);
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("profile-name-updated", onProfileNameUpdated);
    };
  }, []);

  const isAdmin = roles.includes("admin");
  const isEngineer = roles.includes("engineer") && !isAdmin;
  // null = no restriction. Engineers are limited to planning.
  const sections = permissionError ? [] : isAdmin ? null : isEngineer ? ["/project-plans"] : allowedSections;

  return {
    user,
    roles,
    loading,
    permissionsLoading,
    permissionError,
    isAdmin,
    isEngineer,
    allowedSections: sections,
    canAccessSection: (path: string) => !sections || sections.includes(path) || (path === "/project-plans" && sections.includes("/planning")),
    isCompanyManager,
    isHR: roles.includes("hr") || isAdmin,
    canManageEmployees: roles.some((r) => ["admin", "hr", "data_entry", "department_manager", "site_admin"].includes(r)),
    isDepartmentManager: roles.includes("department_manager"),
    isSiteAdmin: roles.includes("site_admin"),
    profileName,
    canCreateTasks: roles.some((r) => ["admin", "hr", "data_entry", "site_admin"].includes(r)) && !roles.includes("department_manager"),
    signOut: () => supabase.auth.signOut(),
  };
}
