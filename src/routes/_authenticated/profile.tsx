import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserCircle2, Mail, ShieldCheck, BriefcaseBusiness } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "الملف الشخصي" }] }),
  component: ProfilePage,
});

type ProfileRecord = {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at: string | null;
  employee_id?: string | null;
};

type EmployeeLink = {
  id: string;
  employee_no: string;
  full_name: string;
  position: string | null;
  department_id: string | null;
  departments?: { name: string | null } | null;
};

function ProfilePage() {
  const queryClient = useQueryClient();
  const { user, roles } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, employee_id, created_at")
        .eq("id", user!.id)
        .maybeSingle();

      if (error) throw error;
      return (data ?? {
        id: user!.id,
        full_name: user?.user_metadata?.full_name ?? user?.email ?? "",
        email: user?.email ?? null,
        created_at: new Date().toISOString(),
        employee_id: null,
      }) as ProfileRecord;
    },
  });

  useEffect(() => {
    if (!profileQuery.data) return;
    setFullName(profileQuery.data.full_name ?? user?.user_metadata?.full_name ?? user?.email ?? "");
    setEmail(profileQuery.data.email ?? user?.email ?? "");
  }, [profileQuery.data, user?.email, user?.user_metadata]);

  const linkedEmployeeQuery = useQuery({
    queryKey: ["profile-employee", profileQuery.data?.employee_id],
    enabled: !!profileQuery.data?.employee_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name, position, department_id, departments(name)")
        .eq("id", profileQuery.data!.employee_id!)
        .maybeSingle();

      if (error) throw error;
      return (data ?? null) as EmployeeLink | null;
    },
  });

  const profileMutation = useMutation({
    mutationFn: async () => {
      const nextName = fullName.trim();
      const nextEmail = email.trim();
      if (!user) throw new Error("لم يتم العثور على حساب مسجل");
      if (!nextName) throw new Error("الاسم الكامل مطلوب");

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: nextName,
          email: nextEmail || user.email || null,
        })
        .eq("id", user.id);

      if (profileError) throw profileError;

      const { error: authError } = await supabase.auth.updateUser({
        email: nextEmail || undefined,
        data: { full_name: nextName },
      });

      if (authError) throw authError;
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      await queryClient.invalidateQueries({ queryKey: ["profile-employee"] });
    },
    onSuccess: () => {
      toast.success("تم حفظ بيانات الملف الشخصي");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "تعذر حفظ الملف الشخصي";
      toast.error(message);
    },
  });

  const roleBadges = useMemo(() => roles.length ? roles : ["لا توجد صلاحيات"], [roles]);

  if (!user || profileQuery.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل الملف الشخصي...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">الملف الشخصي</h1>
          <p className="mt-1 text-muted-foreground">عرض وتحديث بيانات الحساب العام الخاص بك</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm">
          <UserCircle2 className="h-4 w-4 text-primary" />
          {user.email}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>بيانات الحساب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-full-name">الاسم الكامل</Label>
              <Input id="profile-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-email">البريد الإلكتروني</Label>
              <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {roleBadges.map((role) => (
                <Badge key={role} variant="secondary" className="gap-1">
                  <ShieldCheck className="h-3 w-3" /> {role}
                </Badge>
              ))}
            </div>

            <Button className="w-full" onClick={() => profileMutation.mutate()} disabled={profileMutation.isPending}>
              {profileMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <UserCircle2 className="h-4 w-4 ml-2" />}
              حفظ التغييرات
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>معلومات الحساب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4" /> البريد الإلكتروني
              </div>
              <p className="mt-2 font-medium">{user.email ?? "—"}</p>
            </div>

            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BriefcaseBusiness className="h-4 w-4" /> الموظف المرتبط
              </div>
              {linkedEmployeeQuery.isLoading ? (
                <p className="mt-2 text-muted-foreground">جارٍ التحميل...</p>
              ) : linkedEmployeeQuery.data ? (
                <div className="mt-2 space-y-1">
                  <p className="font-medium">{linkedEmployeeQuery.data.full_name}</p>
                  <p className="text-sm text-muted-foreground">{linkedEmployeeQuery.data.employee_no}</p>
                  <p className="text-sm text-muted-foreground">
                    {linkedEmployeeQuery.data.position ?? "بدون منصب"}
                    {linkedEmployeeQuery.data.departments?.name ? ` · ${linkedEmployeeQuery.data.departments.name}` : ""}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground">لا يوجد موظف مرتبط بحسابك.</p>
              )}
            </div>

            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" /> الصلاحيات
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {roles.length ? roles.map((role) => (
                  <Badge key={role} variant="outline">{role}</Badge>
                )) : <Badge variant="secondary">لا توجد صلاحيات</Badge>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
