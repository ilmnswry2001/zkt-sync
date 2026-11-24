import { direction, ui } from "@/lib/ui-language";
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
import {
  mobileAgentBundle,
  mobileAgentFile,
  mobileApk,
  mobileOperators,
  mobileVersion,
} from "@/lib/mobile-sync";
import {
  configureMobileSync,
  listMobileSyncDevices,
  listMobileSyncHistory,
} from "@/lib/mobile-sync.functions";

export const Route = createFileRoute("/_authenticated/mobile-sync")({
  head: () => ({ meta: [{ title: ui("سحب البصمة بالهاتف | إدارة الحضور") }] }),
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

  if (permissionsLoading) return <p role="status">{ui("جارٍ التحقق من الصلاحيات…")}</p>;
  if (!canUse) return <p role="alert">{ui("لا تملك صلاحية استخدام المزامنة الميدانية.")}</p>;

  return (
    <section dir={direction()} aria-label={ui("سحب البصمة بالهاتف")} className="space-y-5">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-5" />{ui(" وكيل البصمة لأندرويد")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild>
              <a href={mobileApk} download>
                <Download className="size-4" />{ui(" تحميل التطبيق ")}<bdi>{mobileVersion}</bdi>
              </a>
            </Button>
            <ol className="list-decimal space-y-2 ps-5 text-sm leading-6 text-muted-foreground">
              <li>{ui("نزّل ملف إعداد جميع الأجهزة من النظام واستورده في الوكيل.")}</li>
              <li>{ui("اتصل بشبكة تستطيع الوصول منها إلى أجهزة البصمة.")}</li>
              <li>{ui("اسحب حركات الجهاز المحدد أو اضغط «سحب الحركات من كل الأجهزة». تُرفع الحركات عند توفر الإنترنت.")}</li>
            </ol>
          </CardContent>
        </Card>
        {isAdmin && <AgentSettings key={user?.id} />}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{ui("آخر 30 دفعة ميدانية")}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isPending ? (
            <p role="status">{ui("جارٍ جلب السجل…")}</p>
          ) : history.isError ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert">{ui(formatErrorMessage(history.error, "تعذر تحميل سجل المزامنة"))}</p>
              <Button variant="outline" onClick={() => void history.refetch()}>{ui("إعادة المحاولة")}</Button>
            </div>
          ) : !history.data.length ? (
            <p className="text-sm text-muted-foreground">{ui("لا توجد دفعات ميدانية مسجلة.")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ui("المشرف")}</TableHead>
                  <TableHead>{ui("الجهاز")}</TableHead>
                  <TableHead>{ui("وقت السحب")}</TableHead>
                  <TableHead>{ui("الحركات المستلمة")}</TableHead>
                  <TableHead>{ui("الحضور المضاف")}</TableHead>
                  <TableHead>{ui("الحالة")}</TableHead>
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
                        {batch.mobile_status === "failed" ? ui("تعذرت المعالجة") : ui("تمت المعالجة")}
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
    mutationFn: async (action: "provision" | "provision_all" | "revoke") => {
      if (action !== "revoke" && window.location.protocol !== "https:")
        throw new Error("افتح النظام عبر HTTPS لتنزيل ملف الوكيل");
      const operator_email = email.trim() || undefined;
      const result = await configureMobileSync({
        data:
          action === "provision_all"
            ? { action, operator_email }
            : { action, device_id: device, operator_email },
      });
      if (!result) return toast.success(ui("أُلغي تصريح الوكيل للحساب والجهاز المحددين"));
      const file = Array.isArray(result)
        ? mobileAgentBundle(result, window.location.origin)
        : mobileAgentFile(result, window.location.origin);
      const url = URL.createObjectURL(new Blob([file], { type: "application/json" }));
      const download = document.createElement("a");
      download.href = url;
      download.download = Array.isArray(result)
        ? "zkteco-mobile-agent-all-devices.json"
        : "zkteco-mobile-agent.json";
      download.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      if (Array.isArray(result)) toast.success((ui("تم تجهيز ملف إعداد ") + (result.length) + ui(" جهاز")));
    },
    onError: (error) => toast.error(ui(formatErrorMessage(error, "تعذر تحديث إعداد الوكيل"))),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileDown className="size-5" />{ui(" إعداد وكيل الهاتف")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 leading-6">
          <Label htmlFor="device-search">{ui("بحث باسم الجهاز")}</Label>
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
          <Label htmlFor="mobile-device">{ui("جهاز البصمة")}</Label>
          <Select
            value={device}
            onValueChange={(value) => {
              setDevice(value);
            }}
            disabled={configure.isPending || !devices.data?.length}
          >
            <SelectTrigger id="mobile-device">
              <SelectValue
                placeholder={devices.isPending ? ui("جارٍ جلب الأجهزة…") : ui("اختر جهازًا نشطًا")}
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
            <p role="alert" className="text-sm text-destructive">{ui("تعذر جلب الأجهزة.")}</p>
          ) : (
            devices.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">{ui("لا توجد أجهزة مطابقة برقم تسلسلي وعنوان شبكة محلية.")}</p>
            )
          )}
          <Label htmlFor="operator-email">{ui("بريد المشرف المسجّل")}{" "}
            <span className="text-muted-foreground">{ui("(اتركه فارغًا للربط بحسابك)")}</span>
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
          <Button disabled={configure.isPending} onClick={() => configure.mutate("provision_all")}>
            <Download className="size-4" />{ui(" تنزيل ملف إعداد الوكيل لكل الأجهزة")}</Button>
          <Button
            variant="outline"
            disabled={!device || configure.isPending}
            onClick={() => configure.mutate("provision")}
          >{ui("تنزيل ملف إعداد الوكيل")}</Button>
          <Button
            variant="outline"
            disabled={!device || configure.isPending}
            onClick={() => configure.mutate("revoke")}
          >{ui("إلغاء تصريح الوكيل لهذا الجهاز")}</Button>
        </div>
        <p className="text-sm text-muted-foreground">{ui("يشمل الملف المجمّع كل جهاز نشط له رقم تسلسلي وعنوان شبكة محلية صالح. سلّم الملف للمشرف المعني فقط. التصاريح صالحة لمدة 30 يومًا.")}</p>
      </CardContent>
    </Card>
  );
}
