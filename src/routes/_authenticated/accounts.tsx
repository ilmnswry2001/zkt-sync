import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, RefreshCw, ShieldCheck, UserCog, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "الحسابات والصلاحيات" }] }),
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (!data?.some((role) => role.role === "admin")) throw redirect({ to: "/dashboard" });
  },
  component: AccountsPage,
});

type Role = "admin" | "hr" | "supervisor" | "data_entry";
type Profile = { id: string; full_name: string | null; email: string | null; created_at: string };
type UserRole = { id: string; user_id: string; role: Role };

const roles: { key: Role; label: string; description: string }[] = [
  {
    key: "admin",
    label: "مدير النظام",
    description: "إدارة الحسابات والصلاحيات وكل إعدادات النظام",
  },
  { key: "hr", label: "الموارد البشرية", description: "الموظفون والأجور والتقارير الإدارية" },
  { key: "supervisor", label: "مشرف", description: "المتابعة والإشراف على التقارير والمهام" },
  { key: "data_entry", label: "مدخل بيانات", description: "إدخال التقارير والمهام المسموحة" },
];

function AccountsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const profilesQuery = useQuery({
    queryKey: ["accounts", "profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
  const rolesQuery = useQuery({
    queryKey: ["accounts", "roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, user_id, role")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as UserRole[];
    },
  });
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const userRoles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const rolesByUser = useMemo(() => {
    const map = new Map<string, UserRole[]>();
    userRoles.forEach((item) => map.set(item.user_id, [...(map.get(item.user_id) ?? []), item]));
    return map;
  }, [userRoles]);
  const filteredProfiles = useMemo(() => {
    const value = search.trim().toLocaleLowerCase();
    if (!value) return profiles;
    return profiles.filter((profile) =>
      [profile.full_name, profile.email].some((field) =>
        field?.toLocaleLowerCase().includes(value),
      ),
    );
  }, [profiles, search]);

  const refresh = async () => {
    await Promise.all([profilesQuery.refetch(), rolesQuery.refetch()]);
    toast.success("تم تحديث الحسابات والصلاحيات");
  };
  const hasRole = (userId: string, role: Role) =>
    rolesByUser.get(userId)?.some((item) => item.role === role) ?? false;
  const toggleRole = async (userId: string, role: Role, enabled: boolean) => {
    if (
      role === "admin" &&
      !enabled &&
      rolesByUser.get(userId)?.filter((item) => item.role === "admin").length === 1
    ) {
      const adminCount = profiles.filter((profile) => hasRole(profile.id, "admin")).length;
      if (adminCount <= 1) return toast.error("لا يمكن إزالة صلاحية المدير الوحيد في النظام");
    }
    if (enabled) {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) return toast.error(error.message);
    } else {
      const assignment = rolesByUser.get(userId)?.find((item) => item.role === role);
      if (!assignment) return;
      const { error } = await supabase.from("user_roles").delete().eq("id", assignment.id);
      if (error) return toast.error(error.message);
    }
    await queryClient.invalidateQueries({ queryKey: ["accounts", "roles"] });
    toast.success("تم تحديث صلاحيات الحساب");
  };

  const loading = profilesQuery.isLoading || rolesQuery.isLoading;
  const error = profilesQuery.error ?? rolesQuery.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <UserCog className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-bold">الحسابات والصلاحيات</h1>
          </div>
          <p className="mt-1 text-muted-foreground">إدارة أدوار الحسابات المسجلة في النظام.</p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          {loading ? (
            <Loader2 className="ml-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="ml-2 h-4 w-4" />
          )}
          تحديث
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">الحسابات</p>
              <p className="text-xl font-bold">{profiles.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <div>
              <p className="text-xs text-muted-foreground">المديرون</p>
              <p className="text-xl font-bold">
                {profiles.filter((profile) => hasRole(profile.id, "admin")).length}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-xs text-muted-foreground">الموارد البشرية</p>
              <p className="text-xl font-bold">
                {profiles.filter((profile) => hasRole(profile.id, "hr")).length}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            <div>
              <p className="text-xs text-muted-foreground">مدخلو البيانات</p>
              <p className="text-xl font-bold">
                {profiles.filter((profile) => hasRole(profile.id, "data_entry")).length}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الحسابات المسجلة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="account-search">بحث بالاسم أو البريد الإلكتروني</Label>
            <Input
              id="account-search"
              className="mt-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث هنا..."
            />
          </div>
          {error && (
            <p className="rounded-lg border border-destructive/40 p-3 text-destructive">
              تعذر تحميل الحسابات: {(error as Error).message}
            </p>
          )}
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">جارٍ تحميل الحسابات...</p>
          ) : (
            <div className="space-y-3">
              {filteredProfiles.map((profile) => (
                <div key={profile.id} className="rounded-xl border p-4">
                  <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                    <div className="min-w-0">
                      <p className="font-semibold">{profile.full_name || "بدون اسم"}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {profile.email || profile.id}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(rolesByUser.get(profile.id) ?? []).map((assignment) => (
                        <Badge
                          key={assignment.id}
                          variant={assignment.role === "admin" ? "default" : "secondary"}
                        >
                          {roles.find((role) => role.key === assignment.role)?.label ??
                            assignment.role}
                        </Badge>
                      ))}
                      {!rolesByUser.has(profile.id) && <Badge variant="outline">بدون صلاحية</Badge>}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditingUserId(editingUserId === profile.id ? null : profile.id)
                        }
                      >
                        {editingUserId === profile.id ? "إغلاق" : "تعديل الصلاحيات"}
                      </Button>
                    </div>
                  </div>
                  {editingUserId === profile.id && (
                    <div className="mt-4 grid grid-cols-1 gap-3 border-t pt-4 md:grid-cols-2">
                      {roles.map((role) => (
                        <label
                          key={role.key}
                          className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={hasRole(profile.id, role.key)}
                            onCheckedChange={(checked) =>
                              toggleRole(profile.id, role.key, checked === true)
                            }
                          />
                          <span>
                            <span className="block font-medium">{role.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {role.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {!filteredProfiles.length && (
                <p className="py-8 text-center text-muted-foreground">لا توجد حسابات مطابقة.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
