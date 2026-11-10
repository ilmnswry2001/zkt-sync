import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Award,
  BellRing,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  Funnel,
  GraduationCap,
  QrCode,
  Search,
  ShieldCheck,
  TicketCheck,
  UserRound,
} from "lucide-react";

type CourseType = {
  id: string;
  name_ar: string;
  code: string;
  default_validity_months: number;
  department_id: string;
  is_active: boolean;
};

type CertificationRow = {
  id: string;
  employee_name: string;
  employee_no: string;
  department: string;
  specialty: string;
  course_type: string;
  issue_date: string;
  expiry_date: string;
  days_remaining: number;
  status: "active" | "expiring_soon" | "expired";
  attachment_url: string;
};

type TrainingRequest = {
  id: string;
  employee_name: string;
  employee_no: string;
  course_type: string;
  request_type: "new" | "renewal";
  approver: string;
  status: "pending_approval" | "approved" | "rejected" | "completed";
  notes: string;
  created_at: string;
};

type FormTemplate = {
  id: string;
  title: string;
  category: string;
  description: string;
  audience: string;
};

type FormSubmission = {
  id: string;
  employee_name: string;
  template: string;
  status: "pending_review" | "approved" | "rejected";
  submitted_at: string;
};

const courseTypes: CourseType[] = [
  { id: "1", name_ar: "ريكر", code: "RCR", default_validity_months: 12, department_id: "1", is_active: true },
  { id: "2", name_ar: "مسعف", code: "EMS", default_validity_months: 12, department_id: "2", is_active: true },
  { id: "3", name_ar: "إطفائي", code: "FIR", default_validity_months: 12, department_id: "3", is_active: true },
  { id: "4", name_ar: "إنقاذ أماكن مرتفعة", code: "HEI", default_validity_months: 6, department_id: "4", is_active: true },
  { id: "5", name_ar: "إنقاذ أماكن مغلقة", code: "CON", default_validity_months: 6, department_id: "5", is_active: true },
];

const initialCertifications: CertificationRow[] = [
  { id: "c1", employee_name: "أحمد علي محمد", employee_no: "EMP-101", department: "العمليات", specialty: "أمن وسلامة", course_type: "ريكر", issue_date: "2024-02-15", expiry_date: "2026-02-15", days_remaining: 120, status: "active", attachment_url: "https://example.com/cert/rcr-101.pdf" },
  { id: "c2", employee_name: "سارة ياسين", employee_no: "EMP-204", department: "السلامة", specialty: "السلامة المهنية", course_type: "مسعف", issue_date: "2024-11-01", expiry_date: "2025-11-01", days_remaining: 18, status: "expiring_soon", attachment_url: "https://example.com/cert/ems-204.pdf" },
  { id: "c3", employee_name: "محمود خالد", employee_no: "EMP-312", department: "الإنشاءات", specialty: "إطفاء", course_type: "إطفائي", issue_date: "2023-08-20", expiry_date: "2025-08-20", days_remaining: -12, status: "expired", attachment_url: "https://example.com/cert/fire-312.pdf" },
  { id: "c4", employee_name: "سلمان زايد", employee_no: "EMP-421", department: "الإدارة", specialty: "شؤون الموظفين", course_type: "إنقاذ أماكن مرتفعة", issue_date: "2025-01-05", expiry_date: "2025-07-05", days_remaining: 28, status: "expiring_soon", attachment_url: "https://example.com/cert/high-421.pdf" },
  { id: "c5", employee_name: "أسيل فرح", employee_no: "EMP-550", department: "الصيانة", specialty: "صيانة المرافق", course_type: "إنقاذ أماكن مغلقة", issue_date: "2025-03-01", expiry_date: "2027-03-01", days_remaining: 430, status: "active", attachment_url: "https://example.com/cert/confined-550.pdf" },
];

const initialRequests: TrainingRequest[] = [
  { id: "r1", employee_name: "محمود خالد", employee_no: "EMP-312", course_type: "إطفائي", request_type: "renewal", approver: "إدارة السلامة", status: "pending_approval", notes: "تجديد شهادة إطفاء نظراً لصلاحية الشهادة المنتهية خلال 3 أسابيع.", created_at: "2026-11-04" },
  { id: "r2", employee_name: "سارة ياسين", employee_no: "EMP-204", course_type: "مسعف", request_type: "new", approver: "مدير الموارد البشرية", status: "approved", notes: "تمت الموافقة على التسجيل في الدورة وتكليفها بالقسم المختص.", created_at: "2026-11-03" },
  { id: "r3", employee_name: "أحمد علي محمد", employee_no: "EMP-101", course_type: "ريكر", request_type: "new", approver: "إدارة التشغيل", status: "completed", notes: "تمت استلام الشهادة وتحديث السجل خلال اليوم.", created_at: "2026-10-30" },
];

