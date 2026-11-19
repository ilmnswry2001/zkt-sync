import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useDirectorySearch } from "@/hooks/use-directory-search";
import { todayInBaghdad } from "@/lib/date-time";
import { formatErrorMessage } from "@/lib/error-message";
import {
  documentTypeLabels,
  employeeDocumentMaxSize,
  employeeDocumentMimeTypes,
  employeeDocumentTypes,
  employeeDocumentsBucket,
  type DocumentEmployee,
  type EmployeeDocumentType,
} from "@/lib/employee-documents";
import { createEmployeeDocument, deleteEmployeeDocument } from "@/lib/employee-documents.functions";

const fieldClass = "flex flex-col gap-3 leading-6";
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

async function uploadAttachment(path: string, file: File, onProgress: (value: number) => void) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("انتهت جلسة تسجيل الدخول");
  const base = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error("إعدادات تخزين المستندات غير متاحة");
  const objectPath = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`/storage/v1/object/${employeeDocumentsBucket}/${objectPath}`, base);
  const body = new FormData();
  body.append("cacheControl", "0");
  body.append("", file);
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url.toString());
    request.timeout = 180_000;
    request.setRequestHeader("apikey", key);
    request.setRequestHeader("Authorization", `Bearer ${data.session!.access_token}`);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`تعذر رفع المرفق (رمز ${request.status})`));
    };
    request.onerror = () => reject(new Error("انقطع الاتصال أثناء رفع المرفق"));
    request.ontimeout = () => reject(new Error("انتهت مهلة رفع المرفق"));
    request.onabort = () => reject(new Error("توقف رفع المرفق"));
    request.send(body);
  });
}

