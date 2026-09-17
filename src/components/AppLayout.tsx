import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, Fingerprint, Building2, Upload, ClockIcon, FileBox, LogOut, ShieldCheck, CalendarDays, MapPinned, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
  { to: "/attendance", label: "التقارير اليومية", icon: ClockIcon },
  { to: "/monthly", label: "التقرير الشهري", icon: CalendarDays },
  { to: "/employees", label: "الموظفون", icon: Users },
  { to: "/departments", label: "الأقسام", icon: Building2 },
  { to: "/planning", label: "التخطيط والمواقع", icon: MapPinned },
  { to: "/wages", label: "الأجور والمكافآت", icon: Wallet },
  { to: "/devices", label: "الأجهزة", icon: Fingerprint },
  { to: "/upload", label: "رفع ملفات البصمة", icon: Upload },
  { to: "/files", label: "سجل الملفات", icon: FileBox },
] as const;

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, roles, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div dir="rtl" className="min-h-screen flex bg-background">
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col border-l border-sidebar-border">
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sidebar-accent flex items-center justify-center">
              <Fingerprint className="w-5 h-5 text-sidebar-accent-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg">نظام الحضور</h1>
              <p className="text-xs opacity-70">ZKTeco Attendance</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
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
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <div className="px-3 py-2 text-xs">
            <div className="font-semibold truncate">{user?.email}</div>
            <div className="flex gap-1 mt-1 flex-wrap">
              {roles.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sidebar-accent/30 text-[10px]">
                  <ShieldCheck className="w-3 h-3" /> {r}
                </span>
              ))}
              {isAdmin && <span className="text-[10px] opacity-70">مدير</span>}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-border/40"
            onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
          >
            <LogOut className="w-4 h-4 ml-2" /> تسجيل الخروج
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
