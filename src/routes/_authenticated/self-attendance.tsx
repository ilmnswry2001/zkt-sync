import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { enqueueSelfAttendance, readSelfAttendanceQueue, removeQueuedSelfAttendance, type QueuedSelfAttendance } from "@/lib/self-attendance-queue";
import { FaceCameraDialog } from "@/components/FaceCameraDialog";
import { getAttendancePushKey, saveAttendancePushSubscription } from "@/lib/push.functions";
import { createForm } from "@/lib/forms.functions";
import {
  CheckCircle2,
  Clock3,
  Crosshair,
  LogIn,
  LogOut,
  MapPin,
  Smartphone,
  Wifi,
  WifiOff,
  Settings2,
} from "lucide-react";

type DbResult = { data: unknown; error: { message: string } | null };
type DbQuery = {
  select: (columns: string) => DbQuery;
  eq: (column: string, value: string) => DbQuery;
  gte: (column: string, value: string) => DbQuery;
  lt: (column: string, value: string) => DbQuery;
  order: (column: string, options?: { ascending?: boolean }) => Promise<DbResult>;
  maybeSingle: () => Promise<DbResult>;
};
type DbClient = { from: (table: string) => DbQuery };
type SelfAttendanceRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: SelfAttendanceResult[] | null; error: { message: string } | null }>;
};
type Site = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number;
};
type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  position: string | null;
  site_id: string | null;
  sites: Site | null;
  face_descriptor: number[] | null;
};
type AttendanceLog = {
  id: string;
  verify_time: string;
  self_event_type: "check_in" | "check_out" | null;
  verify_type: number | null;
  status: number | null;
  distance_meters: number | null;
  source: string | null;
};
type SelfAttendanceResult = {
  id: string;
  employee_id: string;
  recorded_at: string;
  event_type: "check_in" | "check_out";
  distance_meters: number;
  site_name: string;
};
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const Route = createFileRoute("/_authenticated/self-attendance")({
  head: () => ({
    meta: [
      { title: "الحضور الذاتي | حضوري الذكي" },
      { name: "description", content: "تسجيل الحضور والانصراف من الهاتف مع التحقق من موقع العمل." },
    ],
  }),
  component: SelfAttendancePage,
});

function baghdadDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(date);
}
function baghdadTime(date = new Date()) {
  return new Intl.DateTimeFormat("ar-IQ", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}
function baghdadMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}
function minutesFromTime(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}
function formatMinutes(value: number) {
  return `${Math.floor(value / 60).toLocaleString("ar-IQ")} س ${String(value % 60).padStart(2, "0").toLocaleString("ar-IQ")} د`;
}
function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const radius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.asin(Math.sqrt(value));
}

