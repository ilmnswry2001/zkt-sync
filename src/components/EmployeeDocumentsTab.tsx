import { supabase } from "@/integrations/supabase/client";
import { useDirectorySearch } from "@/hooks/use-directory-search";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Eye, FolderOpen, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { EmployeeDocumentForm } from "@/components/EmployeeDocumentForm";
import { EmployeeDocumentPreview } from "@/components/EmployeeDocumentPreview";
import { MetricCard } from "@/components/MetricCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { formatErrorMessage } from "@/lib/error-message";
import {
  documentTypeLabels,
  employeeDocumentTypes,
  employeeDocumentMimeTypes,
  employeeDocumentsDb,
  isEmployeeDocumentAttachment,
  type DocumentEmployee,
  type EmployeeDocumentType,
} from "@/lib/employee-documents";
import {
  deleteEmployeeDocument,
  getDocumentSignedUrl,
  listEmployeeDocuments,
} from "@/lib/employee-documents.functions";

const badgeStyles: Record<EmployeeDocumentType, string> = {
  work_commencement: "border-teal-300 text-teal-800 dark:border-teal-700 dark:text-teal-200",
  administrative_order: "border-blue-300 text-blue-800 dark:border-blue-700 dark:text-blue-200",
  wage_increase:
    "border-emerald-300 text-emerald-800 dark:border-emerald-700 dark:text-emerald-200",
  official_letter: "border-slate-300 text-slate-800 dark:border-slate-600 dark:text-slate-200",
  contract: "border-violet-300 text-violet-800 dark:border-violet-700 dark:text-violet-200",
  penalty_warning: "border-red-300 text-red-800 dark:border-red-700 dark:text-red-200",
  other: "border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200",
};
const pageSize = 20;
const money = new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 2 });

type ArchiveEmployee = DocumentEmployee & {
  position?: string | null;
  departments?: { name: string } | null;
};

