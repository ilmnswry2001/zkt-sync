import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download, FileDown, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { mobileAgentFile, mobileApk, mobileOperators, mobileVersion } from "@/lib/mobile-sync";
import {
  configureMobileSync,
  listMobileSyncDevices,
  listMobileSyncHistory,
} from "@/lib/mobile-sync.functions";

export const Route = createFileRoute("/_authenticated/mobile-sync")({
  head: () => ({ meta: [{ title: "سحب البصمة بالهاتف | إدارة الحضور" }] }),
  component: MobileSync,
});

const baghdad = new Intl.DateTimeFormat("ar-IQ", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Baghdad",
});

function MobileSync() {
  const { user, roles, isAdmin, permissionsLoading } = useAuth();
  const canUse = roles.some((role) => mobileOperators.some((allowed) => allowed === role));
  const history = useQuery({
    queryKey: ["mobile-sync-history", user?.id],
    queryFn: ({ signal }) => listMobileSyncHistory({ signal }),
    enabled: !!user && canUse,
    refetchInterval: 30_000,
  });

  if (permissionsLoading) return <p role="status">جارٍ التحقق من الصلاحيات…</p>;
  if (!canUse) return <p role="alert">لا تملك صلاحية استخدام المزامنة الميدانية.</p>;

  return (
    <section dir="rtl" aria-label="سحب البصمة بالهاتف" className="space-y-5">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-5" /> وكيل البصمة لأندرويد
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild>
              <a href={mobileApk} download>
                <Download className="size-4" /> تحميل التطبيق <bdi>{mobileVersion}</bdi>
              </a>
            </Button>
            <ol className="list-decimal space-y-2 ps-5 text-sm leading-6 text-muted-foreground">
              <li>نزّل ملف إعداد لكل جهاز من النظام واستورد الملفات في الوكيل.</li>
              <li>اتصل بشبكة تستطيع الوصول منها إلى أجهزة البصمة.</li>
              <li>
                اسحب حركات الجهاز المحدد أو اضغط «سحب الحركات من كل الأجهزة». تُرفع الحركات عند توفر الإنترنت.
              </li>
            </ol>
          </CardContent>
        </Card>
        {isAdmin && <AgentSettings key={user?.id} />}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>آخر 30 دفعة ميدانية</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isPending ? (
            <p role="status">جارٍ جلب السجل…</p>
          ) : history.isError ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert">{formatErrorMessage(history.error, "تعذر تحميل سجل المزامنة")}</p>
              <Button variant="outline" onClick={() => void history.refetch()}>
                إعادة المحاولة
              </Button>
            </div>
          ) : !history.data.length ? (
            <p className="text-sm text-muted-foreground">لا توجد دفعات ميدانية مسجلة.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المشرف</TableHead>
                  <TableHead>الجهاز</TableHead>
                  <TableHead>وقت السحب</TableHead>
                  <TableHead>الحركات المستلمة</TableHead>
                  <TableHead>الحضور المضاف</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell>{batch.mobile_operator_name ?? "—"}</TableCell>
                    <TableCell>{batch.device?.name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {baghdad.format(new Date(batch.mobile_pulled_at ?? batch.received_at))}
                    </TableCell>
                    <TableCell>{batch.record_count}</TableCell>
                    <TableCell>{batch.inserted_count}</TableCell>
                    <TableCell>
                      <Badge
                        variant={batch.mobile_status === "failed" ? "destructive" : "secondary"}
                      >
                        {batch.mobile_status === "failed" ? "تعذرت المعالجة" : "تمت المعالجة"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function AgentSettings() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [device, setDevice] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const devices = useQuery({
    queryKey: ["mobile-sync-devices", term],
    queryFn: ({ signal }) => listMobileSyncDevices({ signal, data: { search: term } }),
  });
  const configure = useMutation({
    mutationFn: async (action: "provision" | "revoke") => {
      if (action === "provision" && window.location.protocol !== "https:")
        throw new Error("افتح النظام عبر HTTPS لتنزيل ملف الوكيل");
      const result = await configureMobileSync({
        data: { action, device_id: device, operator_email: email.trim() || undefined },
      });
      if (!result) return toast.success("أُلغي تصريح الوكيل للحساب والجهاز المحددين");
      const file = mobileAgentFile(result, window.location.origin);
      const url = URL.createObjectURL(new Blob([file], { type: "application/json" }));
      const download = document.createElement("a");
      download.href = url;
      download.download = "zkteco-mobile-agent.json";
      download.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onError: (error) => toast.error(formatErrorMessage(error, "تعذر تحديث إعداد الوكيل")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileDown className="size-5" /> إعداد وكيل الهاتف
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 leading-6">
          <Label htmlFor="device-search">بحث باسم الجهاز</Label>
          <Input
            id="device-search"
            value={search}
            maxLength={80}
            onChange={(event) => {
              setSearch(event.target.value);
              setDevice("");
            }}
            disabled={configure.isPending}
          />
          <Label htmlFor="mobile-device">جهاز البصمة</Label>
          <Select
            value={device}
            onValueChange={(value) => {
              setDevice(value);
            }}
            disabled={configure.isPending || !devices.data?.length}
          >
            <SelectTrigger id="mobile-device">
              <SelectValue
                placeholder={devices.isPending ? "جارٍ جلب الأجهزة…" : "اختر جهازًا نشطًا"}
              />
            </SelectTrigger>
            <SelectContent>
              {devices.data?.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} · <bdi>{item.serial_number}</bdi>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {devices.isError ? (
            <p role="alert" className="text-sm text-destructive">
              تعذر جلب الأجهزة.
            </p>
          ) : (
            devices.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                لا توجد أجهزة مطابقة برقم تسلسلي وعنوان شبكة محلية.
              </p>
            )
          )}
          <Label htmlFor="operator-email">
            بريد المشرف المسجّل{" "}
            <span className="text-muted-foreground">(اتركه فارغًا للربط بحسابك)</span>
          </Label>
          <Input
            id="operator-email"
            dir="ltr"
            type="email"
            maxLength={254}
            value={email}
            disabled={configure.isPending}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!device || configure.isPending}
            onClick={() => configure.mutate("provision")}
          >
            تنزيل ملف إعداد الوكيل
          </Button>
          <Button
            variant="outline"
            disabled={!device || configure.isPending}
            onClick={() => configure.mutate("revoke")}
          >
            إلغاء تصريح الوكيل لهذا الجهاز
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          يتضمن الملف تصريحًا خاصًا بالحساب والجهاز صالحًا لمدة 30 يومًا. سلّمه للمشرف المعني فقط.
        </p>
      </CardContent>
    </Card>
  );
}
