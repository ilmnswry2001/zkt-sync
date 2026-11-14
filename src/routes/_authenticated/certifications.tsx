import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { certificationDb as db, loadCenter } from "@/lib/certification-center";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StatCard } from "@/components/CertificationStatCard";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Award,
  BellRing,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Funnel,
  GraduationCap,
  Search,
  ShieldCheck,
  TicketCheck,
  UserRound,
} from "lucide-react";

const statusTone: Record<string, string> = {
  active: "bg-emerald-600 text-white hover:bg-emerald-600",
  expiring_soon: "bg-amber-500 text-white hover:bg-amber-500",
  expired: "bg-rose-600 text-white hover:bg-rose-600",
  pending_approval: "bg-slate-500 text-white hover:bg-slate-500",
  approved: "bg-blue-600 text-white hover:bg-blue-600",
  rejected: "bg-red-600 text-white hover:bg-red-600",
  completed: "bg-emerald-700 text-white hover:bg-emerald-700",
};

const statusLabel: Record<string, string> = {
  active: "سارية",
  expiring_soon: "قريبة من الانتهاء",
  expired: "منتهية",
  pending_approval: "قيد الاعتماد",
  approved: "موافق عليه",
  rejected: "مرفوض",
  completed: "مكتمل",
};

export const Route = createFileRoute("/_authenticated/certifications")({
  head: () => ({
    meta: [
      { title: "الشهادات والدورات — مركز التدريب والتأهيل" },
      {
        name: "description",
        content: "إدارة الشهادات والدورات التدريبية وطلبات الاعتماد.",
      },
    ],
  }),
  component: CertificationsPage,
});

