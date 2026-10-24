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
  CalendarDays,
  CalendarRange,
  MapPinned,
  Wallet,
  Truck,
  Wrench,
  FileSignature,
  FileWarning,
  Fuel,
  Settings2,
  Sparkles,
  Menu,
  X,
  ClipboardCheck,
  UserCog,
  UserCircle2,
  Smartphone,
  Boxes,
  ShoppingCart,
  ClipboardList,
  ListChecks,
  CalendarCheck2,
  Moon,
  Sun,
  Bell,
  ChevronDown,
  SlidersHorizontal,
  Network,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOperationalAlerts } from "@/hooks/use-operational-alerts";
import { supabase } from "@/integrations/supabase/client";
import { NavigationCustomizer } from "@/components/NavigationCustomizer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const nav = [
  { to: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, access: "executive" },
  { to: "/attendance", label: "التقارير اليومية", icon: ClockIcon },
  { to: "/shift-schedules", label: "جداول الورديات", icon: CalendarDays, access: "hr" },
  { to: "/tasks", label: "مهامي اليومية", icon: ClipboardCheck },
  { to: "/self-attendance", label: "الحضور الذاتي", icon: Smartphone },
  { to: "/work-center", label: "مركز العمل", icon: ListChecks },
  { to: "/leaves", label: "إدارة الإجازات", icon: CalendarCheck2, access: "leave" },
  { to: "/team-follow-up", label: "متابعة الفريق", icon: Users },
  { to: "/projects", label: "تكلفة المشاريع", icon: Wallet, access: "hr" },
  { to: "/monthly", label: "التقرير الشهري", icon: CalendarDays },
  { to: "/forms", label: "الاستمارات الإلكترونية", icon: FileSignature },
  { to: "/penalties", label: "العقوبات والتغييب", icon: FileWarning },
  { to: "/employees", label: "الموظفون", icon: Users },
  { to: "/departments", label: "الأقسام", icon: Building2 },
  { to: "/planning", label: "الخطط", icon: ClipboardList, access: "planning" },
  { to: "/requests", label: "الطلبات", icon: ClipboardList, access: "requests" },
  { to: "/procurement", label: "المشتريات", icon: ShoppingCart, access: "procurement" },
  { to: "/sites", label: "المواقع", icon: MapPinned, access: "planning" },
  { to: "/wages", label: "الأجور", icon: Wallet, access: "hr" },
  { to: "/payroll", label: "الرواتب", icon: Wallet, access: "hr" },
  { to: "/vehicles", label: "المركبات", icon: Truck, access: "hr" },
  { to: "/fuel", label: "إدارة الوقود", icon: Fuel, access: "hr" },
  { to: "/maintenance", label: "الصيانة", icon: Wrench, access: "maintenance" },
  { to: "/warehouses", label: "المخازن", icon: Boxes },
  { to: "/devices", label: "الأجهزة", icon: Fingerprint },
  { to: "/upload", label: "رفع ملفات البصمة", icon: Upload },
  { to: "/files", label: "سجل الملفات", icon: FileBox },
  { to: "/safety", label: "السلامة والبلاغات", icon: ShieldAlert },
  { to: "/settings", label: "الإعدادات", icon: Settings2, access: "admin" },
  { to: "/accounts", label: "الحسابات والصلاحيات", icon: UserCog, access: "admin" },
  { to: "/system-map", label: "خريطة النظام", icon: Network, access: "admin" },
] as const;

export const SECTION_OPTIONS = nav.map(({ to, label }) => ({ to, label }));

type NavItem = (typeof nav)[number];

