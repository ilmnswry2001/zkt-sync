import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Fingerprint,
  Building2,
  Upload,
  ClockIcon,
  FileBox,
  LogOut,
  ShieldCheck,
  CalendarDays,
  CalendarRange,
  MapPinned,
  Wallet,
  Truck,
  FileSignature,
  FileWarning,
  BarChart3,
  Settings2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Menu,
  X,
  ClipboardCheck,
  UserCog,
  UserCircle2,
  Smartphone,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, access: "executive" },
  { to: "/attendance", label: "التقارير اليومية", icon: ClockIcon },
  { to: "/tasks", label: "مهامي اليومية", icon: ClipboardCheck },
  { to: "/self-attendance", label: "الحضور الذاتي", icon: Smartphone },
  { to: "/team-follow-up", label: "متابعة الفريق", icon: Users },
  { to: "/projects", label: "تكلفة المواقع اليومية", icon: Wallet, access: "hr" },
  { to: "/monthly", label: "التقرير الشهري", icon: CalendarDays },
  { to: "/forms", label: "الاستمارات الإلكترونية", icon: FileSignature },
  { to: "/penalties", label: "العقوبات والتغييب", icon: FileWarning },
  { to: "/employees", label: "الموظفون", icon: Users },
  { to: "/departments", label: "الأقسام", icon: Building2 },
  { to: "/project-plans", label: "خطط المشاريع", icon: CalendarRange, access: "project_plans" },
  { to: "/planning", label: "الخطط وتكلفة المشاريع", icon: BarChart3, access: "planning" },
  { to: "/sites", label: "المواقع", icon: MapPinned, access: "planning" },
  { to: "/wages", label: "الأجور", icon: Wallet, access: "hr" },
  { to: "/payroll", label: "الرواتب", icon: Wallet, access: "hr" },
  { to: "/vehicles", label: "المركبات", icon: Truck, access: "hr" },
  { to: "/devices", label: "الأجهزة", icon: Fingerprint },
  { to: "/upload", label: "رفع ملفات البصمة", icon: Upload },
  { to: "/files", label: "سجل الملفات", icon: FileBox },
  { to: "/settings", label: "الإعدادات", icon: Settings2, access: "admin" },
  { to: "/accounts", label: "الحسابات والصلاحيات", icon: UserCog, access: "admin" },
] as const;