export function EmployeeDocumentsTab({ employee }: { employee?: ArchiveEmployee }) {
  const { user, isAdmin, isHR, permissionsLoading } = useAuth();
  const canManage = isAdmin || isHR;
  const [selected, setSelected] = useState<{ userId: string; employee: ArchiveEmployee } | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const lookup = useDirectorySearch(search);
  const person = employee ?? (selected?.userId === user?.id ? selected?.employee : undefined);
  const directory = useQuery({
    queryKey: ["employee-document-directory", user?.id, canManage, lookup.term],
    enabled: !!user && !permissionsLoading && !person && lookup.valid && !lookup.waiting,
    queryFn: async ({ signal }) => {
      let query = supabase
        .from("employees")
        .select("id, full_name, employee_no, position, departments(name)");
      if (!canManage) {
        const { data: ownId, error } = await employeeDocumentsDb(supabase)
          .rpc("erp_own_employee_id")
          .abortSignal(signal);
        if (error) throw error;
        if (!ownId) return [];
        query = query.eq("id", ownId);
      }
      for (const term of lookup.term.split(" ")) {
        query = query.or(`full_name.ilike.%${term}%,employee_no.ilike.%${term}%`);
      }
      const { data, error } = await query
        .order("full_name")
        .order("id")
        .limit(50)
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  if (!user || permissionsLoading)
    return (
      <p role="status" className="text-muted-foreground">
        جارٍ تحميل صلاحيات الأرشيف…
      </p>
    );
  if (person)
    return (
      <EmployeeDocumentRepository
        key={`${user.id}:${person.id}`}
        employee={person}
        userId={user.id}
        canManage={canManage}
        onBack={employee ? undefined : () => setSelected(null)}
      />
    );
  const candidates = lookup.valid && !lookup.waiting ? (directory.data ?? []) : [];
  return (
    <Card dir="rtl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5" /> مستودع مستندات الموظفين
        </CardTitle>
        <p className="text-sm text-muted-foreground">اختر موظفاً لفتح ملف مستنداته.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex max-w-md flex-col gap-3">
          <Label htmlFor="archive-employee-search">بحث عن الموظف</Label>
          <Input
            id="archive-employee-search"
            maxLength={100}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="الاسم أو الرقم الوظيفي"
          />
        </div>
        {!lookup.valid ? (
          <p className="text-sm text-muted-foreground">اكتب حرفين أو رقمين على الأقل للبحث.</p>
        ) : lookup.waiting || directory.isFetching ? (
          <p role="status" className="text-sm text-muted-foreground">
            جارٍ البحث…
          </p>
        ) : directory.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {formatErrorMessage(directory.error, "تعذر البحث عن الموظفين")}
          </p>
        ) : !candidates.length ? (
          <p className="text-sm text-muted-foreground">لا يوجد موظف مطابق متاح لحسابك.</p>
        ) : (
          <ul className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
            {candidates.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex h-full w-full flex-col gap-1 rounded-lg border bg-background p-3 text-right hover:border-primary focus-visible:outline-primary"
                  onClick={() => setSelected({ userId: user.id, employee: item })}
                >
                  <span className="break-words font-semibold">{item.full_name}</span>
                  <span className="text-sm text-muted-foreground">
                    {item.employee_no} {item.position ? `· ${item.position}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmployeeDocumentRepository({
  employee,
  userId,
  canManage,
  onBack,
}: {
  employee: ArchiveEmployee;
  userId: string;
  canManage: boolean;
  onBack?: () => void;
}) {
  const queryClient = useQueryClient();
  const list = useServerFn(listEmployeeDocuments);
  const remove = useServerFn(deleteEmployeeDocument);
  const sign = useServerFn(getDocumentSignedUrl);
  const [type, setType] = useState<EmployeeDocumentType | "">("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [batch, setBatch] = useState<{ files: File[]; index: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const addFiles = (files: FileList | null) => {
    if (!canManage || batch || !files?.length) return;
    const supplied = Array.from(files);
    const valid = supplied.filter(isEmployeeDocumentAttachment);
    if (valid.length !== supplied.length)
      toast.error("بعض الملفات غير مدعومة. اختر PDF أو صورة بحجم لا يتجاوز 15 ميغابايت للملف.");
    if (valid.length) setBatch({ files: valid, index: 0 });
  };
  const [preview, setPreview] = useState<{
    id: string;
    title: string;
    fileName: string;
    trigger: HTMLButtonElement;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const invalidDates = !!from && !!to && from > to;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTerm(search.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const records = useQuery({
    queryKey: ["employee-document-archive", userId, employee.id, type, term, from, to, page],
    enabled: !invalidDates,
    queryFn: ({ signal }) =>
      list({
        signal,
        data: {
          employee_id: employee.id,
          document_type: type || undefined,
          search: term,
          from: from || undefined,
          to: to || undefined,
          page,
        },
      }),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["employee-document-archive", userId] });
  const deleteDocument = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setPage(0);
      await refresh();
      toast.success("تم حذف المستند ومرفقه");
    },
    onError: (error) => toast.error(formatErrorMessage(error, "تعذر حذف المستند")),
  });
  const downloadFile = useMutation({
    mutationFn: async (id: string) => {
      const link = await sign({ data: { id, download: true } });
      const linkElement = document.createElement("a");
      linkElement.href = link.url;
      linkElement.download = link.fileName ?? "document";
      linkElement.rel = "noopener noreferrer";
      linkElement.click();
    },
    onError: (error) => toast.error(formatErrorMessage(error, "تعذر تنزيل المرفق")),
  });
  const stats = records.data?.stats;
  const rows = records.data?.rows ?? [];
  const total = records.data?.totalCount ?? 0;

  return (
    <section dir="rtl" className="space-y-4">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-1 text-sm text-muted-foreground">ملف مستندات الموظف</p>
            <CardTitle className="break-words">{employee.full_name}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {employee.employee_no} {employee.position ? `· ${employee.position}` : ""}
              {employee.departments?.name ? ` · ${employee.departments.name}` : ""}
            </p>
          </div>
          {onBack && (
            <Button variant="outline" onClick={onBack}>
              اختيار موظف آخر
            </Button>
          )}
        </CardHeader>
        {canManage && (
          <CardContent>
            <label
              className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center focus-within:ring-2 focus-within:ring-primary ${dragging ? "border-primary bg-primary/10" : "border-border bg-muted/25 hover:border-primary/60"}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (!batch) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
            >
              <Upload className="h-6 w-6 text-primary" aria-hidden="true" />
              <span className="font-semibold">أفلت ملفات هذا الموظف هنا أو اضغط لاختيارها</span>
              <span className="text-sm text-muted-foreground">
                PDF أو JPEG أو PNG أو WebP · حتى 15 ميغابايت لكل ملف
              </span>
              <Input
                className="sr-only"
                type="file"
                multiple
                disabled={!!batch}
                accept={employeeDocumentMimeTypes.join(",")}
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </CardContent>
        )}
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="إجمالي المستندات"
          value={stats?.total ?? "—"}
          loading={records.isLoading}
        />
        <MetricCard
          title="مباشرات العمل"
          value={stats?.work_commencement ?? "—"}
          loading={records.isLoading}
          tone="info"
        />
        <MetricCard
          title="الأوامر الإدارية"
          value={stats?.administrative_order ?? "—"}
          loading={records.isLoading}
          tone="warning"
        />
        <MetricCard
          title="الزيادات المسجلة"
          value={stats?.wage_increase ?? "—"}
          loading={records.isLoading}
          tone="success"
        />
      </div>
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>الأرشيف الإداري ومباشرات العمل للموظف</CardTitle>
          {canManage && (
            <Button onClick={() => setBatch({ files: [], index: 0 })}>
              <Plus className="h-4 w-4" /> إضافة كتاب لهذا الموظف
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-2 text-sm">
              البحث
              <Input
                maxLength={100}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={"رقم الكتاب أو الموضوع"}
              />
            </label>
            <div className="flex flex-col gap-2">
              <Label htmlFor="archive-filter-type">نوع المستند</Label>
              <select
                id="archive-filter-type"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as EmployeeDocumentType | "");
                  setPage(0);
                }}
              >
                <option value="">كل الأنواع</option>
                {employeeDocumentTypes.map((key) => (
                  <option value={key} key={key}>
                    {documentTypeLabels[key]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex flex-col gap-2 text-sm">
              من تاريخ
              <Input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              إلى تاريخ
              <Input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(0);
                }}
              />
            </label>
          </div>
          {invalidDates ? (
            <p role="alert" className="text-destructive">
              تاريخ البداية يجب أن يسبق تاريخ النهاية أو يساويه.
            </p>
          ) : records.isPending ? (
            <p role="status" className="text-muted-foreground">
              جارٍ تحميل المستندات…
            </p>
          ) : records.isError ? (
            <div role="alert" className="space-y-2">
              <p className="text-destructive">
                {formatErrorMessage(records.error, "تعذر تحميل المستندات")}
              </p>
              <Button variant="outline" onClick={() => void records.refetch()}>
                إعادة المحاولة
              </Button>
            </div>
          ) : rows.length ? (
            <div className="overflow-hidden rounded-lg border">
              <Table className="min-w-[42rem]">
                <TableHeader>
                  <TableRow>
                    {["تاريخ الصدور", "رقم الكتاب", "النوع", "الموضوع", "الإجراءات"].map(
                      (label) => (
                        <TableHead key={label} className="text-right">
                          {label}
                        </TableHead>
                      ),
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <time dateTime={row.document_date} dir="ltr">
                          {row.document_date}
                        </time>
                      </TableCell>
                      <TableCell className="break-words">{row.document_number}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={badgeStyles[row.document_type]}>
                          {documentTypeLabels[row.document_type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-44 whitespace-normal break-words">
                        <p className="font-medium">{row.title}</p>
                        {row.amount_iqd !== null && (
                          <p className="text-xs text-muted-foreground">
                            {money.format(row.amount_iqd)} د.ع
                          </p>
                        )}
                        {(row.issuing_authority || row.effective_date || row.notes) && (
                          <details className="mt-1 text-xs text-muted-foreground">
                            <summary className="cursor-pointer">بيانات المستند</summary>
                            {row.issuing_authority && (
                              <p>الجهة المصدرة · {row.issuing_authority}</p>
                            )}
                            {row.effective_date && <p>السريان · {row.effective_date}</p>}
                            {row.notes && (
                              <p className="whitespace-pre-wrap break-words">{row.notes}</p>
                            )}
                          </details>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          {row.file_name && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(event) =>
                                  setPreview({
                                    id: row.id,
                                    title: row.title,
                                    fileName: row.file_name ?? row.title,
                                    trigger: event.currentTarget,
                                  })
                                }
                              >
                                <Eye className="h-4 w-4" /> معاينة
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={downloadFile.isPending}
                                onClick={() => downloadFile.mutate(row.id)}
                              >
                                <Download className="h-4 w-4" /> تنزيل
                              </Button>
                            </>
                          )}
                          {canManage && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => setDeleteTarget({ id: row.id, title: row.title })}
                            >
                              <Trash2 className="h-4 w-4" /> حذف
                            </Button>
                          )}
                          {!row.file_name && !canManage && "—"}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground">لا توجد مستندات مطابقة.</p>
          )}
          {!invalidDates && !records.isError && (page > 0 || total > pageSize) && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={page === 0 || records.isFetching}
                onClick={() => setPage(page - 1)}
              >
                السابق
              </Button>
              <span className="text-sm">
                صفحة {page + 1} · {total} مستند
              </span>
              <Button
                variant="outline"
                disabled={records.isFetching || (page + 1) * pageSize >= total}
                onClick={() => setPage(page + 1)}
              >
                التالي
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {batch && canManage && (
        <EmployeeDocumentForm
          key={batch.index}
          employee={employee}
          initialFile={batch.files[batch.index]}
          batchPosition={
            batch.files.length > 1 ? `${batch.index + 1} / ${batch.files.length}` : undefined
          }
          onClose={() => setBatch(null)}
          onChanged={async () => {
            setPage(0);
            await refresh();
          }}
          onSaved={() =>
            setBatch((current) =>
              current && current.index + 1 < current.files.length
                ? { ...current, index: current.index + 1 }
                : null,
            )
          }
        />
      )}
      {preview && (
        <EmployeeDocumentPreview
          key={preview.id}
          documentId={preview.id}
          userId={userId}
          title={preview.title}
          fileName={preview.fileName}
          loadAttachment={(signal) => sign({ signal, data: { id: preview.id, download: false } })}
          onClose={() => setPreview(null)}
          onRestoreFocus={() => preview.trigger.focus()}
        />
      )}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteDocument.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المستند الإداري؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{deleteTarget?.title}» ومرفقه من الأرشيف.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDocument.isPending}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteDocument.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) deleteDocument.mutate(deleteTarget.id);
              }}
            >
              {deleteDocument.isPending ? "جارٍ الحذف…" : "تأكيد الحذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