const digitalFormTemplates: FormTemplate[] = [
  { id: "t1", title: "تحديث المستمسكات", category: "الهوية", description: "تحديث بيانات المستمسكات الشخصية والصادرة", audience: "جميع الموظفين" },
  { id: "t2", title: "الحساب المصرفي", category: "المالية", description: "تحديث بيانات الحساب البنكي وإشعار الرواتب", audience: "جميع الموظفين" },
  { id: "t3", title: "السكن وأرقام الطوارئ", category: "الملف الشخصي", description: "إدخال عنوان السكن وأرقام الطوارئ", audience: "جميع الموظفين" },
  { id: "t4", title: "استبيان السلامة", category: "السلامة", description: "تقييم المخاطر والقيود التشغيلية", audience: "الطاقم الميداني" },
];

const digitalFormSubmissions: FormSubmission[] = [
  { id: "s1", employee_name: "حسن زيد", template: "الحساب المصرفي", status: "pending_review", submitted_at: "2026-11-05" },
  { id: "s2", employee_name: "ليلى ناصر", template: "السكن وأرقام الطوارئ", status: "approved", submitted_at: "2026-11-04" },
  { id: "s3", employee_name: "أكرم فهد", template: "استبيان السلامة", status: "rejected", submitted_at: "2026-11-02" },
];

const approvers = [
  "إدارة السلامة",
  "مدير الموارد البشرية",
  "إدارة التشغيل",
  "المدير التنفيذي",
  "قسم الرفع",
  "قسم الصيانة",
];

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

