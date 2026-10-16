import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Activity,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "تسجيل الدخول — نظام الحضور" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(formatErrorMessage(error));
        return;
      }
      toast.success("مرحباً بك");
      navigate({ to: "/dashboard" });
    } catch {
      toast.error("تعذر الاتصال بالنظام. تحقق من الاتصال ثم حاول مجدداً.");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) toast.error("فشل تسجيل الدخول بـ Google");
    } catch {
      toast.error("تعذر بدء تسجيل الدخول بـ Google");
      setBusy(false);
    }
  };

  return (
    <main
      dir="rtl"
      className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-[#071a2b] px-4 py-8 sm:px-8"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-48 -z-10 h-[34rem] w-[34rem] rounded-full bg-teal-400/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-52 -left-36 -z-10 h-[34rem] w-[34rem] rounded-full bg-sky-500/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[.08] [background-image:linear-gradient(rgba(255,255,255,.3)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.3)_1px,transparent_1px)] [background-size:54px_54px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]"
      />

      <section className="grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-[0_35px_100px_-35px_rgba(0,0,0,.7)] lg:min-h-[650px] lg:grid-cols-[.95fr_1.05fr]">
        <div className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16">
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-lg shadow-emerald-900/20">
              <Fingerprint className="h-6 w-6" />
            </span>
            <div>
              <p className="font-extrabold text-slate-900">منظومة زِكت</p>
              <p className="text-xs text-slate-500">إدارة الحضور والموارد</p>
            </div>
          </div>

          <div className="mx-auto w-full max-w-md">
            <div className="mb-8">
              <span className="mb-5 hidden h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-lg shadow-emerald-900/20 lg:flex">
                <Fingerprint className="h-7 w-7" />
              </span>
              <p className="mb-2 text-sm font-bold text-emerald-700">مساحة العمل الآمنة</p>
              <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                أهلاً بعودتك
              </h1>
              <p className="mt-3 leading-7 text-slate-500">
                سجّل الدخول لمتابعة الحضور والفرق والمشاريع من مكان واحد.
              </p>
            </div>

            <form onSubmit={signIn} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="login-email" className="font-bold text-slate-700">
                  البريد الإلكتروني
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute right-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    dir="ltr"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@company.com"
                    className="h-12 rounded-xl border-slate-200 bg-slate-50 pr-11 text-left text-slate-900 placeholder:text-slate-400 focus-visible:border-emerald-500 focus-visible:bg-white focus-visible:ring-emerald-500/20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="login-password" className="font-bold text-slate-700">
                    كلمة المرور
                  </Label>
                </div>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute right-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="أدخل كلمة المرور"
                    className="h-12 rounded-xl border-slate-200 bg-slate-50 px-11 text-slate-900 placeholder:text-slate-400 focus-visible:border-emerald-500 focus-visible:bg-white focus-visible:ring-emerald-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="group h-12 w-full rounded-xl bg-gradient-to-l from-emerald-700 to-teal-600 text-base font-bold text-white shadow-lg shadow-emerald-800/20 transition-all hover:-translate-y-0.5 hover:from-emerald-800 hover:to-teal-700 hover:shadow-xl"
                disabled={busy}
              >
                {busy ? <LoaderCircle className="ml-2 h-5 w-5 animate-spin" /> : null}
                {busy ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
                {!busy ? <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" /> : null}
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-medium text-slate-400">أو تابع باستخدام</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-xl border-slate-200 bg-white font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              onClick={google}
              disabled={busy}
            >
              <Globe2 className="ml-2 h-[18px] w-[18px] text-slate-500" />
              تسجيل الدخول باستخدام Google
            </Button>

            <p className="mt-6 text-center text-xs leading-6 text-slate-400">
              الحسابات متاحة من خلال مسؤول النظام فقط.
            </p>
          </div>
        </div>

        <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0b3042] via-[#0b4e55] to-[#087b70] p-10 text-white lg:flex xl:p-14">
          <div aria-hidden="true" className="pointer-events-none absolute -left-28 -top-28 h-96 w-96 rounded-full border border-white/10" />
          <div aria-hidden="true" className="pointer-events-none absolute -left-12 -top-12 h-64 w-64 rounded-full border border-white/10" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -right-24 h-80 w-80 rounded-full bg-teal-300/10 blur-2xl" />

          <div className="relative z-10 flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur">
              <Fingerprint className="h-6 w-6 text-teal-200" />
            </span>
            <div>
              <p className="font-extrabold tracking-wide">منظومة زِكت</p>
              <p className="text-xs text-white/60">ZKTeco · إدارة الحضور والموارد</p>
            </div>
          </div>

          <div className="relative z-10 max-w-lg py-12">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-200/20 bg-teal-100/10 px-3 py-1.5 text-xs font-semibold text-teal-100">
              <Sparkles className="h-3.5 w-3.5" /> إدارة أوضح، قرارات أسرع
            </div>
            <h2 className="text-4xl font-black leading-[1.35] tracking-tight xl:text-5xl">
              كل تفاصيل فريقك،<br />
              <span className="text-teal-200">في لوحة واحدة.</span>
            </h2>
            <p className="mt-5 max-w-md text-base leading-8 text-white/65">
              تابع الحضور والمهام والمواقع وتكاليف المشاريع ضمن تجربة موحدة مصممة لاحتياجات العمل اليومية.
            </p>
          </div>

          <div className="relative z-10 grid grid-cols-3 gap-3">
            {[
              { icon: Activity, label: "متابعة الحضور" },
              { icon: UsersRound, label: "إدارة الفرق" },
              { icon: ShieldCheck, label: "صلاحيات آمنة" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[.07] p-4 backdrop-blur-sm">
                <Icon className="mb-3 h-5 w-5 text-teal-200" />
                <p className="text-xs font-semibold text-white/85">{label}</p>
                <div className="mt-3 flex items-center gap-1 text-[10px] text-teal-100/70"><Check className="h-3 w-3" /> ضمن منظومة واحدة</div>
              </div>
            ))}
          </div>
          <p className="relative z-10 mt-8 text-[11px] text-white/35">دخول آمن ومخصص لمستخدمي المؤسسة</p>
        </aside>
      </section>
    </main>
  );
}