function SelfAttendancePage() {
  const { user, isAdmin } = useAuth();
  const [now, setNow] = useState(new Date());
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationLoading, setLocationLoading] = useState(false);
  const [recording, setRecording] = useState<"check_in" | "check_out" | null>(null);
  const [faceCameraOpen, setFaceCameraOpen] = useState(false);
  const [pendingEventType, setPendingEventType] = useState<"check_in" | "check_out" | null>(null);
  const [coordinates, setCoordinates] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [allowedSites, setAllowedSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [siteLatitude, setSiteLatitude] = useState("");
  const [siteLongitude, setSiteLongitude] = useState("");
  const [siteRadius, setSiteRadius] = useState("200");
  const [siteSaving, setSiteSaving] = useState(false);
  const [latestCheckInTime, setLatestCheckInTime] = useState("");
  const [latestCheckOutTime, setLatestCheckOutTime] = useState("");
  const [checkInGraceHours, setCheckInGraceHours] = useState(0);
  const [attendanceSettingsSaving, setAttendanceSettingsSaving] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [selfForms, setSelfForms] = useState<{ id: string; form_no: number; kind: "overtime" | "early_exit"; status: string; overtime_hours: number; check_out: string | null; rejection_reason: string | null }[]>([]);
  const [earlyExitReason, setEarlyExitReason] = useState("");
  const [overtimeReason, setOvertimeReason] = useState("");
  const [selfFormSaving, setSelfFormSaving] = useState(false);
  const getPushKey = useServerFn(getAttendancePushKey);
  const savePushSubscription = useServerFn(saveAttendancePushSubscription);
  const submitForm = useServerFn(createForm);

  const today = baghdadDate(now);
  const measuredSites = coordinates
    ? allowedSites
        .filter((item) => item.latitude != null && item.longitude != null)
        .map((item) => ({
          site: item,
          distance: haversineMeters(coordinates.latitude, coordinates.longitude, item.latitude!, item.longitude!),
        }))
        .sort((a, b) => a.distance - b.distance)
    : [];
  const closestSite = measuredSites.find(({ site: item, distance: meters }) => meters <= item.geofence_radius_meters)
    ?? measuredSites[0]
    ?? null;
  const site = closestSite?.site ?? allowedSites.find((item) => item.id === employee?.site_id) ?? allowedSites[0] ?? null;
  const distance = closestSite?.distance ?? null;
  const insideGeofence =
    distance != null && site != null && distance <= site.geofence_radius_meters;
  const checkedIn = logs.some((log) => log.self_event_type === "check_in" || log.status === 0);
  const checkedOut = logs.some(
    (log) => log.self_event_type === "check_out" || log.status === 1,
  );
  const overtimeMinutes = latestCheckOutTime
    ? Math.max(0, baghdadMinutes(now) - minutesFromTime(latestCheckOutTime))
    : 0;
  const overtimeHoursAvailable = Math.floor(overtimeMinutes / 30) / 2;
  const hasActiveOvertimeForm = selfForms.some((form) => form.kind === "overtime" && form.status !== "rejected");
  const earlyExitForms = selfForms.filter((form) => form.kind === "early_exit");
  const overtimeForms = selfForms.filter((form) => form.kind === "overtime");

  const loadAttendance = async () => {
    if (!user) return;
    setLoading(true);
    const client = supabase as unknown as DbClient;
    const employeeResult = await client
      .from("employees")
      .select(
        "id, employee_no, full_name, position, site_id, face_descriptor, sites!site_id(id, name, latitude, longitude, geofence_radius_meters)",
      )
      .eq("email", user.email ?? "")
      .eq("status", "active")
      .maybeSingle();
    if (employeeResult.error) {
      toast.error(`تعذر قراءة بيانات الموظف: ${formatErrorMessage(employeeResult.error)}`);
      setLoading(false);
      return;
    }
    const nextEmployee = employeeResult.data as Employee | null;
    setEmployee(nextEmployee);
    setAllowedSites([]);
    if (!nextEmployee) {
      setLoading(false);
      return;
    }
    const accessClient = supabase as any;
    const [accessResult, assignedSitesResult] = await Promise.all([
      accessClient.from("employee_self_attendance_access").select("allow_all_sites, check_in_grace_hours").eq("employee_id", nextEmployee.id).maybeSingle(),
      accessClient.from("employee_self_attendance_sites").select("site_id").eq("employee_id", nextEmployee.id),
    ]);
    if (accessResult.error || assignedSitesResult.error) {
      toast.error(`تعذر قراءة مواقع الحضور المسموحة: ${formatErrorMessage(accessResult.error ?? assignedSitesResult.error)}`);
      setLoading(false);
      return;
    }
    const allowAllSites = Boolean(accessResult.data?.allow_all_sites);
    setCheckInGraceHours(Number(accessResult.data?.check_in_grace_hours ?? 0));
    const assignedSiteIds = (assignedSitesResult.data ?? []).map((row: { site_id: string }) => row.site_id);
    if (allowAllSites || assignedSiteIds.length) {
      let sitesQuery = accessClient.from("sites").select("id, name, latitude, longitude, geofence_radius_meters").order("name");
      if (!allowAllSites) sitesQuery = sitesQuery.in("id", assignedSiteIds);
      const { data: permittedSites, error: permittedSitesError } = await sitesQuery;
      if (permittedSitesError) {
        toast.error(`تعذر تحميل المواقع المسموحة: ${formatErrorMessage(permittedSitesError)}`);
        setLoading(false);
        return;
      }
      setAllowedSites((permittedSites ?? []) as Site[]);
    } else {
      setAllowedSites(nextEmployee.sites ? [nextEmployee.sites] : []);
    }
    const start = `${today}T00:00:00+03:00`;
    const end = `${today}T23:59:59+03:00`;
    const logsResult = await client
      .from("attendance_logs")
      .select("id, verify_time, self_event_type, verify_type, status, distance_meters, source")
      .eq("employee_id", nextEmployee.id)
      .gte("verify_time", start)
      .lt("verify_time", end)
      .order("verify_time", { ascending: true });
    if (logsResult.error) toast.error(`تعذر قراءة حالة حضور اليوم: ${formatErrorMessage(logsResult.error)}`);
    setLogs((logsResult.data ?? []) as AttendanceLog[]);
    const { data: formRows, error: formsError } = await (supabase as any)
      .from("forms")
      .select("id, form_no, kind, status, overtime_hours, check_out, rejection_reason")
      .eq("employee_id", nextEmployee.id)
      .eq("work_date", today)
      .in("kind", ["overtime", "early_exit"])
      .order("created_at", { ascending: false });
    if (formsError) toast.error(`تعذر تحميل طلباتك: ${formatErrorMessage(formsError)}`);
    setSelfForms((formRows ?? []) as typeof selfForms);
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  useEffect(() => {
    void loadAttendance();
    // loadAttendance يعتمد على اليوم والحساب الحاليين، ويُعاد تشغيله عند تغيّرهما فقط.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, today]);
  const flushOfflineQueue = async () => {
    if (!user || !navigator.onLine) return;
    const queued = await readSelfAttendanceQueue();
    setQueuedCount(queued.length);
    for (const item of queued) {
      const path = `${user.id}/${item.id}.jpg`;
      const upload = await supabase.storage.from("attendance-selfies").upload(path, item.selfie, { contentType: "image/jpeg", upsert: true });
      if (upload.error) break;
      const rpc = supabase as unknown as SelfAttendanceRpc;
      const { error } = await rpc.rpc("record_mobile_self_attendance", {
        p_event_type: item.eventType, p_latitude: item.latitude, p_longitude: item.longitude,
        p_accuracy_meters: item.accuracy, p_client_recorded_at: item.clientRecordedAt,
        p_selfie_path: path, p_submitted_offline: true,
        p_face_score: item.faceScore,
        p_liveness_verified: item.livenessVerified,
        p_client_event_id: item.id,
        p_device_info: { user_agent: navigator.userAgent, platform: navigator.platform, offline_queue_id: item.id },
      });
      if (error) { toast.error(`تعذر إرسال حركة محفوظة: ${formatErrorMessage(error)}`); break; }
      await removeQueuedSelfAttendance(item.id);
    }
    const remaining = await readSelfAttendanceQueue();
    setQueuedCount(remaining.length);
    if (queued.length && remaining.length < queued.length) { toast.success("تم إرسال الحركات المحفوظة دون اتصال"); await loadAttendance(); }
  };
  useEffect(() => {
    void readSelfAttendanceQueue().then((items) => setQueuedCount(items.length)).catch(() => undefined);
    const online = () => { void flushOfflineQueue(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
    // flush uses the authenticated user and the shared query client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    const handler = (event: Event) => setInstallPrompt(event as BeforeInstallPromptEvent);
    window.addEventListener("beforeinstallprompt", handler);
    setIsIos(
      /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
        !(
          "standalone" in window.navigator &&
          (window.navigator as Navigator & { standalone?: boolean }).standalone
        ),
    );
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      const { data, error } = await (supabase as any)
        .from("sites")
        .select("id, name, latitude, longitude, geofence_radius_meters")
        .order("name");
      if (error) return toast.error(`تعذر تحميل المواقع: ${formatErrorMessage(error)}`);
      const nextSites = (data ?? []) as Site[];
      setSites(nextSites);
      if (nextSites.length && !selectedSiteId) setSelectedSiteId(nextSites[0].id);
    })();
  }, [isAdmin, selectedSiteId]);
  useEffect(() => {
    void (async () => {
      const { data, error } = await (supabase as any)
        .from("self_attendance_settings")
        .select("latest_check_in_time, latest_check_out_time")
        .eq("id", true)
        .maybeSingle();
      if (error) return toast.error(`تعذر تحميل أوقات الحضور الذاتي: ${formatErrorMessage(error)}`);
      setLatestCheckInTime(data?.latest_check_in_time?.slice(0, 5) ?? "");
      setLatestCheckOutTime(data?.latest_check_out_time?.slice(0, 5) ?? "");
    })();
  }, []);
  const selectedSite = sites.find((item) => item.id === selectedSiteId) ?? null;
  const sitesWithoutCoordinates = sites.filter(
    (item) => item.latitude == null || item.longitude == null,
  ).length;
  useEffect(() => {
    if (!selectedSite) return;
    setSiteLatitude(selectedSite.latitude == null ? "" : String(selectedSite.latitude));
    setSiteLongitude(selectedSite.longitude == null ? "" : String(selectedSite.longitude));
    setSiteRadius(String(selectedSite.geofence_radius_meters));
  }, [selectedSite, selectedSiteId]);

  const refreshLocation = () => {
    if (!navigator.geolocation) return toast.error("المتصفح لا يدعم تحديد الموقع");
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setLocationLoading(false);
        toast.success("تم تحديث موقعك الحالي");
      },
      (error) => {
        setLocationLoading(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? "اسمح للمتصفح بالوصول إلى موقعك أولاً"
            : "تعذر قراءة موقعك الحالي",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  useEffect(() => {
    if (!employee?.id || !navigator.geolocation) return;
    setLocationLoading(true);
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setLocationLoading(false);
      },
      (error) => {
        setLocationLoading(false);
        if (error.code === error.PERMISSION_DENIED) {
          setCoordinates(null);
          toast.error("اسمح للمتصفح بالوصول إلى موقعك لتسجيل الحضور تلقائياً");
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [employee?.id]);

  const recordAttendance = async (eventType: "check_in" | "check_out") => {
    const deadline = eventType === "check_in" ? latestCheckInTime : latestCheckOutTime;
    const currentMinutes = baghdadMinutes(now);
    const allowedMinutes = deadline
      ? minutesFromTime(deadline) + (eventType === "check_in" ? checkInGraceHours * 60 : 0)
      : null;
    if (deadline && allowedMinutes != null && currentMinutes > allowedMinutes) {
      const lateMinutes = currentMinutes - allowedMinutes;
      const graceMessage = eventType === "check_in" && checkInGraceHours > 0
        ? ` والمهلة الخاصة بك ${checkInGraceHours.toLocaleString("ar-IQ")} ساعة`
        : "";
      return toast.error(
        `تعذر التسجيل: الوقت الآن ${baghdadTime(now)} والحد العام ${deadline}${graceMessage}. تجاوزت آخر وقت مسموح بـ ${formatMinutes(lateMinutes)}. استخدم تبويب الوقت الإضافي إذا كان تسجيلك للعمل بعد الدوام.`,
      );
    }
    if (!employee || !site) return toast.error("لا يوجد موقع عمل مخصص لهذا الموظف");
    if (!coordinates) return toast.error("حدّث موقعك قبل تسجيل الحركة");
    if (!insideGeofence)
      return toast.error(
        `لا يمكن التسجيل، أنت تبعد ${Math.round(distance ?? 0)} متراً عن موقع العمل`,
      );
    if (eventType === "check_in" && checkedIn)
      return toast.error("تم تسجيل حضورك لهذا اليوم بالفعل");
    if (eventType === "check_out" && (!checkedIn || checkedOut))
      return toast.error(
        checkedOut ? "تم تسجيل انصرافك لهذا اليوم بالفعل" : "لا يمكن الانصراف قبل تسجيل الحضور",
      );
    if (!employee.face_descriptor || employee.face_descriptor.length !== 128) {
      return toast.error("بصمة الوجه غير مسجلة لهذا الموظف. راجع الموارد البشرية لتسجيلها أولاً");
    }
    setPendingEventType(eventType);
    setFaceCameraOpen(true);
  };

  const requestEarlyExit = async () => {
    if (!employee || !checkedIn) return toast.error("يجب تسجيل الحضور أولاً قبل طلب الخروج المبكر");
    if (!latestCheckOutTime) return toast.error("لم تحدد الإدارة وقت نهاية الدوام");
    if (baghdadMinutes(now) >= minutesFromTime(latestCheckOutTime)) return toast.error("انتهى وقت الدوام؛ لم يعد طلب الخروج المبكر متاحاً");
    if (earlyExitReason.trim().length < 3) return toast.error("اكتب سبب طلب الخروج المبكر");
    setSelfFormSaving(true);
    try {
      const currentParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
      const getPart = (type: string) => currentParts.find((item) => item.type === type)?.value ?? "00";
      await submitForm({ data: {
        employee_id: employee.id, target_department_id: null, work_date: today,
        kind: "early_exit", day_status: null, overtime_hours: 0,
        check_in: null, check_out: `${getPart("hour")}:${getPart("minute")}`,
        reason: earlyExitReason.trim(),
      } });
      setEarlyExitReason("");
      toast.success("أُرسل طلب الخروج المبكر إلى مدير القسم ثم مدير الشركة");
      await loadAttendance();
    } catch (error) {
      toast.error(`تعذر إرسال الطلب: ${formatErrorMessage(error)}`);
    } finally {
      setSelfFormSaving(false);
    }
  };

  const requestOvertime = async () => {
    if (!employee) return toast.error("تعذر تحديد ملف الموظف");
    if (!latestCheckOutTime) return toast.error("لم تحدد الإدارة وقت نهاية الدوام؛ لا يمكن تسجيل وقت إضافي");
    const elapsedMinutes = baghdadMinutes(now) - minutesFromTime(latestCheckOutTime);
    const hours = Math.floor(elapsedMinutes / 30) / 2;
    if (hours < 0.5) return toast.error("يتاح تسجيل الوقت الإضافي بعد نهاية الدوام بنصف ساعة على الأقل");
    if (overtimeReason.trim().length < 3) return toast.error("اكتب وصف العمل الإضافي");
    if (selfForms.some((form) => form.kind === "overtime" && form.status !== "rejected")) return toast.error("يوجد طلب وقت إضافي لهذا اليوم قيد الإجراء أو معتمد");
    setSelfFormSaving(true);
    try {
      await submitForm({ data: {
        employee_id: employee.id, target_department_id: null, work_date: today,
        kind: "overtime", day_status: null, overtime_hours: hours,
        check_in: null, check_out: null, reason: overtimeReason.trim(),
      } });
      setOvertimeReason("");
      toast.success(`أُرسل طلب الوقت الإضافي (${hours.toLocaleString("ar-IQ")} ساعة) للموافقة`);
      await loadAttendance();
    } catch (error) {
      toast.error(`تعذر إرسال طلب الوقت الإضافي: ${formatErrorMessage(error)}`);
    } finally {
      setSelfFormSaving(false);
    }
  };

  const submitVerifiedAttendance = async (
    eventType: "check_in" | "check_out",
    selfie: Blob,
    faceScore: number,
    livenessVerified: boolean,
  ) => {
    if (faceScore < 75 || !livenessVerified) {
      setRecording(null);
      return toast.error("لم يكتمل التحقق من مطابقة الوجه والحيوية");
    }
    if (!coordinates) {
      setRecording(null);
      return toast.error("حدّث موقعك قبل تسجيل الحركة");
    }
    setRecording(eventType);
    const queueItem: QueuedSelfAttendance = {
      id: crypto.randomUUID(), eventType, latitude: coordinates.latitude, longitude: coordinates.longitude,
      accuracy: coordinates.accuracy, clientRecordedAt: new Date().toISOString(), selfie, faceScore, livenessVerified,
    };
    const saveForLater = async () => {
      await enqueueSelfAttendance(queueItem);
      setQueuedCount((count) => count + 1);
      toast.success("حُفظت الحركة والصورة لإرسالها تلقائياً عند عودة الإنترنت");
    };
    if (!navigator.onLine) {
      try {
        await saveForLater();
      } catch { toast.error("تعذر حفظ الحركة دون اتصال؛ لا تغلق الصفحة وحاول مجدداً"); }
      setRecording(null);
      return;
    }
    const selfiePath = `${user?.id}/${queueItem.id}.jpg`;
    const uploaded = await supabase.storage.from("attendance-selfies").upload(selfiePath, selfie, { contentType: "image/jpeg", upsert: true });
    if (uploaded.error) {
      setRecording(null);
      if (!navigator.onLine) { await saveForLater(); return; }
      return toast.error(`تعذر حفظ صورة التحقق: ${formatErrorMessage(uploaded.error)}`);
    }
    const rpc = supabase as unknown as SelfAttendanceRpc;
    const { data, error } = await rpc.rpc("record_mobile_self_attendance", {
      p_event_type: eventType,
      p_latitude: coordinates.latitude,
      p_longitude: coordinates.longitude,
      p_accuracy_meters: coordinates.accuracy,
      p_client_recorded_at: queueItem.clientRecordedAt,
      p_selfie_path: selfiePath,
      p_submitted_offline: false,
      p_client_event_id: queueItem.id,
      p_face_score: faceScore,
      p_liveness_verified: livenessVerified,
      p_device_info: {
        user_agent: navigator.userAgent,
        platform: navigator.platform,
        accuracy_meters: coordinates.accuracy,
      },
    });
    setRecording(null);
    if (error) {
      if (!navigator.onLine) { await saveForLater(); return; }
      return toast.error(formatErrorMessage(error));
    }
    const result = data?.[0];
    if (!result?.id) return toast.error("رُفضت الحركة بسبب انتقال غير منطقي وسُجلت للمراجعة الإدارية");
    toast.success(eventType === "check_in" ? "تم تسجيل حضورك بنجاح" : "تم تسجيل انصرافك بنجاح");
    await loadAttendance();
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };
  const enablePushNotifications = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return toast.error("المتصفح لا يدعم الإشعارات الفورية");
    if (Notification.permission === "denied") return toast.error("الإشعارات محظورة من إعدادات المتصفح");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return toast.error("لم يتم السماح بالإشعارات");
    const { publicKey } = await getPushKey();
    if (!publicKey) return toast.error("إعداد الإشعارات غير مكتمل لدى الإدارة");
    const registration = await navigator.serviceWorker.register("/sw.js");
    const key = publicKey.replace(/-/g, "+").replace(/_/g, "/");
    const applicationServerKey = Uint8Array.from(atob(key.padEnd(Math.ceil(key.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    await savePushSubscription({ data: subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } } });
    toast.success("تم تفعيل تذكيرات الدوام على هذا الجهاز");
  };
  const updateSelectedSite = async (
    latitude: number | null = Number(siteLatitude),
    longitude: number | null = Number(siteLongitude),
  ) => {
    if (!selectedSiteId) return toast.error("اختر الموقع أولاً");
    const radius = Number(siteRadius);
    if (
      latitude == null ||
      !Number.isFinite(latitude) ||
      longitude == null ||
      !Number.isFinite(longitude)
    )
      return toast.error("أدخل إحداثيات صحيحة");
    if (!Number.isFinite(radius) || radius < 25 || radius > 5000)
      return toast.error("نصف القطر يجب أن يكون بين 25 و5000 متر");
    setSiteSaving(true);
    const { data, error } = await (supabase as any)
      .from("sites")
      .update({ latitude, longitude, geofence_radius_meters: Math.round(radius) })
      .eq("id", selectedSiteId)
      .select("id, name, latitude, longitude, geofence_radius_meters")
      .single();
    setSiteSaving(false);
    if (error) return toast.error(`تعذر حفظ إعدادات الموقع: ${formatErrorMessage(error)}`);
    setSites((current) =>
      current.map((item) => (item.id === selectedSiteId ? (data as Site) : item)),
    );
    toast.success("تم حفظ إعدادات موقع العمل");
  };

  const saveAttendanceSettings = async () => {
    setAttendanceSettingsSaving(true);
    const { error } = await (supabase as any).from("self_attendance_settings").upsert({
      id: true,
      latest_check_in_time: latestCheckInTime || null,
      latest_check_out_time: latestCheckOutTime || null,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    });
    setAttendanceSettingsSaving(false);
    if (error) return toast.error(`تعذر حفظ أوقات الحضور: ${formatErrorMessage(error)}`);
    toast.success("تم حفظ حدود وقت تسجيل الحضور والانصراف");
  };
  const pinCurrentSite = () => {
    if (!navigator.geolocation) return toast.error("المتصفح لا يدعم تحديد الموقع");
    setSiteSaving(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSiteLatitude(String(position.coords.latitude));
        setSiteLongitude(String(position.coords.longitude));
        void updateSelectedSite(position.coords.latitude, position.coords.longitude);
      },
      () => setSiteSaving(false),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  const statusText = useMemo(() => {
    if (checkedOut) return "تم تسجيل الانصراف اليوم";
    if (checkedIn) return "تم تسجيل الحضور اليوم";
    return "لم يتم تسجيل الحضور بعد";
  }, [checkedIn, checkedOut]);

  if (loading)
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Clock3 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  return (
    <div dir="rtl" className="mx-auto max-w-2xl space-y-5 pb-8">
      {(installPrompt || isIos) && (
        <Card className="border-cyan-200 bg-cyan-50/80">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold">ثبّت التطبيق على شاشتك الرئيسية لتسجيل الحضور بسهولة</p>
              <p className="text-sm text-muted-foreground">
                {isIos
                  ? "في Safari اضغط زر المشاركة ثم اختر إضافة إلى الشاشة الرئيسية."
                  : "ثبّت حضوري الذكي للوصول السريع من هاتفك."}
              </p>
            </div>
            {installPrompt && <Button onClick={() => void install()}>تثبيت الآن</Button>}
          </CardContent>
        </Card>
      )}
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 p-6 text-white shadow-xl sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <Badge className="border-white/20 bg-white/10 text-white">
            <Smartphone className="ml-1.5 h-3.5 w-3.5" /> حضوري الذكي
          </Badge>
          <Wifi className="h-5 w-5 text-cyan-300" />
        </div>
        <p className="mt-6 text-sm text-slate-300">التوقيت الرسمي — بغداد</p>
        <p className="mt-1 text-5xl font-bold tracking-tight sm:text-6xl">{baghdadTime(now)}</p>
        <p className="mt-2 text-sm text-slate-300">{today}</p>
      </section>
      {queuedCount > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">لديك {queuedCount} حركة محفوظة دون اتصال؛ ستُرسل تلقائياً عند عودة الإنترنت.</p>}
      <Tabs defaultValue="attendance" dir="rtl">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="attendance">تسجيل الحضور</TabsTrigger>
          <TabsTrigger value="overtime"><Clock3 className="ml-2 h-4 w-4" /> الوقت الإضافي</TabsTrigger>
          <TabsTrigger value="early-exit"><LogOut className="ml-2 h-4 w-4" /> طلب خروج مبكر</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="settings">
              <Settings2 className="ml-2 h-4 w-4" /> الإعدادات
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="attendance" className="space-y-5">
          {!employee ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                لا يوجد سجل موظف نشط مرتبط بحسابك. اطلب من الموارد البشرية ربط البريد الإلكتروني
                بملف الموظف.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3">
                    <span>{employee.full_name}</span>
                    <span className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => void enablePushNotifications()}>تفعيل التذكيرات</Button><Badge variant={checkedOut ? "secondary" : checkedIn ? "default" : "outline"}>{statusText}</Badge></span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <span className="text-muted-foreground">الرقم الوظيفي</span>
                    <p className="font-semibold">{employee.employee_no}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">الموقع المعتمد</span>
                    <p className="font-semibold">{site?.name ?? "غير محدد"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">المنصب</span>
                    <p className="font-semibold">{employee.position ?? "غير محدد"}</p>
                  </div>
                </CardContent>
              </Card>
              <Card
                className={
                  insideGeofence
                    ? "border-emerald-300 bg-emerald-50/60"
                    : "border-rose-300 bg-rose-50/60"
                }
              >
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    {insideGeofence ? (
                      <Crosshair className="mt-0.5 h-6 w-6 text-emerald-600" />
                    ) : (
                      <WifiOff className="mt-0.5 h-6 w-6 text-rose-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {insideGeofence
                          ? `أنت داخل نطاق موقع العمل (ضمن ${Math.round(distance ?? 0)} متراً)`
                          : distance != null
                            ? `أنت خارج نطاق موقع العمل (تبعد ${Math.round(distance)} متراً)`
                            : "لم يتم تحديد موقعك بعد"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        دقة GPS الحالية:{" "}
                        {coordinates ? `${Math.round(coordinates.accuracy)} متر` : "غير متاحة"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={refreshLocation}
                      disabled={locationLoading}
                    >
                      {locationLoading ? "جارٍ التحديث" : "تحديث موقعي الآن"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <div className="grid gap-4 sm:grid-cols-2">
                <Button
                  className="h-20 bg-emerald-600 text-lg hover:bg-emerald-700"
                  disabled={!insideGeofence || (coordinates?.accuracy ?? 999) > 100 || checkedIn || recording !== null || faceCameraOpen}
                  onClick={() => void recordAttendance("check_in")}
                >
                  <LogIn className="ml-3 h-7 w-7" />
                  {recording === "check_in" ? "جارٍ التسجيل..." : faceCameraOpen && pendingEventType === "check_in" ? "جارٍ التحقق من الوجه..." : "تسجيل حضور (دخول)"}
                </Button>
                <Button
                  className="h-20 bg-orange-600 text-lg hover:bg-orange-700"
                  disabled={!insideGeofence || (coordinates?.accuracy ?? 999) > 100 || !checkedIn || checkedOut || recording !== null || faceCameraOpen}
                  onClick={() => void recordAttendance("check_out")}
                >
                  <LogOut className="ml-3 h-7 w-7" />
                  {recording === "check_out" ? "جارٍ التسجيل..." : faceCameraOpen && pendingEventType === "check_out" ? "جارٍ التحقق من الوجه..." : "تسجيل انصراف (خروج)"}
                </Button>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" /> حركات اليوم
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {logs.length ? (
                    logs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between rounded-lg border p-3 text-sm"
                      >
                        <span>
                          {log.self_event_type === "check_out" || log.status === 1
                            ? "انصراف"
                            : "حضور"}
                        </span>
                        <span className="font-semibold">
                          {new Date(log.verify_time).toLocaleTimeString("ar-IQ", {
                            timeZone: "Asia/Baghdad",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {log.source === "mobile_self" ? "تسجيل من الهاتف" : "جهاز بصمة"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">لا توجد حركات مسجلة اليوم.</p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
        <TabsContent value="overtime" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" /> تسجيل وقت إضافي</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                لا يتاح الطلب إلا بعد وقت نهاية الدوام ({latestCheckOutTime || "غير محدد"}) بنصف ساعة على الأقل. تُحسب الساعات المكتملة بنصف ساعة وتُرسل للموافقة.
              </p>
              <p className="text-sm font-semibold">الساعات المتاحة الآن: {overtimeHoursAvailable.toLocaleString("ar-IQ")}</p>
              <div className="space-y-2">
                <Label htmlFor="self-overtime-reason">وصف العمل الإضافي</Label>
                <Textarea id="self-overtime-reason" value={overtimeReason} onChange={(event) => setOvertimeReason(event.target.value)} minLength={3} maxLength={1000} rows={3} placeholder="اكتب وصف العمل الذي أنجزته بعد الدوام" />
              </div>
              <Button onClick={() => void requestOvertime()} disabled={selfFormSaving || overtimeHoursAvailable < 0.5 || hasActiveOvertimeForm}>
                {selfFormSaving ? "جارٍ الإرسال..." : hasActiveOvertimeForm ? "يوجد طلب لهذا اليوم" : "إرسال طلب الوقت الإضافي"}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>حالة طلبات الوقت الإضافي لليوم</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {overtimeForms.length ? overtimeForms.map((form) => (
                <div key={form.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <span>استمارة #{form.form_no} · {Number(form.overtime_hours).toLocaleString("ar-IQ")} ساعة</span>
                  <Badge variant={form.status === "executed" ? "default" : form.status === "rejected" ? "destructive" : "secondary"}>
                    {form.status === "pending_manager" ? "بانتظار مدير القسم" : form.status === "pending_ceo" ? "بانتظار مدير الشركة" : form.status === "pending_execution" ? "بانتظار التنفيذ" : form.status === "executed" ? "معتمد" : "مرفوض"}
                  </Badge>
                </div>
              )) : <p className="text-sm text-muted-foreground">لا توجد طلبات وقت إضافي لهذا اليوم.</p>}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="early-exit" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><LogOut className="h-5 w-5" /> طلب خروج قبل نهاية الدوام</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">يُرسل الطلب أولاً إلى مدير قسمك، ثم إلى مدير الشركة. عند الموافقة النهائية يُعتمد اليوم كحضور.</p>
              <p className="text-sm">نهاية الدوام المحددة: <strong>{latestCheckOutTime || "غير محددة"}</strong> · الوقت الحالي: <strong>{baghdadTime(now)}</strong></p>
              <div className="space-y-2">
                <Label htmlFor="early-exit-reason">سبب طلب الخروج</Label>
                <Textarea id="early-exit-reason" value={earlyExitReason} onChange={(event) => setEarlyExitReason(event.target.value)} minLength={3} maxLength={1000} rows={3} placeholder="اذكر سبب طلب المغادرة قبل نهاية الدوام" />
              </div>
              <Button onClick={() => void requestEarlyExit()} disabled={selfFormSaving || !checkedIn || !latestCheckOutTime || baghdadMinutes(now) >= minutesFromTime(latestCheckOutTime) || earlyExitForms.some((form) => form.status !== "rejected")}>
                {selfFormSaving ? "جارٍ الإرسال..." : "إرسال طلب الخروج المبكر"}
              </Button>
              {!checkedIn && <p className="text-sm text-muted-foreground">سجّل حضورك أولاً حتى تتمكن من تقديم الطلب.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>حالة طلبات الخروج المبكر لليوم</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {earlyExitForms.length ? earlyExitForms.map((form) => (
                <div key={form.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <span>استمارة #{form.form_no} · وقت الخروج المطلوب {form.check_out ?? "—"}</span>
                  <Badge variant={form.status === "executed" ? "default" : form.status === "rejected" ? "destructive" : "secondary"}>
                    {form.status === "pending_manager" ? "بانتظار مدير القسم" : form.status === "pending_ceo" ? "بانتظار مدير الشركة" : form.status === "executed" ? "معتمد كحضور" : "مرفوض"}
                  </Badge>
                </div>
              )) : <p className="text-sm text-muted-foreground">لا توجد طلبات خروج مبكر لهذا اليوم.</p>}
            </CardContent>
          </Card>
        </TabsContent>
        {isAdmin && (
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>حدود وقت الحضور والانصراف</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">لن تُقبل الحركة بعد الوقت المحدد. اترك الحقل فارغاً إذا لم ترد وضع حد. تُطبق الأوقات حسب توقيت بغداد.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="latest-check-in-time">آخر وقت مسموح لتسجيل الدخول</Label>
                    <Input id="latest-check-in-time" type="time" value={latestCheckInTime} onChange={(event) => setLatestCheckInTime(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="latest-check-out-time">آخر وقت مسموح لتسجيل الخروج</Label>
                    <Input id="latest-check-out-time" type="time" value={latestCheckOutTime} onChange={(event) => setLatestCheckOutTime(event.target.value)} />
                  </div>
                </div>
                <Button onClick={() => void saveAttendanceSettings()} disabled={attendanceSettingsSaving}>
                  {attendanceSettingsSaving ? "جارٍ الحفظ..." : "حفظ إعدادات الوقت"}
                </Button>
              </CardContent>
            </Card>
            {sitesWithoutCoordinates > 0 && (
              <Card className="border-rose-300 bg-rose-50/70 text-rose-900">
                <CardContent className="p-4">
                  <p className="font-semibold">
                    {sitesWithoutCoordinates} مواقع بدون إحداثيات
                  </p>
                  <p className="mt-1 text-sm">
                    أكمل إحداثيات هذه المواقع حتى يتمكن موظفوها من تسجيل الحضور الجغرافي.
                  </p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>تحديد موقع العمل الجغرافي</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>الموقع</Label>
                  <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الموقع" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((item) => {
                        const missingCoordinates = item.latitude == null || item.longitude == null;
                        return (
                          <SelectItem key={item.id} value={item.id}>
                            <span className="flex items-center gap-2">
                              {item.name}
                              {missingCoordinates && (
                                <span className="font-semibold text-rose-600">— بدون إحداثيات</span>
                              )}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="site-latitude">خط العرض</Label>
                    <Input
                      id="site-latitude"
                      type="number"
                      step="any"
                      value={siteLatitude}
                      onChange={(event) => setSiteLatitude(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="site-longitude">خط الطول</Label>
                    <Input
                      id="site-longitude"
                      type="number"
                      step="any"
                      value={siteLongitude}
                      onChange={(event) => setSiteLongitude(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="site-radius">نصف قطر الأمان بالمتر</Label>
                    <Input
                      id="site-radius"
                      type="number"
                      min="25"
                      max="5000"
                      value={siteRadius}
                      onChange={(event) => setSiteRadius(event.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={pinCurrentSite} disabled={siteSaving || !selectedSiteId}>
                    <MapPin className="ml-2 h-4 w-4" /> تثبيت موقعي الحالي كمقر للموقع
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void updateSelectedSite()}
                    disabled={siteSaving || !selectedSiteId}
                  >
                    حفظ التعديلات اليدوية
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  يسمح النظام بنصف قطر أمان بين 25 و5000 متر، ويطبق التغيير فوراً على تسجيل الحضور
                  الجغرافي.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
      {employee?.face_descriptor && <FaceCameraDialog
        open={faceCameraOpen}
        onOpenChange={(open) => {
          setFaceCameraOpen(open);
          if (!open) setPendingEventType(null);
        }}
        mode="verify"
        storedDescriptor={employee.face_descriptor}
        onComplete={({ score, livenessVerified, selfie }) => {
          if (pendingEventType && score != null) void submitVerifiedAttendance(pendingEventType, selfie, score, livenessVerified);
        }}
      />}
    </div>
  );
}