const NAV_GROUPS = [
  { key: "home", label: "الرئيسية", icon: LayoutDashboard, tos: ["/dashboard", "/monthly"] },
  {
    key: "attendance",
    label: "الحضور والدوام",
    icon: ClockIcon,
    tos: ["/attendance", "/self-attendance", "/shift-schedules"],
  },
  {
    key: "tasks",
    label: "المهام والفريق",
    icon: ListChecks,
    tos: ["/tasks", "/work-center", "/team-follow-up", "/forms"],
  },
  {
    key: "hr",
    label: "الموارد البشرية",
    icon: Users,
    tos: ["/employees", "/departments", "/leaves", "/penalties", "/wages", "/payroll"],
  },
  { key: "vehicles", label: "المركبات والوقود", icon: Truck, tos: ["/vehicles", "/fuel"] },
  { key: "maintenance", label: "الصيانة", icon: Wrench, tos: ["/maintenance"] },
  { key: "safety", label: "السلامة والبلاغات", icon: ShieldAlert, tos: ["/safety"] },
  {
    key: "projects",
    label: "المشاريع والخطط",
    icon: ClipboardList,
    tos: ["/planning", "/sites", "/projects", "/requests"],
  },
  { key: "procurement", label: "المشتريات", icon: ShoppingCart, tos: ["/procurement"] },
  {
    key: "inventory",
    label: "المخازن والأجهزة",
    icon: Boxes,
    tos: ["/warehouses", "/devices", "/upload", "/files"],
  },
  {
    key: "settings",
    label: "الإعدادات",
    icon: Settings2,
    tos: ["/settings", "/accounts", "/system-map"],
  },
] as const;

