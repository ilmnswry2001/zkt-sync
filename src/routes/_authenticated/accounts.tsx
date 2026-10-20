import { formatErrorMessage } from "@/lib/error-message";
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
import { KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, UserCog, Users, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createAccount,
  deleteAccount,
  updateAccountPassword,
  updateUserDepartments,
} from "@/lib/accounts.functions";
import { SECTION_OPTIONS } from "@/components/AppLayout";

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

type Role =
  | "admin"
  | "hr"
  | "supervisor"
  | "data_entry"
  | "site_admin"
  | "department_manager"
  | "engineer"
  | "planning_officer"
  | "warehouse_keeper"
  | "procurement_officer"
  | "maintenance_manager"
  | "maintenance_admin";
type Profile = { id: string; full_name: string | null; email: string | null; created_at: string; allowed_sections: string[] | null };
type UserRole = { id: string; user_id: string; role: Role };
type Department = { id: string; name: string };
type UserDepartment = { id: string; user_id: string; department_id: string };

const roles: { key: Role; label: string; description: string }[] = [
  {
    key: "admin",
    label: "مدير النظام",
    description: "إدارة الحسابات والصلاحيات وكل إعدادات النظام",
  },
  { key: "hr", label: "الموارد البشرية", description: "الموظفون والأجور والتقارير الإدارية" },
  { key: "supervisor", label: "مشرف", description: "المتابعة والإشراف على التقارير والمهام" },
  { key: "data_entry", label: "مدخل بيانات", description: "إدخال التقارير والمهام المسموحة" },
  { key: "department_manager", label: "مدير قسم", description: "متابعة فريق القسم" },
  { key: "site_admin", label: "إداري موقع", description: "إدارة الموقع ومهامه" },
  { key: "engineer", label: "مهندس", description: "طلب الخطة فقط من قسم التخطيط" },
  { key: "planning_officer", label: "مسؤول تخطيط", description: "مراجعة واعتماد طلبات المواد والمعدات" },
  { key: "warehouse_keeper", label: "مسؤول مخازن", description: "مراجعة الصرف واستلام المشتريات فعلياً" },
  { key: "procurement_officer", label: "مسؤول مشتريات", description: "تسجيل دفعات الشراء وإرسالها للاستلام" },
  {
    key: "maintenance_manager",
    label: "مدير قسم الصيانة",
    description: "إدارة كل أعمال الصيانة والكتالوج والتقارير",
  },
  {
    key: "maintenance_admin",
    label: "إداري / منسق الصيانة",
    description: "تسجيل ومتابعة سجلات الصيانة",
  },
];

function AccountsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "data_entry" as Role,
    departmentIds: [] as string[],
    allowedSections: [] as string[],
  });
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [editingDepartmentIds, setEditingDepartmentIds] = useState<string[]>([]);
  const [editingAllowedSections, setEditingAllowedSections] = useState<string[]>([]);
  const [accountPendingDelete, setAccountPendingDelete] = useState<Profile | null>(null);
  const profilesQuery = useQuery({
    queryKey: ["accounts", "profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, created_at, allowed_sections")
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
  const departmentsQuery = useQuery({
    queryKey: ["accounts", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });
  const userDepartmentsQuery = useQuery({
    queryKey: ["accounts", "user-departments"],
    queryFn: async () => {
      // The generated Lovable types are refreshed after the migration is applied.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as typeof supabase & { from: (table: string) => any };
      const { data, error } = await client
        .from("user_departments")
        .select("id, user_id, department_id");
      if (error) throw error;
      return (data ?? []) as UserDepartment[];
    },
  });
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const userRoles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const departments = departmentsQuery.data ?? [];
  const userDepartments = useMemo(
    () => userDepartmentsQuery.data ?? [],
    [userDepartmentsQuery.data],
  );
  const departmentsByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    userDepartments.forEach((item) =>
      map.set(item.user_id, [...(map.get(item.user_id) ?? []), item.department_id]),
    );
    return map;
  }, [userDepartments]);
  const departmentName = (id: string) =>
    departments.find((department) => department.id === id)?.name ?? id;
  const rolesByUser = useMemo(() => {
    const map = new Map<string, UserRole[]>();
    userRoles.forEach((item) => map.set(item.user_id, [...(map.get(item.user_id) ?? []), item]));
    return map;
  }, [userRoles]);
  const adminCount = userRoles.filter((assignment) => assignment.role === "admin").length;
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
    await Promise.all([
      profilesQuery.refetch(),
      rolesQuery.refetch(),
      departmentsQuery.refetch(),
      userDepartmentsQuery.refetch(),
    ]);
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
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as never });
      if (error) return toast.error(formatErrorMessage(error));
    } else {
      const assignment = rolesByUser.get(userId)?.find((item) => item.role === role);
      if (!assignment) return;
      const { error } = await supabase.from("user_roles").delete().eq("id", assignment.id);
      if (error) return toast.error(formatErrorMessage(error));
    }
    await queryClient.invalidateQueries({ queryKey: ["accounts", "roles"] });
    toast.success("تم تحديث صلاحيات الحساب");
  };
  const handleCreateAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (createForm.password.length < 8)
      return toast.error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    setActionBusy(true);
    try {
      await createAccount({
        data: {
          fullName: createForm.fullName,
          email: createForm.email,
          password: createForm.password,
          role: createForm.role,
          departmentIds: createForm.departmentIds,
          allowedSections: createForm.allowedSections,
        },
      });
      setCreateForm({
        fullName: "",
        email: "",
        password: "",
        role: "data_entry",
        departmentIds: [],
        allowedSections: [],
      });
      setShowCreateForm(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts", "profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts", "roles"] }),
      ]);
      toast.success("تم إنشاء الحساب وتعيين الصلاحية");
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر إنشاء الحساب"));
    } finally {
      setActionBusy(false);
    }
  };
  const handleUpdatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetUserId || resetPassword.length < 8)
      return toast.error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    setActionBusy(true);
    try {
      await updateAccountPassword({
        data: { userId: resetUserId, password: resetPassword },
      });
      setResetUserId(null);
      setResetPassword("");
      toast.success("تم تغيير كلمة المرور. لا يتم عرضها داخل النظام");
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر تغيير كلمة المرور"));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!accountPendingDelete) return;
    setActionBusy(true);
    try {
      await deleteAccount({ data: { userId: accountPendingDelete.id } });
      const deletedName = accountPendingDelete.full_name || accountPendingDelete.email || "الحساب";
      setAccountPendingDelete(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts", "profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts", "roles"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts", "user-departments"] }),
      ]);
      toast.success(`تم حذف حساب ${deletedName}`);
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر حذف الحساب"));
    } finally {
      setActionBusy(false);
    }
  };

  const saveDepartments = async (userId: string) => {
    setActionBusy(true);
    try {
      const allowedSections = hasRole(userId, "engineer") ? ["/project-plans"] : editingAllowedSections;
      await updateUserDepartments({ data: { userId, departmentIds: editingDepartmentIds, allowedSections } });
      await Promise.all([userDepartmentsQuery.refetch(), profilesQuery.refetch()]);
      toast.success("تم تحديث نطاق الوصول والصلاحيات");
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر تحديث الأقسام"));
    } finally {
      setActionBusy(false);
    }
  };

  const loading =
    profilesQuery.isLoading ||
    rolesQuery.isLoading ||
    departmentsQuery.isLoading ||
    userDepartmentsQuery.isLoading;
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
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowCreateForm((value) => !value)}>
            <Plus className="ml-2 h-4 w-4" />
            إضافة حساب
          </Button>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="ml-2 h-4 w-4" />
            )}
            تحديث
          </Button>
        </div>
      </div>

      {showCreateForm && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle>إضافة حساب جديد</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateAccount} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="new-account-name">الاسم الكامل</Label>
                <Input
                  id="new-account-name"
                  required
                  value={createForm.fullName}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, fullName: event.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="new-account-email">البريد الإلكتروني</Label>
                <Input
                  id="new-account-email"
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="new-account-password">كلمة المرور الأولية</Label>
                <Input
                  id="new-account-password"
                  type="password"
                  minLength={8}
                  required
                  value={createForm.password}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  لن تظهر كلمة المرور بعد الحفظ، ويمكن للمدير إعادة تعيينها.
                </p>
              </div>
              <div>
                <Label htmlFor="new-account-role">الصلاحية</Label>
                <select
                  id="new-account-role"
                  className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={createForm.role}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, role: event.target.value as Role }))
                  }
                >
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>
              {createForm.role !== "engineer" && createForm.role !== "admin" && (
                <div className="md:col-span-2">
                  <Label>أقسام النظام المتاحة له (اتركها فارغة لإتاحة الكل)</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border p-3 md:grid-cols-4">
                    {SECTION_OPTIONS.map((section) => (
                      <label key={section.to} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={createForm.allowedSections.includes(section.to)}
                          onCheckedChange={(checked) =>
                            setCreateForm((current) => ({
                              ...current,
                              allowedSections:
                                checked === true
                                  ? [...current.allowedSections, section.to]
                                  : current.allowedSections.filter((s) => s !== section.to),
                            }))
                          }
                        />
                        {section.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {createForm.role === "engineer" && (
                <p className="md:col-span-2 text-sm text-muted-foreground">
                  حساب المهندس يستطيع فقط طلب خطة من قسم التخطيط.
                </p>
              )}
              <div className="md:col-span-2">
                <Label>الأقسام المسموح بها (اتركها فارغة للوصول الكامل)</Label>
                <div className="mt-2 flex flex-wrap gap-2 rounded-lg border p-3">
                  {departments.map((department) => (
                    <label key={department.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={createForm.departmentIds.includes(department.id)}
                        onCheckedChange={(checked) =>
                          setCreateForm((current) => ({
                            ...current,
                            departmentIds:
                              checked === true
                                ? [...current.departmentIds, department.id]
                                : current.departmentIds.filter((id) => id !== department.id),
                          }))
                        }
                      />
                      {department.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" disabled={actionBusy}>
                  {actionBusy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}حفظ الحساب
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                  إلغاء
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

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
                      {(departmentsByUser.get(profile.id) ?? []).length ? (
                        (departmentsByUser.get(profile.id) ?? []).map((id) => (
                          <Badge key={id} variant="outline">
                            {departmentName(id)}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline">كافة الأقسام</Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const opening = editingUserId !== profile.id;
                          setEditingUserId(opening ? profile.id : null);
                          if (opening) {
                            setEditingDepartmentIds(departmentsByUser.get(profile.id) ?? []);
                            setEditingAllowedSections(
                              hasRole(profile.id, "engineer")
                                ? ["/project-plans"]
                                : profile.allowed_sections ?? [],
                            );
                          }
                        }}
                      >
                        {editingUserId === profile.id ? "إغلاق" : "تعديل الصلاحيات"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setResetUserId(resetUserId === profile.id ? null : profile.id);
                          setResetPassword("");
                        }}
                      >
                        <KeyRound className="ml-2 h-4 w-4" /> كلمة مرور جديدة
                      </Button>
                      {user?.id !== profile.id && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={actionBusy || (hasRole(profile.id, "admin") && adminCount <= 1)}
                          title={hasRole(profile.id, "admin") && adminCount <= 1 ? "لا يمكن حذف المدير الوحيد" : "حذف الحساب نهائياً"}
                          onClick={() => setAccountPendingDelete(profile)}
                        >
                          <Trash2 className="ml-2 h-4 w-4" /> حذف الحساب
                        </Button>
                      )}
                    </div>
                  </div>
                  {resetUserId === profile.id && (
                    <form
                      onSubmit={handleUpdatePassword}
                      className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end"
                    >
                      <div className="flex-1">
                        <Label htmlFor={`reset-password-${profile.id}`}>كلمة المرور الجديدة</Label>
                        <Input
                          id={`reset-password-${profile.id}`}
                          type="password"
                          minLength={8}
                          required
                          value={resetPassword}
                          onChange={(event) => setResetPassword(event.target.value)}
                        />
                      </div>
                      <Button type="submit" disabled={actionBusy}>
                        {actionBusy ? "جارٍ الحفظ..." : "تأكيد التغيير"}
                      </Button>
                    </form>
                  )}
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
                      <div className="md:col-span-2 rounded-xl border bg-muted/20 p-4">
                        <p className="mb-2 font-medium">الأقسام المصرح بها (فارغ = كافة الأقسام)</p>
                        <div className="flex flex-wrap gap-2">
                          {departments.map((department) => (
                            <label key={department.id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={editingDepartmentIds.includes(department.id)}
                                onCheckedChange={(checked) =>
                                  setEditingDepartmentIds((current) =>
                                    checked === true
                                      ? [...new Set([...current, department.id])]
                                      : current.filter((id) => id !== department.id),
                                  )
                                }
                              />
                              {department.name}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="md:col-span-2 rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
                        <div className="mb-3">
                          <p className="font-semibold">صفحات النظام المسموح بها</p>
                          <p className="text-xs text-muted-foreground">اختر نطاق بيانات الأقسام والواجهات التي تظهر للحساب. ترك الصفحات فارغة يتيح الصفحات المسموحة بحسب الدور.</p>
                        </div>
                        <p className="mb-2 text-sm font-medium">صفحات النظام</p>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {SECTION_OPTIONS.map((section) => (
                            <label key={section.to} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background p-2.5 text-sm">
                              <Checkbox
                                disabled={hasRole(profile.id, "engineer")}
                                checked={editingAllowedSections.includes(section.to)}
                                onCheckedChange={(checked) => setEditingAllowedSections((current) =>
                                  checked === true
                                    ? [...new Set([...current, section.to])]
                                    : current.filter((path) => path !== section.to),
                                )}
                              />
                              {section.label}
                            </label>
                          ))}
                        </div>
                        {hasRole(profile.id, "engineer") && <p className="mt-2 text-xs text-muted-foreground">حساب المهندس مقيد تلقائياً بواجهة خطط المشاريع.</p>}
                        <Button className="mt-4" size="sm" disabled={actionBusy} onClick={() => saveDepartments(profile.id)}>
                          <Save className="ml-2 h-4 w-4" /> حفظ الأقسام والصفحات
                        </Button>
                      </div>
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
      <AlertDialog
        open={!!accountPendingDelete}
        onOpenChange={(open) => {
          if (!open && !actionBusy) setAccountPendingDelete(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> تأكيد حذف الحساب
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-right">
              <span className="block">
                سيتم حذف حساب <strong className="text-foreground">{accountPendingDelete?.full_name || "بدون اسم"}</strong>
                {accountPendingDelete?.email ? ` (${accountPendingDelete.email})` : ""} نهائياً ومنعه من تسجيل الدخول.
              </span>
              <span className="block">لا يمكن التراجع عن هذا الإجراء. إذا كانت للحساب سجلات تاريخية محمية، سيمنع النظام الحذف ويعرض السبب.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>إلغاء</AlertDialogCancel>
            <Button variant="destructive" disabled={actionBusy} onClick={handleDeleteAccount}>
              {actionBusy ? <><Loader2 className="ml-2 h-4 w-4 animate-spin" /> جارٍ الحذف...</> : <><Trash2 className="ml-2 h-4 w-4" /> حذف نهائي</>}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
