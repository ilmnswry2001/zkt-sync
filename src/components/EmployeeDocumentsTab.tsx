import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Eye, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmployeeDocumentForm } from "@/components/EmployeeDocumentForm";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function EmployeeDocumentsTab({ employee }: { employee?: DocumentEmployee }) {
  const { user, isAdmin, isHR } = useAuth();
  const canManage = isAdmin || isHR;
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
  const [formOpen, setFormOpen] = useState(false);
  const [preview, setPreview] = useState<{
    url: string;
    title: string;
    fileName: string | null;
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
    queryKey: ["employee-document-archive", user?.id, employee?.id, type, term, from, to, page],
    enabled: !!user && !invalidDates,
    queryFn: ({ signal }) =>
      list({
        signal,
        data: {
          employee_id: employee?.id,
          document_type: type || undefined,
          search: term,
          from: from || undefined,
          to: to || undefined,
          page,
        },
      }),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["employee-document-archive", user?.id] });
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
  const accessFile = useMutation({
    mutationFn: async ({
      id,
      title,
      download,
    }: {
      id: string;
      title: string;
      download: boolean;
    }) => {
      const link = await sign({ data: { id, download } });
      if (download) {
        const linkElement = document.createElement("a");
        linkElement.href = link.url;
        linkElement.download = link.fileName ?? "document";
        linkElement.rel = "noopener noreferrer";
        linkElement.click();
      } else {
        setPreview({ ...link, title });
      }
    },
    onError: (error) => toast.error(formatErrorMessage(error, "تعذر فتح المرفق")),
  });
  const stats = records.data?.stats;
  const rows = records.data?.rows ?? [];
  const total = records.data?.totalCount ?? 0;

  return (
    <section dir="rtl" className="space-y-4">
      {!employee && (
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
      )}
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>
            {employee ? "الأرشيف الإداري ومباشرات العمل للموظف" : "المستندات والأوامر الإدارية"}
          </CardTitle>
          {canManage && user && (
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />{" "}
              {employee ? "إضافة كتاب لهذا الموظف" : "إدراج مستند إداري"}
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
                placeholder={employee ? "رقم الكتاب أو الموضوع" : "رقم الكتاب أو الموضوع أو الموظف"}
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
                    {[
                      "تاريخ الصدور",
                      "رقم الكتاب",
                      "النوع",
                      ...(!employee ? ["الموظف"] : []),
                      "الموضوع",
                      "الإجراءات",
                    ].map((label) => (
                      <TableHead key={label} className="text-right">
                        {label}
                      </TableHead>
                    ))}
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
                      {!employee && (
                        <TableCell>
                          {row.employee?.full_name ?? "—"}
                          {row.employee && (
                            <p className="text-xs text-muted-foreground">
                              {row.employee.employee_no}
                            </p>
                          )}
                        </TableCell>
                      )}
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
                                disabled={accessFile.isPending}
                                onClick={() =>
                                  accessFile.mutate({
                                    id: row.id,
                                    title: row.title,
                                    download: false,
                                  })
                                }
                              >
                                <Eye className="h-4 w-4" /> معاينة
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={accessFile.isPending}
                                onClick={() =>
                                  accessFile.mutate({
                                    id: row.id,
                                    title: row.title,
                                    download: true,
                                  })
                                }
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
      {formOpen && user && canManage && (
        <EmployeeDocumentForm
          employee={employee}
          userId={user.id}
          onClose={() => setFormOpen(false)}
          onChanged={async () => {
            setPage(0);
            await refresh();
          }}
        />
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{preview?.title}</DialogTitle>
            <DialogDescription>{preview?.fileName}</DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <iframe
                className="h-[65dvh] w-full rounded-lg border"
                sandbox=""
                src={preview.url}
                title={preview.title}
                referrerPolicy="no-referrer"
              />
              <Button asChild variant="outline">
                <a href={preview.url} target="_blank" rel="noopener noreferrer">
                  فتح المرفق في تبويب جديد
                </a>
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
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