function StatCard({ title, value, icon: Icon, tone }: { title: string; value: string | number; icon: typeof Award; tone: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute("/_authenticated/certifications")({
  head: () => ({
    meta: [
      { title: "الشهادات والدورات — مركز التدريب والتأهيل" },
      { name: "description", content: "إدارة الشهادات والدورات التدريبية، طلبات الاعتماد، ومركز النماذج الرقمية." },
    ],
  }),
  component: CertificationsPage,
});

function CertificationsPage() {
  const [certifications, setCertifications] = useState<CertificationRow[]>(initialCertifications);
  const [requests, setRequests] = useState<TrainingRequest[]>(initialRequests);
  const [submissions, setSubmissions] = useState<FormSubmission[]>(digitalFormSubmissions);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedEmployee, setSelectedEmployee] = useState("EMP-101");
  const [selectedCourse, setSelectedCourse] = useState(courseTypes[0].id);
  const [requestType, setRequestType] = useState<"new" | "renewal">("new");
  const [approver, setApprover] = useState(approvers[0]);
  const [requestNote, setRequestNote] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState(initialRequests[0]?.id ?? "");
  const [completion, setCompletion] = useState({
    certificateNo: "",
    issueDate: "2026-11-10",
    expiryDate: "2027-11-10",
    renewalDate: "",
    attachmentUrl: "",
  });
  const [selectedTemplate, setSelectedTemplate] = useState(digitalFormTemplates[0].id);

  const certificationStats = useMemo(() => {
    const total = certifications.length;
    const active = certifications.filter((row) => row.status === "active").length;
    const expired = certifications.filter((row) => row.status === "expired").length;
    const expiringSoon = certifications.filter((row) => row.status === "expiring_soon").length;
    const inProgress = requests.filter((row) => row.status === "approved" || row.status === "pending_approval").length;
    return { total, active, expired, expiringSoon, inProgress };
  }, [certifications, requests]);

  const filteredCertifications = useMemo(() => {
    return certifications.filter((row) => {
      const matchesEmployee = row.employee_name.toLowerCase().includes(search.toLowerCase()) || row.employee_no.toLowerCase().includes(search.toLowerCase());
      const matchesDepartment = departmentFilter === "all" || row.department === departmentFilter;
      const matchesSpecialty = specialtyFilter === "all" || row.specialty === specialtyFilter;
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      return matchesEmployee && matchesDepartment && matchesSpecialty && matchesStatus;
    });
  }, [certifications, departmentFilter, search, specialtyFilter, statusFilter]);

  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ?? null;

  const handleCreateRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const courseName = courseTypes.find((course) => course.id === selectedCourse)?.name_ar ?? "دورة";
    const employeeName = ["أحمد علي محمد", "سارة ياسين", "محمود خالد", "أسيل فرح"][Number(selectedEmployee.replace("EMP-", "")) % 4] ?? "موظف";
    const newRequest: TrainingRequest = {
      id: `req-${Date.now()}`,
      employee_name: employeeName,
      employee_no: selectedEmployee,
      course_type: courseName,
      request_type,
      approver,
      status: "pending_approval",
      notes: requestNote || "طلب دورة تدريبية جديد",
      created_at: new Date().toISOString().slice(0, 10),
    };
    setRequests((prev) => [newRequest, ...prev]);
    setRequestNote("");
    setSelectedRequestId(newRequest.id);
    toast.success("تم إرسال الطلب بنجاح إلى جهة الاعتماد");
  };

  const handleDecision = (id: string, decision: "approve" | "reject", note?: string) => {
    setRequests((prev) =>
      prev.map((request) => {
        if (request.id !== id) return request;
        return {
          ...request,
          status: decision === "approve" ? "approved" : "rejected",
          notes: note ? `${request.notes} | ${note}` : request.notes,
        };
      }),
    );
    toast.success(decision === "approve" ? "تمت الموافقة على الطلب وقيد التدريب" : "تم رفض الطلب مع حفظ الملاحظة");
  };

  const handleCompletion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRequest) return;

    const nextCertification: CertificationRow = {
      id: `cert-${Date.now()}`,
      employee_name: selectedRequest.employee_name,
      employee_no: selectedRequest.employee_no,
      department: "العمليات",
      specialty: selectedRequest.request_type === "renewal" ? "تجديد دورة" : "تدريب",
      course_type: selectedRequest.course_type,
      issue_date: requestType === "renewal" ? completion.renewalDate || completion.issueDate : completion.issueDate,
      expiry_date: completion.expiryDate,
      days_remaining: Math.max(0, Math.ceil((new Date(completion.expiryDate).getTime() - Date.now()) / 86400000)),
      status: "active",
      attachment_url: completion.attachmentUrl || "https://example.com/attachment.pdf",
    };

    setCertifications((prev) => [nextCertification, ...prev]);
    setRequests((prev) =>
      prev.map((request) =>
        request.id === selectedRequest.id ? { ...request, status: "completed", notes: "تم إكمال البرنامج وتحديث الشهادة" } : request,
      ),
    );
    toast.success("تم تحديث الشهادة والسجل الشخصي للموظف بنجاح");
  };

  const handleSubmissionDecision = (id: string, decision: "approved" | "rejected") => {
    setSubmissions((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: decision === "approved" ? "approved" : "rejected" } : item)),
    );
    toast.success(decision === "approved" ? "تم اعتماد النموذج وتحديث بيانات الموظف تلقائياً" : "تم رفض النموذج مع حفظ الملاحظة");
  };

  const selectedTemplateTitle = digitalFormTemplates.find((template) => template.id === selectedTemplate)?.title ?? "النموذج";

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">إدارة الموارد البشرية والتأهيل</p>
          <h1 className="text-3xl font-bold">الشهادات والدورات</h1>
        </div>
        <Button variant="outline">
          <QrCode className="ml-2 h-4 w-4" />
          رابط النموذج السريع
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent md:grid-cols-5">
          <TabsTrigger value="overview">سجل الشهادات</TabsTrigger>
          <TabsTrigger value="request">طلب دورة</TabsTrigger>
          <TabsTrigger value="approvals">الطلبات المحالة</TabsTrigger>
          <TabsTrigger value="forms">مركز النماذج</TabsTrigger>
          <TabsTrigger value="settings">الإعدادات</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <StatCard title="إجمالي الشهادات" value={certificationStats.total} icon={Award} tone="bg-primary" />
            <StatCard title="السارية" value={certificationStats.active} icon={CheckCircle2} tone="bg-emerald-600" />
            <StatCard title="المنتهية" value={certificationStats.expired} icon={ShieldCheck} tone="bg-rose-600" />
            <StatCard title="قريبة من الانتهاء" value={certificationStats.expiringSoon} icon={Clock3} tone="bg-amber-500" />
            <StatCard title="الدورات الجارية" value={certificationStats.inProgress} icon={GraduationCap} tone="bg-indigo-600" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Funnel className="h-4 w-4" /> المرشحات</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-5">
              <div className="space-y-2 md:col-span-2">
                <Label>بحث</Label>
                <div className="relative">
                  <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم الموظف أو الرقم" className="pr-10" />
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
                    <SelectItem value="العمليات">العمليات</SelectItem>
                    <SelectItem value="السلامة">السلامة</SelectItem>
                    <SelectItem value="الإنشاءات">الإنشاءات</SelectItem>
                    <SelectItem value="الإدارة">الإدارة</SelectItem>
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
                    <SelectItem value="أمن وسلامة">أمن وسلامة</SelectItem>
                    <SelectItem value="السلامة المهنية">السلامة المهنية</SelectItem>
                    <SelectItem value="إطفاء">إطفاء</SelectItem>
                    <SelectItem value="شؤون الموظفين">شؤون الموظفين</SelectItem>
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
                        {row.days_remaining > 0 ? `${row.days_remaining} يوم` : `${Math.abs(row.days_remaining)} يوم متأخرة`}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusTone[row.status]}>{statusLabel[row.status]}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => window.open(row.attachment_url, "_blank")}>معاينة</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!filteredCertifications.length && (
                    <TableRow>
                      <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">لا توجد شهادات مطابقة للفلتر الحالي.</TableCell>
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
              <CardTitle className="flex items-center gap-2"><GraduationCap className="h-4 w-4" /> طلب دورة تدريبية</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateRequest}>
                <div className="space-y-2">
                  <Label>الموظف</Label>
                  <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الموظف" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EMP-101">أحمد علي محمد</SelectItem>
                      <SelectItem value="EMP-204">سارة ياسين</SelectItem>
                      <SelectItem value="EMP-312">محمود خالد</SelectItem>
                      <SelectItem value="EMP-550">أسيل فرح</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>نوع الدورة</Label>
                  <Select value={selectedCourse} onValueChange={setSelectedCourse}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الدورة" />
                    </SelectTrigger>
                    <SelectContent>
                      {courseTypes.map((course) => (
                        <SelectItem key={course.id} value={course.id}>{course.name_ar}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>نوع الطلب</Label>
                  <Select value={requestType} onValueChange={(value) => setRequestType(value as "new" | "renewal")}>
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
                      {approvers.map((item) => (
                        <SelectItem key={item} value={item}>{item}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>ملاحظات الطلب</Label>
                  <Textarea value={requestNote} onChange={(e) => setRequestNote(e.target.value)} rows={4} placeholder="أدخل تفاصيل الطلب أو سبب التحديث" />
                </div>

                <Button className="w-full" type="submit">
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
                <p className="mt-2">العضو: {selectedEmployee}</p>
                <p>الدورة: {courseTypes.find((course) => course.id === selectedCourse)?.name_ar}</p>
                <p>نوع الطلب: {requestType === "new" ? "جديد" : "تجديد"}</p>
                <p>جهة الاعتماد: {approver}</p>
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
              <CardTitle className="flex items-center gap-2"><FileCheck2 className="h-4 w-4" /> الطلبات المحالة وقيد التدريب</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {requests.map((request) => (
                <div key={request.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold">{request.employee_name} · {request.employee_no}</p>
                      <p className="text-sm text-muted-foreground">{request.course_type} · {request.request_type === "new" ? "طلب جديد" : "تجديد"}</p>
                    </div>
                    <Badge className={statusTone[request.status as keyof typeof statusTone] ?? "bg-slate-500 text-white"}>{statusLabel[request.status] ?? request.status}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">جهة الاعتماد: {request.approver}</p>
                  <p className="mt-1 text-sm text-muted-foreground">ملاحظات: {request.notes}</p>

                  {request.status === "pending_approval" && (
                    <div className="mt-4 flex gap-2">
                      <Button size="sm" onClick={() => handleDecision(request.id, "approve", "تمت الموافقة من جهة الاعتماد")}>موافقة</Button>
                      <Button size="sm" variant="outline" onClick={() => handleDecision(request.id, "reject", "تم الرفض لعدم استيفاء الشروط")}>رفض</Button>
                    </div>
                  )}

                  {request.status === "approved" && (
                    <div className="mt-4 rounded-lg border border-dashed p-3">
                      <p className="mb-3 font-medium">إدخال بيانات الإنجاز</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>رقم الشهادة</Label>
                          <Input value={completion.certificateNo} onChange={(e) => setCompletion((prev) => ({ ...prev, certificateNo: e.target.value }))} placeholder="CERT-0001" />
                        </div>
                        <div className="space-y-2">
                          <Label>تاريخ الإصدار</Label>
                          <Input type="date" value={completion.issueDate} onChange={(e) => setCompletion((prev) => ({ ...prev, issueDate: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>تاريخ الانتهاء</Label>
                          <Input type="date" value={completion.expiryDate} onChange={(e) => setCompletion((prev) => ({ ...prev, expiryDate: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>تاريخ التجديد</Label>
                          <Input type="date" value={completion.renewalDate} onChange={(e) => setCompletion((prev) => ({ ...prev, renewalDate: e.target.value }))} />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>رابط المرفق</Label>
                          <Input value={completion.attachmentUrl} onChange={(e) => setCompletion((prev) => ({ ...prev, attachmentUrl: e.target.value }))} placeholder="https://..." />
                        </div>
                      </div>
                      <Button className="mt-3" size="sm" onClick={() => setSelectedRequestId(request.id)}>
                        <TicketCheck className="ml-2 h-4 w-4" />
                        ترحيل الشهادة
                      </Button>
                    </div>
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
                      <Input value={completion.certificateNo} onChange={(e) => setCompletion((prev) => ({ ...prev, certificateNo: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>{selectedRequest.request_type === "new" ? "تاريخ الإصدار" : "تاريخ التجديد"}</Label>
                      <Input type="date" value={selectedRequest.request_type === "new" ? completion.issueDate : completion.renewalDate || completion.issueDate} onChange={(e) => setCompletion((prev) => ({ ...prev, [selectedRequest.request_type === "new" ? "issueDate" : "renewalDate"]: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>تاريخ الانتهاء</Label>
                      <Input type="date" value={completion.expiryDate} onChange={(e) => setCompletion((prev) => ({ ...prev, expiryDate: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>رابط المرفق</Label>
                      <Input value={completion.attachmentUrl} onChange={(e) => setCompletion((prev) => ({ ...prev, attachmentUrl: e.target.value }))} />
                    </div>
                  </div>
                  <Button type="submit" className="w-full">
                    <CheckCircle2 className="ml-2 h-4 w-4" />
                    حفظ وإنهاء الطلب
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="forms" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard title="إجمالي القوالب" value={digitalFormTemplates.length} icon={FileText} tone="bg-sky-600" />
            <StatCard title="قيد المراجعة" value={submissions.filter((row) => row.status === "pending_review").length} icon={Clock3} tone="bg-amber-500" />
            <StatCard title="معتمدة" value={submissions.filter((row) => row.status === "approved").length} icon={CheckCircle2} tone="bg-emerald-600" />
            <StatCard title="نسبة الإنجاز" value="76%" icon={Award} tone="bg-violet-600" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>قوالب النماذج الرقمية</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {digitalFormTemplates.map((template) => (
                  <div key={template.id} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">{template.title}</p>
                        <p className="text-xs text-muted-foreground">{template.category} · {template.audience}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setSelectedTemplate(template.id)}>
                        اختر
                      </Button>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{template.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>توليد رابط النموذج</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl bg-muted/30 p-4 text-sm">
                  <p className="font-semibold">النموذج المختار</p>
                  <p className="mt-2">{selectedTemplateTitle}</p>
                </div>
                <Button className="w-full"><QrCode className="ml-2 h-4 w-4" /> إنشاء رابط مباشر</Button>
                <Button className="w-full" variant="outline"><QrCode className="ml-2 h-4 w-4" /> إنشاء رمز QR</Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>طلبات المراجعة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {submissions.map((submission) => (
                <div key={submission.id} className="rounded-xl border p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold">{submission.employee_name}</p>
                      <p className="text-sm text-muted-foreground">{submission.template} · {submission.submitted_at}</p>
                    </div>
                    <Badge className={statusTone[submission.status] ?? "bg-slate-500 text-white"}>{statusLabel[submission.status] ?? submission.status}</Badge>
                  </div>
                  {submission.status === "pending_review" && (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => handleSubmissionDecision(submission.id, "approved")}>اعتماد</Button>
                      <Button size="sm" variant="outline" onClick={() => handleSubmissionDecision(submission.id, "rejected")}>رفض مع ملاحظة</Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>أنواع الدورات وفترات الصلاحية</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {courseTypes.map((course) => (
                <div key={course.id} className="flex items-center justify-between rounded-xl border p-3">
                  <div>
                    <p className="font-semibold">{course.name_ar}</p>
                    <p className="text-sm text-muted-foreground">الرمز: {course.code} · {course.default_validity_months} شهر</p>
                  </div>
                  <Badge className={course.is_active ? "bg-emerald-600 text-white" : "bg-slate-500 text-white"}>{course.is_active ? "نشط" : "غير نشط"}</Badge>
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