export function EmployeeDocumentForm({
  employee,
  userId,
  onClose,
  onChanged,
}: {
  employee?: DocumentEmployee;
  userId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const createDocument = useServerFn(createEmployeeDocument);
  const deleteDocument = useServerFn(deleteEmployeeDocument);
  const [person, setPerson] = useState<DocumentEmployee | null>(employee ?? null);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const lookup = useDirectorySearch(search);
  const [type, setType] = useState<EmployeeDocumentType>("work_commencement");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const directory = useQuery({
    queryKey: ["employee-document-directory", userId, lookup.term],
    enabled: !employee && pickerOpen && lookup.valid && !lookup.waiting,
    queryFn: async ({ signal }) => {
      let query = supabase.from("employees").select("id, full_name, employee_no");
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
  type SupportedMime = (typeof employeeDocumentMimeTypes)[number];
  const chooseFile = (candidate?: File) => {
    if (!candidate) return;
    if (
      !employeeDocumentMimeTypes.some((mime) => candidate.type === mime) ||
      candidate.size < 1 ||
      candidate.size > employeeDocumentMaxSize ||
      candidate.name.length > 255
    ) {
      toast.error("اختر ملف PDF أو صورة JPEG أو PNG أو WebP بحجم لا يتجاوز 15 ميغابايت");
      return;
    }
    setFile(candidate);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !person) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true);
    setUploadPercent(null);
    try {
      const created = await createDocument({
        data: {
          employee_id: person.id,
          document_type: type,
          document_number: value("number"),
          document_date: value("date"),
          effective_date: value("effective") || undefined,
          title: value("title"),
          issuing_authority: value("authority") || undefined,
          amount_iqd:
            type === "wage_increase" && value("amount") ? Number(value("amount")) : undefined,
          notes: value("notes") || undefined,
          attachment: file
            ? { file_name: file.name, file_size: file.size, mime_type: file.type as SupportedMime }
            : undefined,
        },
      });
      if (file && created.filePath) {
        try {
          setUploadPercent(0);
          await uploadAttachment(created.filePath, file, setUploadPercent);
          setUploadPercent(100);
        } catch (uploadError) {
          try {
            await deleteDocument({ data: { id: created.id } });
          } catch {
            await onChanged();
            throw new Error(
              `تعذر إكمال الرفع وتنظيف السجل. راجع الأرشيف قبل إعادة المحاولة. ${formatErrorMessage(uploadError)}`,
            );
          }
          throw uploadError;
        }
      }
      toast.success("تم إدراج المستند في الأرشيف");
      await onChanged();
      onClose();
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر حفظ المستند"));
    } finally {
      setBusy(false);
    }
  };
  const candidates = lookup.valid && !lookup.waiting ? (directory.data ?? []) : [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? "إضافة كتاب لهذا الموظف" : "إدراج مستند إداري"}</DialogTitle>
          <DialogDescription>سجّل بيانات الكتاب وأرفق نسخة منه عند توفرها.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy} className="grid gap-5 sm:grid-cols-2">
            {employee ? (
              <p className="rounded-lg border p-3 sm:col-span-2">
                {employee.full_name} · {employee.employee_no}
              </p>
            ) : (
              <div className={`${fieldClass} sm:col-span-2`}>
                <Label htmlFor="archive-person">الموظف</Label>
                <Popover
                  open={pickerOpen}
                  onOpenChange={(open) => {
                    setPickerOpen(open);
                    if (!open) setSearch("");
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      id="archive-person"
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={pickerOpen}
                      aria-required="true"
                      className="min-h-10 justify-between font-normal"
                    >
                      <span className="truncate">
                        {person ? `${person.full_name} · ${person.employee_no}` : "اختر موظفًا"}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-70" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    dir="rtl"
                    align="start"
                    className="w-[--radix-popover-trigger-width] p-0"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        value={search}
                        onValueChange={setSearch}
                        maxLength={100}
                        placeholder="الاسم أو الرقم الوظيفي"
                      />
                      <CommandList>
                        <CommandEmpty>
                          {!lookup.valid
                            ? "اكتب حرفين أو رقمين على الأقل."
                            : lookup.waiting || directory.isFetching
                              ? "جارٍ البحث…"
                              : directory.isError
                                ? "تعذر البحث عن الموظفين."
                                : "لا توجد نتائج مطابقة."}
                        </CommandEmpty>
                        <CommandGroup>
                          {candidates.map((item) => (
                            <CommandItem
                              key={item.id}
                              value={item.id}
                              onSelect={() => {
                                setPerson(item);
                                setPickerOpen(false);
                                setSearch("");
                              }}
                            >
                              <Check
                                className={`h-4 w-4 shrink-0 ${person?.id === item.id ? "opacity-100" : "opacity-0"}`}
                              />
                              <span className="break-words">
                                {item.full_name} · {item.employee_no}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <div className={fieldClass}>
              <Label htmlFor="archive-type">نوع المستند</Label>
              <select
                id="archive-type"
                value={type}
                className={selectClass}
                onChange={(event) => setType(event.target.value as EmployeeDocumentType)}
              >
                {employeeDocumentTypes.map((key) => (
                  <option key={key} value={key}>
                    {documentTypeLabels[key]}
                  </option>
                ))}
              </select>
            </div>
            <div className={fieldClass}>
              <Label htmlFor="archive-number">رقم الكتاب</Label>
              <Input id="archive-number" name="number" maxLength={120} required />
            </div>
            <div className={fieldClass}>
              <Label htmlFor="archive-date">تاريخ الصدور</Label>
              <Input
                id="archive-date"
                name="date"
                type="date"
                defaultValue={todayInBaghdad()}
                required
              />
            </div>
            <div className={fieldClass}>
              <Label htmlFor="archive-effective">تاريخ السريان</Label>
              <Input id="archive-effective" name="effective" type="date" />
            </div>
            <div className={`${fieldClass} sm:col-span-2`}>
              <Label htmlFor="archive-title">الموضوع</Label>
              <Input id="archive-title" name="title" maxLength={240} required />
            </div>
            <div className={fieldClass}>
              <Label htmlFor="archive-authority">الجهة المصدرة</Label>
              <Input id="archive-authority" name="authority" maxLength={160} />
            </div>
            {type === "wage_increase" && (
              <div className={fieldClass}>
                <Label htmlFor="archive-amount">مبلغ الزيادة (د.ع)</Label>
                <Input
                  id="archive-amount"
                  name="amount"
                  type="number"
                  min="0"
                  max="999999999999.99"
                  step="0.01"
                />
              </div>
            )}
            <div className={`${fieldClass} sm:col-span-2`}>
              <Label htmlFor="archive-notes">الملحوظات</Label>
              <Textarea id="archive-notes" name="notes" maxLength={4000} rows={3} />
            </div>
            <div
              className={`${fieldClass} rounded-lg border border-dashed p-4 sm:col-span-2`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!busy) chooseFile(event.dataTransfer.files[0]);
              }}
            >
              <Label htmlFor="archive-file">اسحب المرفق هنا أو اختر ملفاً</Label>
              <Input
                id="archive-file"
                type="file"
                accept={employeeDocumentMimeTypes.join(",")}
                onChange={(event) => {
                  chooseFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <p className="text-sm text-muted-foreground">
                PDF أو JPEG أو PNG أو WebP. الحد 15 ميغابايت.
              </p>
              {file && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all text-sm">{file.name}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setFile(null)}>
                    إزالة المرفق
                  </Button>
                </div>
              )}
            </div>
          </fieldset>
          {uploadPercent !== null && (
            <div className="mt-4 space-y-2" role="status">
              <p className="text-sm">رفع المرفق · {uploadPercent}%</p>
              <Progress value={uploadPercent} aria-label="تقدم رفع المرفق" />
            </div>
          )}
          <DialogFooter className="mt-5 gap-2">
            <Button variant="outline" type="button" disabled={busy} onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" disabled={busy || !person}>
              {busy ? "جارٍ الحفظ…" : "حفظ المستند"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