export const SECTION_OPTIONS = nav.map(({ to, label }) => ({ to, label }));

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, profileName, roles, isAdmin, isHR, isCompanyManager, signOut, canAccessSection, allowedSections, permissionsLoading, permissionError } = useAuth();
  const navigate = useNavigate();
  const blocked =
    !permissionsLoading &&
    !!allowedSections &&
    pathname !== "/profile" &&
    !allowedSections.some((p) => pathname === p || pathname.startsWith(p + "/") || (p === "/planning" && pathname === "/project-plans"));
  useEffect(() => {
    if (blocked && allowedSections?.[0]) navigate({ to: allowedSections[0] as any });
  }, [blocked, allowedSections, navigate]);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("zkt-sidebar-hidden") !== "true";
  });
  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      const next = !open;
      window.localStorage.setItem("zkt-sidebar-hidden", String(!next));
      return next;
    });
  };

  const currentPage = nav.find((item) => pathname === item.to || pathname.startsWith(item.to + "/"));
  return (
    <div dir="rtl" className="app-shell flex min-h-screen bg-background">
      {sidebarOpen && <button aria-label="إغلاق القائمة" className="fixed inset-0 z-30 bg-slate-950/45 backdrop-blur-sm md:hidden" onClick={toggleSidebar} />}
      <aside
        className={cn(
          "app-sidebar fixed inset-y-0 right-0 z-40 flex w-[min(19rem,88vw)] shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 md:sticky md:top-0 md:h-screen md:w-64 md:translate-x-0 md:shadow-none",
          sidebarOpen ? "translate-x-0" : "translate-x-full md:w-0 md:border-0",
        )}
        aria-hidden={!sidebarOpen}
      >
        <div className="border-b border-sidebar-border bg-gradient-to-br from-sidebar-accent/20 to-transparent p-5 flex items-center justify-between min-w-64">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-300 to-cyan-500 flex items-center justify-center shadow-lg shadow-teal-950/30">
              <Fingerprint className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">منظومة زِكت</h1>
              <p className="text-[11px] opacity-60">إدارة الموارد والمشاريع</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            title="إخفاء اللوحة الجانبية"
            aria-label="إخفاء اللوحة الجانبية"
          >
            <X className="w-4 h-4 md:hidden" /><PanelRightClose className="hidden w-4 h-4 md:block" />
          </Button>
        </div>
        <nav className="flex-1 space-y-1.5 overflow-y-auto p-3 min-w-64">
          {nav.map((item) => {
            if (!canAccessSection(item.to)) return null;
            if ("access" in item && item.access === "admin" && !isAdmin) return null;
            if ("access" in item && item.access === "hr" && !isHR) return null;
            if ("access" in item && item.access === "executive" && !isAdmin && !isCompanyManager) return null;
            if ("access" in item && item.access === "planning" && !isAdmin && !isHR && !roles.some((role) => ["supervisor", "department_manager"].includes(role))) return null;
            if ("access" in item && item.access === "project_plans" && !isAdmin && !isHR && !roles.some((role) => ["supervisor", "department_manager", "engineer", "site_admin"].includes(role))) return null;
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as any}
                onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false); }}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold transition-all",
                  active
                    ? "bg-gradient-to-l from-teal-300 to-cyan-400 text-slate-950 shadow-md shadow-black/15"
                    : "text-sidebar-foreground/75 hover:bg-white/8 hover:text-white",
                )}
              >
                <Icon className="w-4 h-4 shrink-0 transition-transform group-hover:scale-110" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2 min-w-64">
          <div className="px-3 py-2 text-xs">
            <div className="font-semibold truncate">{profileName || user?.user_metadata?.full_name || "صاحب الحساب"}</div>
            <div className="flex gap-1 mt-1 flex-wrap">
              {roles.map((role) => (
                <span
                  key={role}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sidebar-accent/30 text-[10px]"
                >
                  <ShieldCheck className="w-3 h-3" /> {role}
                </span>
              ))}
              {isAdmin && <span className="text-[10px] opacity-70">مدير</span>}
            </div>
          </div>
          <Link
            to="/profile"
            className="flex w-full items-center justify-start gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-border/40"
          >
            <UserCircle2 className="w-4 h-4" /> الملف الشخصي
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-border/40"
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth" });
            }}
          >
            <LogOut className="w-4 h-4 ml-2" /> تسجيل الخروج
          </Button>
        </div>
      </aside>
      <main className="app-main min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[1500px] p-4 sm:p-6 xl:p-8">
          <header className="mb-7 flex items-center justify-between gap-4 rounded-2xl border border-white/70 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="outline" size="icon" className="md:hidden" onClick={toggleSidebar} aria-label="فتح القائمة"><Menu className="h-4 w-4" /></Button>
              {!sidebarOpen && <Button variant="outline" size="icon" className="hidden md:inline-flex" onClick={toggleSidebar} aria-label="فتح القائمة"><PanelRightOpen className="h-4 w-4" /></Button>}
              <div className="min-w-0"><p className="text-[11px] font-semibold text-muted-foreground">مساحة العمل <span className="mx-1 text-primary">/</span> الإدارة</p><h2 className="truncate text-base font-bold sm:text-lg">{currentPage?.label || "الملف الشخصي"}</h2></div>
            </div>
            <div className="hidden items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 text-xs font-semibold text-primary sm:flex"><Sparkles className="h-4 w-4" /> نظام إدارة موحد</div>
          </header>
          {permissionError ? (
            <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              تعذر التحقق من صلاحيات الحساب. أعد تحميل الصفحة، وإذا استمرت المشكلة تواصل مع مدير النظام.
            </div>
          ) : blocked && !allowedSections?.length ? (
            <div role="alert" className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">لا توجد واجهات مخصصة لهذا الحساب. تواصل مع مدير النظام لتحديث صلاحياتك.</div>
          ) : blocked ? null : children}
        </div>
      </main>
    </div>
  );
}