const EMPTY_NAV_CONFIG = {
  labels: {} as Record<string, string>,
  assignments: {} as Record<string, string>,
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const {
    user,
    profileName,
    roles,
    isAdmin,
    isHR,
    isCompanyManager,
    isMaintenanceStaff,
    signOut,
    canAccessSection,
    allowedSections,
    permissionsLoading,
    permissionError,
  } = useAuth();
  const navigate = useNavigate();
  const operationalAlertsQuery = useOperationalAlerts();
  const operationalAlerts = operationalAlertsQuery.data ?? [];
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [hasLinkedEmployee, setHasLinkedEmployee] = useState(false);
  useEffect(() => {
    let current = true;
    if (!user?.email) {
      setHasLinkedEmployee(false);
      return () => {
        current = false;
      };
    }
    const email = user.email.replace(/[\\%_]/g, "\\$&");
    supabase
      .from("employees")
      .select("id, email")
      .eq("status", "active")
      .ilike("email", email)
      .limit(2)
      .then(({ data, error }) => {
        if (!current) return;
        setHasLinkedEmployee(
          !error &&
            (data ?? []).filter(
              (employee) => employee.email?.toLowerCase() === user.email!.toLowerCase(),
            ).length === 1,
        );
      });
    return () => {
      current = false;
    };
  }, [user?.email]);
  const canViewOperationalAlerts =
    isAdmin || isHR || isCompanyManager || roles.includes("department_manager");
  const blocked =
    !permissionsLoading &&
    !!allowedSections &&
    pathname !== "/profile" &&
    !allowedSections.some(
      (p) =>
        pathname === p ||
        pathname.startsWith(p + "/") ||
        (p === "/planning" && pathname === "/project-plans"),
    );
  useEffect(() => {
    if (blocked && allowedSections?.[0]) navigate({ to: allowedSections[0] as any });
  }, [blocked, allowedSections, navigate]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [workspaceName, setWorkspaceName] = useState("منظومة زِكت");
  const [isEditingWorkspaceName, setIsEditingWorkspaceName] = useState(false);
  useEffect(() => {
    const savedSidebar = window.localStorage.getItem("zkt-sidebar-collapsed-v2");
    setSidebarCollapsed(savedSidebar === null ? true : savedSidebar === "true");
    const savedWorkspaceName = window.localStorage.getItem("zkt-workspace-name");
    if (savedWorkspaceName?.trim()) setWorkspaceName(savedWorkspaceName.trim());
    const savedTheme = window.localStorage.getItem("zkt-theme");
    const theme = savedTheme === "dark" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", theme === "dark");
    setThemeMode(theme);
  }, []);
  const toggleTheme = () => {
    const next = themeMode === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    window.localStorage.setItem("zkt-theme", next);
    setThemeMode(next);
  };
  const saveWorkspaceName = () => {
    const nextName = workspaceName.trim() || "منظومة زِكت";
    setWorkspaceName(nextName);
    window.localStorage.setItem("zkt-workspace-name", nextName);
    setIsEditingWorkspaceName(false);
  };
  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem("zkt-sidebar-collapsed-v2", String(next));
      window.localStorage.removeItem("zkt-sidebar-hidden");
      return next;
    });
  };

  const currentPage = nav.find(
    (item) =>
      pathname === item.to ||
      pathname.startsWith(item.to + "/") ||
      (item.to === "/planning" && pathname === "/project-plans"),
  );
  const visibleNav = nav.filter((item) => {
    if (!canAccessSection(item.to)) return false;
    if ("access" in item && item.access === "admin" && !isAdmin) return false;
    if ("access" in item && item.access === "hr" && !isHR) return false;
    if (
      "access" in item &&
      item.access === "leave" &&
      !isAdmin &&
      !isHR &&
      !isCompanyManager &&
      !roles.some((role) => ["department_manager", "data_entry"].includes(role)) &&
      !hasLinkedEmployee
    )
      return false;
    if ("access" in item && item.access === "executive" && !isAdmin && !isCompanyManager)
      return false;
    if (
      "access" in item &&
      item.access === "planning" &&
      !isAdmin &&
      !isHR &&
      !isCompanyManager &&
      !roles.some((role) =>
        ["supervisor", "department_manager", "planning_officer", "engineer", "site_admin"].includes(
          role,
        ),
      )
    )
      return false;
    if (
      "access" in item &&
      item.access === "procurement" &&
      !isAdmin &&
      !isCompanyManager &&
      !roles.includes("procurement_officer")
    )
      return false;
    if (
      "access" in item &&
      item.access === "requests" &&
      !isAdmin &&
      !isHR &&
      !isCompanyManager &&
      !roles.some((role) =>
        [
          "supervisor",
          "department_manager",
          "engineer",
          "site_admin",
          "planning_officer",
          "warehouse_keeper",
          "procurement_officer",
        ].includes(role),
      )
    )
      return false;
    if ("access" in item && item.access === "maintenance" && !isMaintenanceStaff) return false;
    return true;
  });
  const navSettingsQuery = useQuery({
    queryKey: ["navigation-settings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("navigation_settings")
        .select("labels, assignments")
        .eq("id", "default")
        .maybeSingle();
      if (error) throw error;
      return (data ?? EMPTY_NAV_CONFIG) as {
        labels: Record<string, string>;
        assignments: Record<string, string>;
      };
    },
  });
  const navConfig = navSettingsQuery.data ?? EMPTY_NAV_CONFIG;
  const navLabels = navConfig.labels ?? EMPTY_NAV_CONFIG.labels;
  const navAssignments = navConfig.assignments ?? EMPTY_NAV_CONFIG.assignments;
  const baseGroupKeyByTo = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of NAV_GROUPS) for (const to of group.tos) map.set(to, group.key);
    return map;
  }, []);
  const resolveGroupKey = useCallback(
    (to: string) => {
      const assigned = navAssignments[to];
      if (assigned && NAV_GROUPS.some((group) => group.key === assigned)) return assigned;
      return baseGroupKeyByTo.get(to) ?? "";
    },
    [navAssignments, baseGroupKeyByTo],
  );
  const mergedGroups = NAV_GROUPS.map((group) => ({
    key: group.key,
    label: navLabels[group.key]?.trim() || group.label,
    icon: group.icon,
    items: visibleNav.filter((item) => resolveGroupKey(item.to) === group.key),
  })).filter((group) => group.items.length > 0);

  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = window.localStorage.getItem("zkt-nav-groups-v2");
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [];
    } catch {
      return [];
    }
  });
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  useEffect(() => {
    const activeItem = nav.find(
      (item) => pathname === item.to || pathname.startsWith(item.to + "/"),
    );
    if (!activeItem) return;
    const groupKey = resolveGroupKey(activeItem.to);
    if (!groupKey) return;
    setOpenGroups((current) => {
      if (current.includes(groupKey)) return current;
      const next = [...current, groupKey];
      window.localStorage.setItem("zkt-nav-groups-v2", JSON.stringify(next));
      return next;
    });
  }, [pathname, resolveGroupKey]);
  const toggleGroup = (key: string) => {
    setOpenGroups((current) => {
      const next = current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key];
      window.localStorage.setItem("zkt-nav-groups-v2", JSON.stringify(next));
      return next;
    });
  };
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const delayByTo = new Map<string, number>(
    visibleNav.map((item, index): [string, number] => [item.to, index * 28]),
  );
  const editorItems = useMemo(
    () =>
      nav.map((item: NavItem) => ({
        to: item.to,
        label: item.label,
        groupKey: resolveGroupKey(item.to) || NAV_GROUPS[0].key,
      })),
    [resolveGroupKey],
  );
  return (
    <div dir="rtl" className="app-shell flex min-h-screen bg-background">
      <button
        aria-label="إغلاق القائمة"
        aria-hidden={!mobileSidebarOpen}
        tabIndex={mobileSidebarOpen ? undefined : -1}
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/45 backdrop-blur-sm transition-opacity duration-300 md:hidden",
          mobileSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setMobileSidebarOpen(false)}
      />
      <aside
        className={cn(
          "app-sidebar fixed bottom-3 left-3 right-auto top-3 z-40 flex w-[min(19rem,calc(100vw-1.5rem))] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-sidebar text-sidebar-foreground shadow-xl shadow-slate-950/15 transition-[width,height,transform] duration-300 ease-out md:left-4 md:right-auto md:top-4 md:translate-x-0",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-[calc(100%+0.75rem)]",
          sidebarCollapsed
            ? "md:bottom-auto md:h-[4.625rem] md:w-[4.5rem]"
            : "md:bottom-4 md:h-[calc(100vh-2rem)] md:w-64",
        )}
      >
        <div
          className={cn(
            "flex min-h-16 items-center justify-between border-b border-border px-4 py-3",
            sidebarCollapsed && "md:justify-center md:px-2",
          )}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 768) setMobileSidebarOpen(false);
                else toggleSidebar();
              }}
              aria-label={sidebarCollapsed ? "فتح القائمة" : "طي القائمة"}
              title={sidebarCollapsed ? "فتح القائمة" : "طي القائمة"}
              className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-300 to-cyan-500 shadow-lg shadow-teal-950/25 ring-1 ring-white/20 transition-transform duration-300 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Fingerprint className="h-6 w-6 text-slate-950" />
              <span className="absolute -bottom-1 -left-1 h-3 w-3 rounded-full border-2 border-sidebar bg-emerald-400" />
            </button>
            <div className={cn("min-w-0", sidebarCollapsed && "md:hidden")}>
              {isEditingWorkspaceName ? (
                <input
                  autoFocus
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveWorkspaceName();
                    if (event.key === "Escape") setIsEditingWorkspaceName(false);
                  }}
                  aria-label="اسم النظام"
                  className="w-36 rounded-md border border-sidebar-border bg-sidebar px-2 py-1 text-sm font-bold text-sidebar-foreground outline-none"
                />
              ) : (
                <h1 className="truncate font-bold text-[15px] tracking-tight">{workspaceName}</h1>
              )}
              <p className="mt-1 text-[11px] text-sidebar-foreground/55">إدارة الموارد والمشاريع</p>
            </div>
          </div>
          <div className={cn("flex items-center gap-1", sidebarCollapsed && "md:hidden")}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-sidebar-foreground/65 hover:bg-black/[0.05] hover:text-sidebar-foreground dark:hover:bg-white/10"
              onClick={() =>
                isEditingWorkspaceName ? saveWorkspaceName() : setIsEditingWorkspaceName(true)
              }
              aria-label={isEditingWorkspaceName ? "حفظ اسم النظام" : "تعديل اسم النظام"}
              title={isEditingWorkspaceName ? "حفظ اسم النظام" : "تعديل اسم النظام"}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-sidebar-foreground/65 hover:bg-black/[0.05] hover:text-sidebar-foreground dark:hover:bg-white/10 md:hidden"
              onClick={() => setMobileSidebarOpen(false)}
              title="إخفاء اللوحة الجانبية"
              aria-label="إخفاء اللوحة الجانبية"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <nav
          aria-label="التنقل الرئيسي"
          className={cn(
            "app-sidebar-nav flex-1 space-y-1.5 overflow-y-auto p-3 transition-opacity duration-200",
            sidebarCollapsed && "md:px-2",
            sidebarCollapsed && "md:hidden",
          )}
        >
          <p
            className={cn(
              "px-3 pb-1 pt-2 text-[10px] font-bold tracking-[0.16em] text-sidebar-foreground/40",
              sidebarCollapsed && "md:hidden",
            )}
          >
            القائمة الرئيسية
          </p>
          {mergedGroups.map((group) => {
            const isOpen = openGroups.includes(group.key) || hoveredGroup === group.key;
            const isGroupActive = group.items.some(
              (item) => pathname === item.to || pathname.startsWith(item.to + "/"),
            );
            const GroupIcon = group.icon;
            return (
              <div
                key={group.key}
                dir="rtl"
                className="space-y-1"
                onMouseEnter={() => setHoveredGroup(group.key)}
                onMouseLeave={() => setHoveredGroup((current) => current === group.key ? null : current)}
              >
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={isOpen}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors",
                      isGroupActive
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/65 hover:bg-muted hover:text-sidebar-foreground",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <GroupIcon className="h-4 w-4 shrink-0" />
                      {group.label}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                  </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="space-y-1 pr-2">
                      {group.items.map((item) => {
                        const active = pathname === item.to || pathname.startsWith(item.to + "/");
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.to}
                            to={item.to as any}
                            onClick={() => {
                              if (window.innerWidth < 768) setMobileSidebarOpen(false);
                            }}
                            className={cn(
                              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
                              sidebarCollapsed && "md:hidden",
                              active
                                ? "bg-primary/10 text-primary"
                                : "text-sidebar-foreground/70 hover:bg-muted hover:text-sidebar-foreground",
                            )}
                            style={{
                              animationDelay: `${delayByTo.get(item.to) ?? 0}ms`,
                            }}
                          >
                            {active && (
                              <span className="absolute inset-y-2 right-0 w-0.5 rounded-full bg-primary" />
                            )}
                            <Icon className="w-4 h-4 shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3" />
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
        <div
          className={cn(
            "border-t border-sidebar-border/80 px-4 py-3",
            sidebarCollapsed && "md:px-2",
            sidebarCollapsed && "md:hidden",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-between gap-2",
              sidebarCollapsed && "md:flex-col md:justify-center",
            )}
          >
            <div
              title="النظام متصل"
              className={cn(
                "flex items-center gap-2 text-[10px] text-sidebar-foreground/55",
                sidebarCollapsed && "md:justify-center",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
              <span className={cn(sidebarCollapsed && "md:hidden")}>النظام متصل</span>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setCustomizerOpen(true)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-sidebar-foreground/60 transition-colors hover:bg-muted hover:text-sidebar-foreground",
                  sidebarCollapsed && "md:hidden",
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> تخصيص القائمة
              </button>
            )}
          </div>
        </div>
      </aside>
      <main className="app-main min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[1500px] p-4 sm:p-6 xl:p-8">
          <header className="mb-7 flex items-center justify-between gap-4 rounded-2xl border border-white/70 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                className="md:hidden"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="فتح القائمة"
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  مساحة العمل <span className="mx-1 text-primary">/</span> الإدارة
                </p>
                <h2 className="truncate text-base font-bold sm:text-lg">
                  {currentPage?.label || "الملف الشخصي"}
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-10 gap-2 rounded-xl border-border/70 bg-background/80 px-2.5 shadow-sm hover:bg-muted/70 sm:px-3"
                    aria-label="قائمة الحساب الشخصي"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <UserCircle2 className="h-[18px] w-[18px]" />
                    </span>
                    <span className="hidden max-w-32 truncate text-xs font-semibold sm:block">
                      {profileName || user?.user_metadata?.full_name || "حسابي"}
                    </span>
                    <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60" style={{ direction: "rtl" }}>
                  <DropdownMenuLabel className="font-normal">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {profileName || user?.user_metadata?.full_name || "صاحب الحساب"}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{user?.email}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {isAdmin && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                          مدير النظام
                        </span>
                      )}
                      {roles.map((role) => (
                        <span
                          key={role}
                          className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/profile" className="cursor-pointer">
                      <UserCircle2 className="ml-2 h-4 w-4" /> الملف الشخصي
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive"
                    onSelect={async () => {
                      await signOut();
                      navigate({ to: "/auth" });
                    }}
                  >
                    <LogOut className="ml-2 h-4 w-4" /> تسجيل الخروج
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {canViewOperationalAlerts && (
                <Popover open={alertsOpen} onOpenChange={setAlertsOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="relative"
                      aria-label={`مركز التنبيهات: ${operationalAlerts.length} تنبيه`}
                      title="مركز التنبيهات"
                    >
                      <Bell className="h-4 w-4" />
                      {operationalAlerts.length > 0 && (
                        <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                          {operationalAlerts.length > 99 ? "99+" : operationalAlerts.length}
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    dir="rtl"
                    align="end"
                    className="w-[min(22rem,calc(100vw-2rem))] p-0"
                  >
                    <div className="border-b px-4 py-3">
                      <p className="text-sm font-bold">التنبيهات التشغيلية</p>
                      <p className="text-xs text-muted-foreground">
                        {operationalAlerts.length} تنبيه حالي
                      </p>
                    </div>
                    <div className="max-h-[min(65vh,28rem)] overflow-y-auto p-2">
                      {operationalAlertsQuery.isLoading ? (
                        <p className="p-3 text-sm text-muted-foreground">جارٍ فحص المؤشرات...</p>
                      ) : operationalAlertsQuery.error ? (
                        <p className="p-3 text-sm text-destructive">تعذر تحميل التنبيهات.</p>
                      ) : operationalAlerts.length ? (
                        operationalAlerts.slice(0, 6).map((alert) => (
                          <Link
                            key={alert.id}
                            to={alert.href as any}
                            onClick={() => setAlertsOpen(false)}
                            className="block rounded-md border-r-4 border-r-amber-500 px-3 py-2.5 hover:bg-muted/60"
                          >
                            <p className="text-xs font-semibold">{alert.title}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">{alert.detail}</p>
                          </Link>
                        ))
                      ) : (
                        <p className="p-3 text-sm text-muted-foreground">لا توجد تنبيهات حالية.</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={toggleTheme}
                aria-label={themeMode === "dark" ? "تفعيل المظهر الفاتح" : "تفعيل المظهر الداكن"}
                title="تغيير المظهر"
              >
                {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <div className="hidden items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 text-xs font-semibold text-primary sm:flex">
                <Sparkles className="h-4 w-4" /> نظام إدارة موحد
              </div>
            </div>
          </header>
          {permissionError ? (
            <div
              role="alert"
              className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
            >
              تعذر التحقق من صلاحيات الحساب. أعد تحميل الصفحة، وإذا استمرت المشكلة تواصل مع مدير
              النظام.
            </div>
          ) : blocked && !allowedSections?.length ? (
            <div
              role="alert"
              className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground shadow-sm"
            >
              لا توجد واجهات مخصصة لهذا الحساب. تواصل مع مدير النظام لتحديث صلاحياتك.
            </div>
          ) : blocked ? null : (
            children
          )}
        </div>
      </main>
      {customizerOpen && isAdmin && (
        <NavigationCustomizer
          groups={NAV_GROUPS.map((group) => ({ key: group.key, label: group.label }))}
          items={editorItems}
          initialLabels={navLabels}
          onClose={() => setCustomizerOpen(false)}
          updatedBy={user?.id ?? null}
        />
      )}
      <Toaster richColors position="top-center" />
    </div>
  );
}
