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
  FileSignature,
  FileWarning,
  BarChart3,
  Settings2,
  PanelRightClose,
  PanelRightOpen,
  ClipboardCheck,
  UserCog,
  UserCircle2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, access: "executive" },
  { to: "/attendance", label: "التقارير اليومية", icon: ClockIcon },
  { to: "/tasks", label: "مهامي اليومية", icon: ClipboardCheck },
  { to: "/team-follow-up", label: "متابعة الفريق", icon: Users },
  { to: "/company-report", label: "تقرير الشركة الكامل", icon: BarChart3, access: "hr" },
  { to: "/projects", label: "المشاريع", icon: MapPinned, access: "hr" },
  { to: "/monthly", label: "التقرير الشهري", icon: CalendarDays },
  { to: "/forms", label: "الاستمارات الإلكترونية", icon: FileSignature },
  { to: "/penalties", label: "العقوبات والتغييب", icon: FileWarning },
  { to: "/employees", label: "الموظفون", icon: Users },
  { to: "/departments", label: "الأقسام", icon: Building2 },
  { to: "/planning", label: "التخطيط", icon: CalendarRange },
  { to: "/sites", label: "المواقع", icon: MapPinned },
  { to: "/wages", label: "الأجور", icon: Wallet, access: "hr" },
  { to: "/payroll", label: "الرواتب", icon: Wallet, access: "hr" },  { to: "/devices", label: "الأجهزة", icon: Fingerprint },
  { to: "/upload", label: "رفع ملفات البصمة", icon: Upload },
  { to: "/files", label: "سجل الملفات", icon: FileBox },
  { to: "/settings", label: "الإعدادات", icon: Settings2, access: "admin" },
  { to: "/accounts", label: "الحسابات والصلاحيات", icon: UserCog, access: "admin" },
] as const;

export const SECTION_OPTIONS = nav.map(({ to, label }) => ({ to, label }));

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, roles, isAdmin, isHR, isCompanyManager, signOut, canAccessSection, allowedSections, permissionsLoading } = useAuth();
  const navigate = useNavigate();
  const blocked =
    !permissionsLoading &&
    !!allowedSections &&
    pathname !== "/profile" &&
    !allowedSections.some((p) => pathname === p || pathname.startsWith(p + "/"));
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

  return (
    <div dir="rtl" className="min-h-screen flex bg-background">
      <aside
        className={cn(
          "shrink-0 bg-sidebar text-sidebar-foreground flex flex-col border-l border-sidebar-border transition-[width] duration-200 overflow-hidden",
          sidebarOpen ? "w-64" : "w-0 border-0",
        )}
        aria-hidden={!sidebarOpen}
      >
        <div className="p-4 border-b border-sidebar-border flex items-center justify-between min-w-64">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sidebar-accent flex items-center justify-center">
              <Fingerprint className="w-5 h-5 text-sidebar-accent-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg">نظام الحضور</h1>
              <p className="text-xs opacity-70">ZKTeco Attendance</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            title="إخفاء اللوحة الجانبية"
            aria-label="إخفاء اللوحة الجانبية"
          >
            <PanelRightClose className="w-4 h-4" />
          </Button>
        </div>
        <nav className="flex-1 p-3 space-y-1 min-w-64">
          {nav.map((item) => {
            if (!canAccessSection(item.to)) return null;
            if ("access" in item && item.access === "admin" && !isAdmin) return null;
            if ("access" in item && item.access === "hr" && !isHR) return null;
            if ("access" in item && item.access === "executive" && !isAdmin && !isCompanyManager) return null;
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as any}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-border/40",
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2 min-w-64">
          <div className="px-3 py-2 text-xs">
            <div className="font-semibold truncate">{user?.email}</div>
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
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto">
          {!sidebarOpen && (
            <Button
              variant="outline"
              size="icon"
              onClick={toggleSidebar}
              title="إظهار اللوحة الجانبية"
              aria-label="إظهار اللوحة الجانبية"
              className="mb-4"
            >
              <PanelRightOpen className="w-4 h-4" />
            </Button>
          )}
          {blocked ? null : children}
        </div>
      </main>
    </div>
  );
}
