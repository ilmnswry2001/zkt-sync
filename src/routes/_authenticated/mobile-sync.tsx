import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download, QrCode, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
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
import { encryptMobilePairing, mobileApk, mobileOperators, mobileVersion } from "@/lib/mobile-sync";
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
              <Smartphone className="size-5" /> تطبيق أندرويد الميداني
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild>
              <a href={mobileApk} download>
                <Download className="size-4" /> تحميل التطبيق <bdi>{mobileVersion}</bdi>
              </a>
            </Button>
            <ol className="list-decimal space-y-2 ps-5 text-sm leading-6 text-muted-foreground">
              <li>اتصل بشبكة الواي فاي أو نقطة الاتصال التي يتصل بها جهاز البصمة.</li>
              <li>امسح رمز الربط في التطبيق وأدخل رمز الفتح الظاهر في صفحة الربط.</li>
              <li>
                اضغط «فحص الاتصال وسحب الحركات الآن». تُحفظ الحركات في الهاتف إلى أن تتوفر تغطية
                إنترنت للرفع.
              </li>
            </ol>
          </CardContent>
        </Card>
        {isAdmin && <PairDevice key={user?.id} />}
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

function PairDevice() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [device, setDevice] = useState("");
  const [email, setEmail] = useState("");
  const [pairing, setPairing] = useState<{ qr: string; code: string; until: number } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setPairing(null), Math.max(0, pairing.until - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);
  const devices = useQuery({
    queryKey: ["mobile-sync-devices", term],
    queryFn: ({ signal }) => listMobileSyncDevices({ signal, data: { search: term } }),
  });
  const configure = useMutation({
    mutationFn: async (action: "pair" | "revoke") => {
      if (action === "pair" && (window.location.protocol !== "https:" || !crypto.subtle))
        throw new Error("افتح النظام عبر HTTPS لإنشاء رمز الربط");
      const result = await configureMobileSync({
        data: { action, device_id: device, operator_email: email.trim() || undefined },
      });
      if (!result) return null;
      const until = Date.now() + 5 * 60_000;
      return {
        ...(await encryptMobilePairing({
          ...result,
          server_url: window.location.origin,
          pair_until: until,
        })),
        until,
      };
    },
    onSuccess: (result) => {
      setPairing(result);
      if (!result) toast.success("أُلغي ربط الهاتف بالحساب والجهاز المحددين");
    },
    onError: (error) => toast.error(formatErrorMessage(error, "تعذر تحديث ربط الهاتف")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="size-5" /> ربط الجهاز بالمشرف
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
              setPairing(null);
            }}
            disabled={configure.isPending}
          />
          <Label htmlFor="mobile-device">جهاز البصمة</Label>
          <Select
            value={device}
            onValueChange={(value) => {
              setDevice(value);
              setPairing(null);
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
              setPairing(null);
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!device || configure.isPending}
            onClick={() => configure.mutate("pair")}
          >
            إنشاء رمز الربط
          </Button>
          <Button
            variant="outline"
            disabled={!device || configure.isPending}
            onClick={() => configure.mutate("revoke")}
          >
            إلغاء ربط الحساب بهذا الجهاز
          </Button>
        </div>
        {pairing && (
          <div className="grid justify-items-center gap-3 rounded-lg border p-4 text-center">
            <QRCodeSVG
              value={pairing.qr}
              level="M"
              marginSize={4}
              size={336}
              className="h-auto max-w-full"
              title="رمز ربط الجهاز بالهاتف"
            />
            <p className="text-sm">
              رمز الفتح <bdi className="font-mono text-lg font-semibold">{pairing.code}</bdi>
            </p>
            <p className="text-sm text-muted-foreground">
              امسح الرمز وأدخل رمز الفتح خلال خمس دقائق. ربط الهاتف صالح لمدة 30 يومًا.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(pairing.qr);
                  toast.success("تم نسخ الرمز المشفّر. الصقه في الإدخال اليدوي بالتطبيق.");
                } catch {
                  toast.error("تعذر نسخ الرمز تلقائيًا. حدّد النص وانسخه من حقل رمز الربط.");
                }
              }}
            >
              نسخ رمز الربط المشفّر
            </Button>
            <details className="w-full text-start text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                عرض رمز الربط النصي
              </summary>
              <Input
                className="mt-2 font-mono"
                readOnly
                dir="ltr"
                aria-label="رمز الربط المشفّر"
                value={pairing.qr}
                onFocus={(event) => event.currentTarget.select()}
              />
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
