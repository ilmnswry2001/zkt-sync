import { direction, localizedDateFormat, localizedNumberFormat, ui } from "@/lib/ui-language";
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserRoundCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AccountScopeFields } from "@/components/AccountScopeFields";
import { MetricCard } from "@/components/MetricCard";
import { PlanPermissionsEditor } from "@/components/PlanPermissionsEditor";
import {
  AlertDialog,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  accountAccessSchema,
  accountRoles,
  initialRolePages,
  passwordSchema,
  roleKeys,
  type AccountAccess,
  type AccountDetails,
  type DirectoryAccount,
} from "@/lib/account-access";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  readAccountAccess,
  updateAccountAccess,
  updateAccountPassword,
} from "@/lib/accounts.functions";
import { formatErrorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: ui("الحسابات والصلاحيات") }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: isAdmin, error } = await supabase.rpc("is_admin", { _user_id: data.user.id });
    if (error) throw new Error("تعذر التحقق من صلاحية إدارة الحسابات.");
    if (!isAdmin) throw redirect({ to: "/dashboard" });
  },
  component: AccountsPage,
});

type FilterRole = "" | "unassigned" | AccountAccess["roles"][number];
type AccountAction =
  { kind: "create" } | { kind: "edit" | "password" | "delete"; account: DirectoryAccount };
const pageSize = 20;
const dateFormat = localizedDateFormat({
  dateStyle: "medium",
  timeZone: "Asia/Baghdad",
});
const numberFormat = localizedNumberFormat();
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function accountName(account: DirectoryAccount) {
  return account.full_name || account.email || "حساب بلا اسم";
}

function AccountsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [role, setRole] = useState<FilterRole>("");
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<AccountAction>();
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const directory = useQuery({
    queryKey: ["accounts", "directory", { term, role, page }],
    queryFn: ({ signal }) => listAccounts({ data: { search: term, role, page }, signal }),
  });
  const data = directory.data;
  const pages = Math.max(1, Math.ceil((data?.filteredCount ?? 0) / pageSize));
  useEffect(() => {
    if (data && page >= pages) setPage(pages - 1);
  }, [data, page, pages]);

  const waiting = directory.isPending || search.trim() !== term;
  const close = () => setAction(undefined);
  const refresh = async () => {
    const result = await directory.refetch();
    if (result.isSuccess) toast.success(ui("تم تحديث دليل الحسابات"));
  };

  return (
    <div dir={direction()} className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <UserRoundCog className="size-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">{ui("الحسابات والصلاحيات")}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{ui("إدارة الحسابات والأدوار ونطاق الوصول إلى الأقسام وصفحات النظام.")}</p>
          </div>
        </div>
        <Button onClick={() => setAction({ kind: "create" })} disabled={directory.isError}>
          <Plus className="size-4" />{ui(" إنشاء حساب")}</Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          title={ui("إجمالي الحسابات")}
          value={data ? numberFormat.format(data.total) : "—"}
          icon={Users}
          loading={directory.isPending}
        />
        <MetricCard
          title={ui("مديرو النظام")}
          value={data ? numberFormat.format(data.admins) : "—"}
          icon={ShieldCheck}
          tone="success"
          loading={directory.isPending}
        />
        <MetricCard
          title={ui("حسابات بدون أدوار")}
          value={data ? numberFormat.format(data.unassigned) : "—"}
          icon={ShieldOff}
          tone="warning"
          loading={directory.isPending}
        />
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base sm:text-lg">{ui("دليل الحسابات")}</CardTitle>
            <Button
              size="icon"
              variant="outline"
              aria-label={ui("تحديث دليل الحسابات")}
              title={ui("تحديث دليل الحسابات")}
              disabled={directory.isFetching}
              onClick={() => void refresh()}
            >
              <RefreshCw className={directory.isFetching ? "size-4 animate-spin" : "size-4"} />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label htmlFor="account-search">{ui("البحث عن حساب")}</Label>
              <div className="relative">
                <Search
                  className="absolute start-3 top-3 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="account-search"
                  className="ps-9"
                  maxLength={160}
                  placeholder={ui("اكتب الاسم أو البريد الإلكتروني")}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(0);
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-role-filter">{ui("تصفية حسب الدور")}</Label>
              <select
                id="account-role-filter"
                className={selectClass}
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as FilterRole);
                  setPage(0);
                }}
              >
                <option value="">{ui("جميع الأدوار")}</option>
                <option value="unassigned">{ui("بدون دور")}</option>
                {roleKeys.map((key) => (
                  <option key={key} value={key}>
                    {ui(accountRoles[key][0])}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {directory.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <p role="alert" className="text-sm text-destructive">
                {ui(formatErrorMessage(directory.error, "تعذر تحميل دليل الحسابات"))}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void directory.refetch()}
              >{ui("إعادة المحاولة")}</Button>
            </div>
          ) : waiting ? (
            <p
              role="status"
              className="rounded-xl border p-8 text-center text-sm text-muted-foreground"
            >{ui("جارٍ تحميل الحسابات…")}</p>
          ) : !data?.accounts.length ? (
            <div className="space-y-3 rounded-xl border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">{ui("لا توجد حسابات مطابقة للبحث والتصفية.")}</p>
              {(search || role) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setTerm("");
                    setRole("");
                    setPage(0);
                  }}
                >{ui("مسح عوامل التصفية")}</Button>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <div
                aria-hidden="true"
                className="hidden gap-3 bg-muted/55 px-4 py-3 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(7rem,1fr)_9rem]"
              >
                <span>{ui("الحساب")}</span>
                <span>{ui("الأدوار")}</span>
                <span>{ui("تاريخ الإنشاء")}</span>
                <span>{ui("الإجراءات")}</span>
              </div>
              <ul className="divide-y">
                {data.accounts.map((account) => {
                  const ownAccount = account.id === user?.id;
                  return (
                    <li
                      key={account.id}
                      className="grid gap-3 p-4 transition-colors hover:bg-muted/25 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(7rem,1fr)_9rem] lg:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 font-semibold text-primary"
                        >
                          {accountName(account).slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="break-words text-sm font-semibold">
                              {accountName(account)}
                            </p>
                            {ownAccount && <Badge variant="outline">{ui("حسابك")}</Badge>}
                          </div>
                          {account.email && (
                            <p
                              dir="ltr"
                              className="break-all text-right text-xs text-muted-foreground"
                            >
                              {account.email}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {account.roles.length ? (
                          account.roles.map((key) => (
                            <Badge
                              key={key}
                              variant={key === "admin" ? "default" : "secondary"}
                              className="whitespace-normal"
                            >
                              {ui(accountRoles[key][0])}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline">{ui("بدون دور")}</Badge>
                        )}
                      </div>
                      <time dateTime={account.created_at} className="text-xs text-muted-foreground">
                        {dateFormat.format(new Date(account.created_at))}
                      </time>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAction({ kind: "edit", account })}
                          aria-label={(ui("تعديل وصول ") + (accountName(account)))}
                        >{ui("تعديل")}</Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={(ui("تغيير كلمة مرور ") + (accountName(account)))}
                          title={ui("تغيير كلمة المرور")}
                          onClick={() => setAction({ kind: "password", account })}
                        >
                          <KeyRound className="size-4" />
                        </Button>
                        {!ownAccount && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive"
                            aria-label={(ui("حذف ") + (accountName(account)))}
                            title={ui("حذف الحساب")}
                            onClick={() => setAction({ kind: "delete", account })}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 p-3">
                <p className="text-sm text-muted-foreground">
                  {numberFormat.format(page * pageSize + 1)}–
                  {numberFormat.format(page * pageSize + data.accounts.length)}{ui(" من")}{" "}
                  {numberFormat.format(data.filteredCount)}{ui(" حساب")}</p>
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={ui("الصفحة السابقة")}
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <span className="text-sm">
                    {numberFormat.format(page + 1)} / {numberFormat.format(pages)}
                  </span>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={ui("الصفحة التالية")}
                    disabled={page + 1 >= pages}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {action?.kind === "create" && <AccountEditor onClose={close} />}
      {action?.kind === "edit" && (
        <EditAccount
          account={action.account}
          ownAccount={user?.id === action.account.id}
          onClose={close}
        />
      )}
      {action?.kind === "password" && <PasswordDialog account={action.account} onClose={close} />}
      {action?.kind === "delete" && <DeleteDialog account={action.account} onClose={close} />}
    </div>
  );
}

function EditAccount({
  account,
  ownAccount,
  onClose,
}: {
  account: DirectoryAccount;
  ownAccount: boolean;
  onClose: () => void;
}) {
  const details = useQuery({
    queryKey: ["accounts", "details", account.id],
    queryFn: ({ signal }) => readAccountAccess({ data: { userId: account.id }, signal }),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  if (details.data)
    return (
      <AccountEditor
        accountId={account.id}
        original={details.data}
        ownAccount={ownAccount}
        onClose={onClose}
      />
    );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir={direction()}>
        <DialogHeader className="ps-5 text-start sm:text-start">
          <DialogTitle>{ui("تعديل حساب ")}{accountName(account)}</DialogTitle>
          <DialogDescription>
            {details.isError ? ui("تعذر قراءة إعدادات الحساب.") : ui("جارٍ تحميل إعدادات الحساب…")}
          </DialogDescription>
        </DialogHeader>
        {details.isError && (
          <Button variant="outline" onClick={() => void details.refetch()}>{ui("إعادة المحاولة")}</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccountEditor({
  accountId,
  original: loadedAccess,
  ownAccount,
  onClose,
}: {
  accountId?: string;
  original?: AccountDetails;
  ownAccount?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [original] = useState(loadedAccess);
  const initial: AccountAccess = {
    fullName: original?.fullName ?? "",
    roles: original?.roles ?? ["data_entry"],
    departmentIds: original?.departments.map((item) => item.id) ?? [],
    allowedSections: original?.allowedSections ?? [],
    plan: original?.plan ?? {
      canRequest: false,
      canApprove: false,
      canStaffAll: false,
      specialties: [],
    },
  };
  const [access, setAccess] = useState(initial);
  const [scopeCustomized, setScopeCustomized] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [departments, setDepartments] = useState(original?.departments ?? []);
  const [tab, setTab] = useState("roles");
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const draft = { ...access, departmentIds: departments.map((item) => item.id) };
  const changed = JSON.stringify(draft) !== JSON.stringify(initial) || !!(email || password);
  const oneDepartment = access.roles.includes("department_manager");
  const fixedScope = access.roles.includes("admin")
    ? "admin"
    : access.roles.includes("engineer")
      ? "engineer"
      : null;

  const save = useMutation({
    mutationFn: async () => {
      if (accountId && original) {
        await updateAccountAccess({
          data: { userId: accountId, access: draft, expected: original },
        });
      } else {
        await createAccount({ data: { ...draft, email, password } });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["accounts", "directory"] });
      if (accountId)
        await queryClient.invalidateQueries({ queryKey: ["plan-staffing-permission", accountId] });
      if (ownAccount)
        window.dispatchEvent(new CustomEvent("profile-name-updated", { detail: draft.fullName }));
      toast.success(
        original ? ui("تم حفظ بيانات الحساب وصلاحياته") : ui("تم إنشاء الحساب وتعيين صلاحياته"),
      );
      onClose();
    },
    onError: (failure) => setError(formatErrorMessage(failure, "تعذر حفظ الحساب")),
  });

  const close = () => {
    if (save.isPending) return;
    if (changed) setConfirmDiscard(true);
    else onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const validation = accountAccessSchema.safeParse(draft);
    if (
      draft.fullName.trim().length < 2 ||
      (!original && (!email.trim() || password.length < 8 || !draft.roles.length))
    ) {
      setTab("roles");
      setError(
        original
          ? "أدخل الاسم الكامل."
          : "أدخل الاسم والبريد، واختر دوراً، واستخدم كلمة مرور من ٨ أحرف على الأقل.",
      );
      return;
    }
    if (oneDepartment && departments.length !== 1) {
      setTab("scope");
      setError("حدد قسماً واحداً لحساب مدير القسم.");
      return;
    }
    if (!validation.success) {
      setError("تحقق من البيانات المدخلة وحدود عدد الأقسام والصفحات والتخصصات.");
      return;
    }
    save.mutate();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent
          dir={direction()}
          className="flex max-h-[94dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-2xl"
        >
          <DialogHeader className="border-b px-6 py-5 ps-12 text-start sm:text-start">
            <DialogTitle>{original ? ui("تعديل الحساب والصلاحيات") : ui("إنشاء حساب جديد")}</DialogTitle>
            <DialogDescription className="break-all">
              {original
                ? original.email || original.fullName
                : ui("أدخل بيانات الحساب واختر صلاحياته قبل الحفظ.")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <div className="min-h-0 space-y-3 overflow-y-auto p-4 sm:p-6">
              <fieldset disabled={save.isPending}>
                <Tabs dir={direction()} value={tab} onValueChange={setTab}>
                  <TabsList className="mb-4 grid h-auto w-full grid-cols-3">
                    <TabsTrigger className="whitespace-normal" value="roles">{ui("الحساب والأدوار")}</TabsTrigger>
                    <TabsTrigger className="whitespace-normal" value="scope">{ui("الأقسام والصفحات")}</TabsTrigger>
                    <TabsTrigger className="whitespace-normal" value="plan">{ui("خطط العمل")}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="roles" className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-3 sm:col-span-2">
                        <Label htmlFor="account-name">{ui("الاسم الكامل")}</Label>
                        <Input
                          id="account-name"
                          value={access.fullName}
                          maxLength={160}
                          onChange={(event) =>
                            setAccess({ ...access, fullName: event.target.value })
                          }
                        />
                      </div>
                      {!original && (
                        <>
                          <div className="flex flex-col gap-3">
                            <Label htmlFor="account-email">{ui("البريد الإلكتروني")}</Label>
                            <Input
                              dir="ltr"
                              type="email"
                              id="account-email"
                              maxLength={320}
                              value={email}
                              onChange={(event) => setEmail(event.target.value)}
                              autoComplete="off"
                            />
                          </div>
                          <div className="flex flex-col gap-3">
                            <Label htmlFor="account-password">{ui("كلمة المرور الأولية")}</Label>
                            <Input
                              dir="ltr"
                              id="account-password"
                              type="password"
                              maxLength={72}
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              autoComplete="new-password"
                              placeholder={ui("٨ أحرف على الأقل")}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{ui("الأدوار المسندة")}</p>
                        <Badge variant="secondary">
                          {numberFormat.format(access.roles.length)}{ui(" دور")}</Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {roleKeys.map((key) => {
                          const selected = access.roles.includes(key);
                          return (
                            <label
                              key={key}
                              className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${selected ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40"}`}
                            >
                              <Checkbox
                                className="mt-1"
                                checked={selected}
                                disabled={ownAccount && key === "admin"}
                                onCheckedChange={(checked) => {
                                  const roles =
                                    checked === true
                                      ? [...access.roles, key]
                                      : access.roles.filter((role) => role !== key);
                                  const allowedSections =
                                    !original && !scopeCustomized
                                      ? [
                                          ...new Set(
                                            roles.flatMap((role) => initialRolePages[role] ?? []),
                                          ),
                                        ]
                                      : access.allowedSections;
                                  setAccess({ ...access, roles, allowedSections });
                                }}
                              />
                              <span className="min-w-0">
                                <span className="block font-medium">{ui(accountRoles[key][0])}</span>
                                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                  {ui(accountRoles[key][1])}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {ownAccount && (
                        <p className="text-xs text-muted-foreground">{ui("دور مدير النظام مثبت لحسابك الحالي.")}</p>
                      )}
                    </div>
                  </TabsContent>
                  <TabsContent value="scope">
                    <AccountScopeFields
                      departments={departments}
                      onDepartments={setDepartments}
                      singleDepartment={oneDepartment}
                      sections={access.allowedSections}
                      onSections={(allowedSections) => {
                        setScopeCustomized(true);
                        setAccess({ ...access, allowedSections });
                      }}
                      fixedScope={fixedScope}
                    />
                  </TabsContent>
                  <TabsContent value="plan">
                    <PlanPermissionsEditor
                      roles={access.roles}
                      value={access.plan}
                      onChange={(plan) => setAccess({ ...access, plan })}
                    />
                  </TabsContent>
                </Tabs>
              </fieldset>
            </div>
            <div className="space-y-3 border-t bg-card p-4 sm:px-6">
              {error && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 p-2 text-sm leading-6 text-destructive"
                >
                  {error}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {changed ? ui("تغييرات غير محفوظة") : ""}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" disabled={save.isPending} onClick={close}>{ui("إلغاء")}</Button>
                  <Button type="submit" disabled={save.isPending || (!!original && !changed)}>
                    {save.isPending && <Loader2 className="size-4 animate-spin" />}
                    {original ? ui("حفظ التغييرات") : ui("إنشاء الحساب")}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent dir={direction()}>
          <AlertDialogHeader className="text-start sm:text-start">
            <AlertDialogTitle>{ui("تجاهل التغييرات؟")}</AlertDialogTitle>
            <AlertDialogDescription>{ui("ستُغلق نافذة الحساب وتُفقد التغييرات غير المحفوظة.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ui("متابعة التعديل")}</AlertDialogCancel>
            <Button variant="destructive" onClick={onClose}>{ui("تجاهل التغييرات")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PasswordDialog({ account, onClose }: { account: DirectoryAccount; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const update = useMutation({
    mutationFn: () => updateAccountPassword({ data: { userId: account.id, password } }),
    onSuccess: () => {
      toast.success(ui("تم تغيير كلمة المرور"));
      onClose();
    },
    onError: (failure) => setError(formatErrorMessage(failure, "تعذر تغيير كلمة المرور")),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !update.isPending && onClose()}>
      <DialogContent dir={direction()} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="ps-5 text-start sm:text-start">
          <DialogTitle>{ui("تغيير كلمة المرور")}</DialogTitle>
          <DialogDescription>{accountName(account)}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const validation = passwordSchema.safeParse(password);
            if (!validation.success) {
              setError(validation.error.issues[0].message);
              return;
            }
            if (password !== confirmation) {
              setError("كلمتا المرور غير متطابقتين.");
              return;
            }
            setError("");
            update.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-password">{ui("كلمة المرور الجديدة")}</Label>
            <Input
              dir="ltr"
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={72}
              disabled={update.isPending}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{ui("تأكيد كلمة المرور")}</Label>
            <Input
              dir="ltr"
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              maxLength={72}
              disabled={update.isPending}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button disabled={update.isPending || !password || !confirmation}>
            {update.isPending ? ui("جارٍ الحفظ…") : ui("حفظ كلمة المرور")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ account, onClose }: { account: DirectoryAccount; onClose: () => void }) {
  const queryClient = useQueryClient();
  const removal = useMutation({
    mutationFn: () => deleteAccount({ data: { userId: account.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["accounts", "directory"] });
      toast.success(ui("تم حذف الحساب"));
      onClose();
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && !removal.isPending && onClose()}>
      <AlertDialogContent dir={direction()}>
        <AlertDialogHeader className="text-start sm:text-start">
          <AlertDialogTitle>{ui("حذف حساب ")}{accountName(account)}؟</AlertDialogTitle>
          <AlertDialogDescription>{ui("هذا حذف نهائي للحساب وصلاحياته. يمنع النظام الحذف إذا كان الحساب مرتبطاً بسجلات تاريخية محمية.")}</AlertDialogDescription>
        </AlertDialogHeader>
        {removal.isError && (
          <p role="alert" className="text-sm text-destructive">
            {ui(formatErrorMessage(removal.error, "تعذر حذف الحساب"))}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removal.isPending}>{ui("إلغاء")}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={removal.isPending}
            onClick={() => removal.mutate()}
          >
            {removal.isPending ? ui("جارٍ الحذف…") : ui("حذف الحساب")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
