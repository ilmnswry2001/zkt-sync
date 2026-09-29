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
import { KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, UserCog, Users, Save } from "lucide-react";
import { toast } from "sonner";
import { createAccount, updateAccountPassword, updateUserDepartments } from "@/lib/accounts.functions";
import { permissionsDb, type UserDepartment } from "@/lib/permissions-client";

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

type Role = "admin" | "hr" | "supervisor" | "data_entry" | "site_admin" | "department_manager";
type Profile = { id: string; full_name: string | null; email: string | null; created_at: string; employee_id?: string | null };
type UserRole = { id: string; user_id: string; role: Role };
type Department = { id: string; name: string };
type DepartmentManager = { id: string; user_id: string; department_id: string; created_at: string };
type EmployeeOption = { id: string; full_name: string; employee_no: string; status: string; department_id: string | null };

const roles: { key: Role; label: string; description: string }[] = [
  {
    key: "admin",
    label: "مدير النظام",
    description: "إدارة الحسابات والصلاحيات وكل إعدادات النظام",
  },
  { key: "hr", label: "الموارد البشرية", description: "الموظفون والأجور والتقارير الإدارية" },
  { key: "supervisor", label: "مشرف", description: "المتابعة والإشراف على التقارير والمهام" },
  { key: "data_entry", label: "مدخل بيانات", description: "إدخال التقارير والمهام المسموحة" },
  { key: "site_admin", label: "إداري موقع", description: "رفع تقارير الموقع والنوافذ التي يحددها المدير" },
  { key: "department_manager", label: "مدير إدارة", description: "متابعة فريق الأقسام المخصصة له" },
];

function AccountsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "data_entry" as Role,
    employeeId: "",
    managedDepartmentId: "",
  });
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [editingDepartmentManager, setEditingDepartmentManager] = useState<Record<string, string>>({});
  const [editingDepartments, setEditingDepartments] = useState<Record<string, string[]>>({});
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
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
  const departmentsQuery = useQuery({
    queryKey: ["accounts", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });
  const employeesQuery = useQuery({
    queryKey: ["accounts", "employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, employee_no, status, department_id")
        .eq("status", "active")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EmployeeOption[];
    },
  });
  const userDepartmentsQuery = useQuery({
    queryKey: ["accounts", "user-departments"],
    queryFn: async () => {
      const { data, error } = await permissionsDb.from("user_departments").select("id, user_id, department_id, created_at");
      if (error) throw error;
      return (data ?? []) as UserDepartment[];
    },
  });
  const departmentManagersQuery = useQuery({
    queryKey: ["accounts", "department-managers"],
    queryFn: async () => {
      const { data, error } = await permissionsDb
        .from("department_managers")
        .select("id, user_id, department_id, created_at");
      if (error) throw error;
      return (data ?? []) as DepartmentManager[];
    },
  });
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const userRoles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const departments = departmentsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const userDepartments = userDepartmentsQuery.data ?? [];
  const departmentManagers = departmentManagersQuery.data ?? [];
  const departmentIdsByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    userDepartments.forEach((item) => map.set(item.user_id, [...(map.get(item.user_id) ?? []), item.department_id]));
    return map;
  }, [userDepartments]);
  const departmentManagerByUser = useMemo(() => {
    const map = new Map<string, string>();
    departmentManagers.forEach((item) => {
      if (!map.has(item.user_id)) map.set(item.user_id, item.department_id);
    });
    return map;
  }, [departmentManagers]);
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
    await Promise.all([
      profilesQuery.refetch(),
      rolesQuery.refetch(),
      departmentsQuery.refetch(),
      userDepartmentsQuery.refetch(),
      departmentManagersQuery.refetch(),
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
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role } as never);
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
  const saveDepartments = async (userId: string) => {
    try {
      await updateUserDepartments({
        data: { userId, departmentIds: editingDepartments[userId] ?? [] },
      });
      await userDepartmentsQuery.refetch();
      toast.success("تم حفظ أقسام الوصول للحساب");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ أقسام الوصول");
    }
  };
  const saveDepartmentManager = async (userId: string) => {
    const selectedDepartmentId = editingDepartmentManager[userId] ?? departmentManagerByUser.get(userId) ?? "";
    try {
      const existingAssignment = departmentManagers.find((item) => item.user_id === userId);
      if (selectedDepartmentId) {
        if (existingAssignment) {
          const { error } = await permissionsDb
            .from("department_managers")
            .update({ department_id: selectedDepartmentId })
            .eq("id", existingAssignment.id);
          if (error) throw error;
        } else {
          const { error } = await permissionsDb
            .from("department_managers")
            .insert({ user_id: userId, department_id: selectedDepartmentId });
          if (error) throw error;
        }
      } else if (existingAssignment) {
        const { error } = await permissionsDb.from("department_managers").delete().eq("id", existingAssignment.id);
        if (error) throw error;
      }
      await departmentManagersQuery.refetch();
      toast.success("تم حفظ القسم الذي يديره الحساب");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ القسم");
    }
  };
  const handleCreateAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (createForm.password.length < 8)
      return toast.error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    if (createForm.role === "department_manager" && !createForm.managedDepartmentId) {
      return toast.error("اختر القسم الذي سيُدار من خلال هذا الحساب");
    }
    setActionBusy(true);
    try {
      await createAccount({
        data: {
          fullName: createForm.fullName,
          email: createForm.email,
          password: createForm.password,
          role: createForm.role,
          employeeId: createForm.employeeId || null,
          managedDepartmentId: createForm.role === "department_manager" ? createForm.managedDepartmentId : null,
          departmentIds,
        },
      });
      setCreateForm({ fullName: "", email: "", password: "", role: "data_entry", employeeId: "", managedDepartmentId: "" });
      setDepartmentIds([]);
      setShowCreateForm(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts", "profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts", "roles"] }),
      ]);
      toast.success("تم إنشاء الحساب وتعيين الصلاحية");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إنشاء الحساب");
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
      toast.error(error instanceof Error ? error.message : "تعذر تغيير كلمة المرور");
    } finally {
      setActionBusy(false);
    }
  };

  const loading =
    profilesQuery.isLoading ||
    rolesQuery.isLoading ||
    departmentsQuery.isLoading ||
    employeesQuery.isLoading ||
    userDepartmentsQuery.isLoading ||
    departmentManagersQuery.isLoading;
  const error =
    profilesQuery.error ??
    rolesQuery.error ??
    departmentsQuery.error ??
    employeesQuery.error ??
    userDepartmentsQuery.error ??
    departmentManagersQuery.error;

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
              <div>
                <Label htmlFor="new-account-employee">الموظف المرتبط بالحساب</Label>
                <select
                  id="new-account-employee"
                  className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={createForm.employeeId}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, employeeId: event.target.value }))
                  }
                >
                  <option value="">لا يوجد موظف مرتبط</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name} — {employee.employee_no}
                    </option>
                  ))}
                </select>
              </div>
              {createForm.role === "department_manager" && (
                <div className="md:col-span-2">
                  <Label htmlFor="new-account-managed-department">القسم الذي يديره هذا الحساب</Label>
                  <select
                    id="new-account-managed-department"
                    className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={createForm.managedDepartmentId}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, managedDepartmentId: event.target.value }))
                    }
                  >
                    <option value="">اختر القسم</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="rounded-lg border p-3 md:col-span-2">
                <Label>الأقسام المسموحة لهذا الحساب</Label>
                <p className="mb-2 text-xs text-muted-foreground">اختر أقسام النظام التي يمكن لهذا الحساب الدخول إليها، أو اتركها فارغة في حال السماح الكامل حسب الدور.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {departments.map((department) => (
                    <label key={department.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={departmentIds.includes(department.id)}
                        onCheckedChange={(checked) => setDepartmentIds((current) => checked === true
                          ? [...new Set([...current, department.id])]
                          : current.filter((id) => id !== department.id))}
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditingUserId(editingUserId === profile.id ? null : profile.id)
                        }
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
                      {hasRole(profile.id, "department_manager") && (
                        <div className="rounded-lg border p-3 md:col-span-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div>
                              <p className="font-medium">القسم الذي يديره هذا الحساب</p>
                              <p className="text-xs text-muted-foreground">يحدد القسم الخاص الذي يتبع له مدير القسم.</p>
                            </div>
                            <Button size="sm" onClick={() => void saveDepartmentManager(profile.id)}>
                              <Save className="ml-2 h-4 w-4" /> حفظ القسم
                            </Button>
                          </div>
                          <select
                            className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                            value={editingDepartmentManager[profile.id] ?? departmentManagerByUser.get(profile.id) ?? ""}
                            onChange={(event) =>
                              setEditingDepartmentManager((current) => ({
                                ...current,
                                [profile.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">اختر القسم</option>
                            {departments.map((department) => (
                              <option key={department.id} value={department.id}>
                                {department.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="rounded-lg border p-3 md:col-span-2">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">الأقسام المسموحة</p>
                            <p className="text-xs text-muted-foreground">تُطبق على متابعة الفريق ومهام الفريق والتقارير المرتبطة بالموظفين.</p>
                          </div>
                          <Button size="sm" onClick={() => void saveDepartments(profile.id)}>
                            <Save className="ml-2 h-4 w-4" /> حفظ الأقسام
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {departments.map((department) => {
                            const selected = (editingDepartments[profile.id] ?? departmentIdsByUser.get(profile.id) ?? []).includes(department.id);
                            return (
                              <label key={department.id} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={selected}
                                  onCheckedChange={(checked) => setEditingDepartments((current) => {
                                    const ids = current[profile.id] ?? departmentIdsByUser.get(profile.id) ?? [];
                                    return { ...current, [profile.id]: checked === true ? [...new Set([...ids, department.id])] : ids.filter((id) => id !== department.id) };
                                  })}
                                />
                                {department.name}
                              </label>
                            );
                          })}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(departmentIdsByUser.get(profile.id) ?? []).map((id) => <Badge key={id} variant="outline">{departments.find((department) => department.id === id)?.name ?? id}</Badge>)}
                          {!departmentIdsByUser.get(profile.id)?.length && <Badge variant="secondary">وصول عام حسب الدور</Badge>}
                        </div>
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
    </div>
  );
}