function CertificationsPage() {
  const { user, isHR, isCompanyManager } = useAuth();
  const canManage = isHR || isCompanyManager;
  const center = useQuery({
    queryKey: ["certification-center", user?.id],
    queryFn: loadCenter,
    enabled: !!user,
  });
  const {
    certifications = [],
    requests = [],
    courses = [],
    departments = [],
  } = center.data ?? {};
  const profile = useQuery({
    queryKey: ["certification-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("profiles")
        .select("employee_id")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.employee_id as string | null;
    },
  });
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [employeeLabel, setEmployeeLabel] = useState("");
  const people = useQuery({
    queryKey: ["training-employees", user?.id, term],
    enabled: !!user && !!term.trim(),
    queryFn: async () => {
      const pattern = '"%' + term.trim().replace(/["\\%_*]/g, " ") + '%"';
      const { data, error } = await supabase
        .from("employees")
        .select("id,full_name,employee_no,department_name,departments(name)")
        .eq("status", "active")
        .or("full_name.ilike." + pattern + ",employee_no.ilike." + pattern)
        .order("full_name")
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [requestType, setRequestType] = useState<"new" | "renewal">("new");
  const [approver, setApprover] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [completion, setCompletion] = useState({
    certificateNo: "",
    issueDate: "",
    expiryDate: "",
    renewalDate: "",
    attachmentUrl: "",
  });

  const certificationStats = useMemo(() => {
    const total = certifications.length;
    const active = certifications.filter((row) => row.status === "active").length;
    const expired = certifications.filter((row) => row.status === "expired").length;
    const expiringSoon = certifications.filter((row) => row.status === "expiring_soon").length;
    const inProgress = requests.filter(
      (row) => row.status === "approved" || row.status === "pending_approval",
    ).length;
    return { total, active, expired, expiringSoon, inProgress };
  }, [certifications, requests]);

  const filteredCertifications = useMemo(() => {
    return certifications.filter((row) => {
      const matchesEmployee =
        row.employee_name.toLowerCase().includes(search.toLowerCase()) ||
        row.employee_no.toLowerCase().includes(search.toLowerCase());
      const matchesDepartment = departmentFilter === "all" || row.department === departmentFilter;
      const matchesSpecialty = specialtyFilter === "all" || row.specialty === specialtyFilter;
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      return matchesEmployee && matchesDepartment && matchesSpecialty && matchesStatus;
    });
  }, [certifications, departmentFilter, search, specialtyFilter, statusFilter]);

  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ?? null;

  const assigned = departments.filter((d) => d.manager_user_id);
  async function save(
    action: () => PromiseLike<{ error: { message: string } | null }>,
    after?: () => void,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await action();
      if (error) throw Error(error.message);
      after?.();
      await center.refetch();
      toast.success("تم الحفظ");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  }
  function handleCreateRequest(e: FormEvent) {
    e.preventDefault();
    if (!selectedEmployee || !selectedCourse || !approver)
      return toast.error("اختر الموظف والدورة وجهة الاعتماد");
    void save(
      () =>
        db
          .from("training_requests")
          .insert({
            employee_id: selectedEmployee,
            course_type_id: selectedCourse,
            target_department_id: approver,
            request_type: requestType,
            notes: requestNote,
            requested_by: user?.id,
          }),
      () => {
        setRequestNote("");
        setSelectedEmployee("");
        setEmployeeLabel("");
        setTerm("");
      },
    );
  }
  function handleDecision(id: string, decision: string, note: string) {
    void save(() =>
      db
        .from("training_requests")
        .update({
          status: decision === "approve" ? "approved" : "rejected",
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          rejection_reason: decision === "reject" ? note : null,
        })
        .eq("id", id)
        .eq("status", "pending_approval")
        .select("id")
        .single(),
    );
  }
  function handleCompletion(e: FormEvent) {
    e.preventDefault();
    if (!selectedRequest) return;
    void save(
      () =>
        db.rpc("complete_training_request", {
          p_request: selectedRequest.id,
          p_number: completion.certificateNo,
          p_issue: completion.renewalDate || completion.issueDate,
          p_expiry: completion.expiryDate,
          p_renewal: completion.renewalDate || null,
          p_attachment: completion.attachmentUrl || null,
        }),
      () => setSelectedRequestId(""),
    );
  }
  if (center.error)
    return (
      <Card dir="rtl" className="p-6">
        تعذر تحميل مركز الشهادات · {center.error.message}{" "}
        <Button onClick={() => center.refetch()}>إعادة المحاولة</Button>
      </Card>
    );
  if (!center.data)
    return (
      <p dir="rtl" className="p-6">
        جارٍ تحميل مركز الشهادات…
      </p>
    );

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">إدارة الموارد البشرية والتأهيل</p>
          <h1 className="text-3xl font-bold">الشهادات والدورات</h1>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="grid rounded-none h-auto w-full grid-cols-2 gap-2 bg-transparent md:grid-cols-4">
          <TabsTrigger
            className="rounded-none border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            value="overview"
          >
            سجل الشهادات
          </TabsTrigger>
          <TabsTrigger
            className="rounded-none border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            value="request"
          >
            طلب دورة
          </TabsTrigger>
          <TabsTrigger
            className="rounded-none border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            value="approvals"
          >
            الطلبات المحالة
          </TabsTrigger>
          <TabsTrigger
            className="rounded-none border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            value="settings"
          >
            الإعدادات
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <StatCard
              title="إجمالي الشهادات"
              value={certificationStats.total}
              icon={Award}
              tone="bg-primary"
            />
            <StatCard
              title="السارية"
              value={certificationStats.active}
              icon={CheckCircle2}
              tone="bg-emerald-600"
            />
            <StatCard
              title="المنتهية"
              value={certificationStats.expired}
              icon={ShieldCheck}
              tone="bg-rose-600"
            />
            <StatCard
              title="قريبة من الانتهاء"
              value={certificationStats.expiringSoon}
              icon={Clock3}
              tone="bg-amber-500"
            />
            <StatCard
              title="الدورات الجارية"
              value={certificationStats.inProgress}
              icon={GraduationCap}
              tone="bg-indigo-600"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Funnel className="h-4 w-4" /> المرشحات
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-5">
              <div className="space-y-2 md:col-span-2">
                <Label>بحث</Label>
                <div className="relative">
                  <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="اسم الموظف أو الرقم"
                    className="pr-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>القسم</Label>
                <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {Array.from(new Set(certifications.map((c) => c.department))).map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>التخصص</Label>
                <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {Array.from(new Set(certifications.map((c) => c.specialty))).map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>الحالة</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="active">سارية</SelectItem>
                    <SelectItem value="expiring_soon">قريبة من الانتهاء</SelectItem>
                    <SelectItem value="expired">منتهية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>جدول الشهادات</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>الرقم</TableHead>
                    <TableHead>نوع الدورة</TableHead>
                    <TableHead>تاريخ الإصدار</TableHead>
                    <TableHead>تاريخ الانتهاء</TableHead>
                    <TableHead>الأيام المتبقية</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>المرفق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCertifications.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div>
                          <p className="font-semibold">{row.employee_name}</p>
                          <p className="text-xs text-muted-foreground">{row.department}</p>
                        </div>
                      </TableCell>
                      <TableCell>{row.employee_no}</TableCell>
                      <TableCell>{row.course_type}</TableCell>
                      <TableCell>{row.issue_date}</TableCell>
                      <TableCell>{row.expiry_date}</TableCell>
                      <TableCell>
                        {row.days_remaining === null
                          ? "—"
                          : row.days_remaining > 0
                            ? `${row.days_remaining} يوم`
                            : `${Math.abs(row.days_remaining)} يوم متأخرة`}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusTone[row.status]}>{statusLabel[row.status]}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !row.attachment_url || !/^https?:\/\//i.test(row.attachment_url)
                          }
                          onClick={() =>
                            window.open(row.attachment_url ?? "", "_blank", "noopener,noreferrer")
                          }
                        >
                          معاينة
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!filteredCertifications.length && (
                    <TableRow>
                      <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                        لا توجد شهادات مطابقة للفلتر الحالي.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="request" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4" /> طلب دورة تدريبية
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateRequest}>
                <div className="space-y-2">
                  <Label>الموظف</Label>
                  <Input
                    aria-label="بحث الموظفين"
                    placeholder="ابحث بالاسم أو الرقم الوظيفي"
                    value={term}
                    onChange={(e) => {
                      setTerm(e.target.value);
                      setSelectedEmployee("");
                      setEmployeeLabel("");
                    }}
                  />
                  {!selectedEmployee && term && (
                    <div className="max-h-52 overflow-auto">
                      {people.isFetching
                        ? "جارٍ البحث…"
                        : people.error
                          ? "تعذر البحث"
                          : !people.data?.length
                            ? "لا توجد نتائج"
                            : people.data.map((p) => {
                                const label = [
                                  p.full_name,
                                  p.employee_no,
                                  p.departments?.name ?? p.department_name,
                                ]
                                  .filter(Boolean)
                                  .join(" · ");
                                return (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    key={p.id}
                                    className="block"
                                    onClick={() => {
                                      setSelectedEmployee(p.id);
                                      setEmployeeLabel(label);
                                      setTerm("");
                                    }}
                                  >
                                    {label}
                                  </Button>
                                );
                              })}
                    </div>
                  )}
                  {employeeLabel}
                </div>

                <div className="space-y-2">
                  <Label>نوع الدورة</Label>
                  <Select value={selectedCourse} onValueChange={setSelectedCourse}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الدورة" />
                    </SelectTrigger>
                    <SelectContent>
                      {courses
                        .filter((c) => c.is_active)
                        .map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.name_ar}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>نوع الطلب</Label>
                  <Select
                    value={requestType}
                    onValueChange={(value) => setRequestType(value as "new" | "renewal")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">جديد</SelectItem>
                      <SelectItem value="renewal">تجديد</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>جهة الاعتماد</Label>
                  <Select value={approver} onValueChange={setApprover}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assigned.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>ملاحظات الطلب</Label>
                  <Textarea
                    value={requestNote}
                    onChange={(e) => setRequestNote(e.target.value)}
                    rows={4}
                    placeholder="أدخل تفاصيل الطلب أو سبب التحديث"
                  />
                </div>

                <Button
                  disabled={busy || !selectedEmployee || !approver || !selectedCourse}
                  className="w-full"
                  type="submit"
                >
                  <BellRing className="ml-2 h-4 w-4" />
                  إرسال الطلب
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ملخص المراجعة السريعة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-xl bg-muted/30 p-3">
                <p className="font-semibold text-foreground">معلومات الطلب</p>
                <p className="mt-2">العضو: {employeeLabel}</p>
                <p>الدورة: {courses.find((course) => course.id === selectedCourse)?.name_ar}</p>
                <p>نوع الطلب: {requestType === "new" ? "جديد" : "تجديد"}</p>
                <p>جهة الاعتماد: {departments.find((d) => d.id === approver)?.name}</p>
              </div>
              <div className="rounded-xl border border-dashed p-3">
                <p className="font-medium text-foreground">التدفق المتاح</p>
                <ul className="mt-2 list-inside list-disc space-y-1">
                  <li>إرسال الطلب إلى الجهة المختصة بحالة pending_approval.</li>
                  <li>تفعيل الموافقة من قبل مدير القسم أو مسؤول التدريب.</li>
                  <li>تحديث السجل بعد إكمال الدورة وتسجيل الشهادة.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheck2 className="h-4 w-4" /> الطلبات المحالة وقيد التدريب
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!requests.length && <p>لا توجد طلبات دورات.</p>}
              {requests.map((request) => (
                <div key={request.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold">
                        {request.employee_name} · {request.employee_no}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {request.course_type} ·{" "}
                        {request.request_type === "new" ? "طلب جديد" : "تجديد"}
                      </p>
                    </div>
                    <Badge
                      className={
                        statusTone[request.status as keyof typeof statusTone] ??
                        "bg-slate-500 text-white"
                      }
                    >
                      {statusLabel[request.status] ?? request.status}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    جهة الاعتماد: {request.approver}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">ملاحظات: {request.notes}</p>

                  {request.status === "pending_approval" &&
                    (canManage ||
                      (profile.data === request.target_approver_id && !!profile.data)) && (
                      <div className="mt-4 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            handleDecision(request.id, "approve", "تمت الموافقة من جهة الاعتماد")
                          }
                        >
                          موافقة
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleDecision(request.id, "reject", "تم الرفض لعدم استيفاء الشروط")
                          }
                        >
                          رفض
                        </Button>
                      </div>
                    )}

                  {canManage && request.status === "approved" && (
                    <Button
                      className="mt-3"
                      size="sm"
                      onClick={() => {
                        setSelectedRequestId(request.id);
                        setCompletion({
                          certificateNo: "",
                          issueDate: "",
                          renewalDate: "",
                          expiryDate: "",
                          attachmentUrl: "",
                        });
                      }}
                    >
                      <TicketCheck className="ml-2 h-4 w-4" />
                      ترحيل الشهادة
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {selectedRequest && (
            <Card>
              <CardHeader>
                <CardTitle>إكمال الطلب المختار</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleCompletion}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>رقم الشهادة</Label>
                      <Input
                        value={completion.certificateNo}
                        onChange={(e) =>
                          setCompletion((prev) => ({ ...prev, certificateNo: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>
                        {selectedRequest.request_type === "new" ? "تاريخ الإصدار" : "تاريخ التجديد"}
                      </Label>
                      <Input
                        required
                        type="date"
                        value={
                          selectedRequest.request_type === "new"
                            ? completion.issueDate
                            : completion.renewalDate || completion.issueDate
                        }
                        onChange={(e) =>
                          setCompletion((prev) => ({
                            ...prev,
                            [selectedRequest.request_type === "new" ? "issueDate" : "renewalDate"]:
                              e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>تاريخ الانتهاء</Label>
                      <Input
                        required
                        type="date"
                        value={completion.expiryDate}
                        onChange={(e) =>
                          setCompletion((prev) => ({ ...prev, expiryDate: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>رابط المرفق</Label>
                      <Input
                        value={completion.attachmentUrl}
                        onChange={(e) =>
                          setCompletion((prev) => ({ ...prev, attachmentUrl: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                  <Button disabled={busy} type="submit" className="w-full">
                    <CheckCircle2 className="ml-2 h-4 w-4" />
                    حفظ وإنهاء الطلب
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="settings" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>أنواع الدورات وفترات الصلاحية</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canManage && (
                <form
                  className="grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    const values = Object.fromEntries(new FormData(f));
                    void save(
                      () =>
                        db
                          .from("training_course_types")
                          .insert({
                            ...values,
                            default_validity_months: Number(values.default_validity_months),
                          }),
                      () => f.reset(),
                    );
                  }}
                >
                  <Input name="name_ar" placeholder="اسم الدورة بالعربية" required />
                  <Input name="code" placeholder="رمز الدورة" required />
                  <label>
                    الصلاحية بالأشهر
                    <Input type="number" name="default_validity_months" min="1" required />
                  </label>
                  <select required name="department_id" aria-label="القسم">
                    <option value="">اختر القسم</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <Button disabled={busy}>إضافة نوع دورة</Button>
                </form>
              )}
              {!courses.length && <p>لا توجد أنواع دورات مسجلة.</p>}
              {courses.map((course) => (
                <div
                  key={course.id}
                  className="flex items-center justify-between rounded-xl border p-3"
                >
                  <div>
                    <p className="font-semibold">{course.name_ar}</p>
                    <p className="text-sm text-muted-foreground">
                      الرمز: {course.code} · {course.default_validity_months} شهر
                    </p>
                  </div>
                  <Badge
                    className={
                      course.is_active ? "bg-emerald-600 text-white" : "bg-slate-500 text-white"
                    }
                  >
                    {course.is_active ? "نشط" : "غير نشط"}
                  </Badge>
                  {canManage && (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void save(() =>
                          db
                            .from("training_course_types")
                            .update({
                              default_validity_months: Number(f.get("months")),
                              is_active: f.has("active"),
                            })
                            .eq("id", course.id)
                            .select("id")
                            .single(),
                        );
                      }}
                    >
                      <Input
                        aria-label="مدة الصلاحية بالأشهر"
                        type="number"
                        name="months"
                        min="1"
                        required
                        defaultValue={course.default_validity_months}
                      />
                      <label>
                        <input name="active" type="checkbox" defaultChecked={course.is_active} />
                        نشط
                      </label>
                      <Button disabled={busy}>حفظ</Button>
                    </form>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>الصلاحيات الإدارية</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-xl bg-muted/30 p-3">
                <p className="font-semibold text-foreground">موظف/موظفة</p>
                <p className="mt-2">يستطيع عرض شهاداته ونماذجه فقط.</p>
              </div>
              <div className="rounded-xl bg-muted/30 p-3">
                <p className="font-semibold text-foreground">رؤساء الأقسام</p>
                <p className="mt-2">يُسمح لهم اعتماد الطلبات المحالة لقسمهم.</p>
              </div>
              <div className="rounded-xl bg-muted/30 p-3">
                <p className="font-semibold text-foreground">مسؤولو HR</p>
                <p className="mt-2">إدارة الدورات، المواعيد، المرفقات، واعتماد النماذج الرقمية.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default CertificationsPage;
