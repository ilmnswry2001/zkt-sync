import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getModuleRelations, getSystemModule, SYSTEM_FLOWS, SYSTEM_MODULES } from "@/lib/system-map";

export const Route = createFileRoute("/_authenticated/system-map")({
  head: () => ({ meta: [{ title: "خريطة النظام" }] }),
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userData.user.id);
    if (!roles?.some((item) => item.role === "admin")) throw redirect({ to: "/dashboard" });
  },
  component: SystemMapPage,
});

function SystemMapPage() {
  const [selectedId, setSelectedId] = useState("attendance");
  const selected = getSystemModule(selectedId) ?? SYSTEM_MODULES[0];
  const relations = getModuleRelations(selected.id);

  return (
    <div dir="rtl" className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-3 text-primary"><Network className="h-6 w-6" /></div>
        <div><h1 className="text-2xl font-bold">خريطة النظام</h1><p className="text-sm text-muted-foreground">الأقسام ومسارات تبادل البيانات والاعتماد بينها.</p></div>
      </div>

      <Card>
        <CardHeader><CardTitle>مسارات العمل الرئيسية</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {SYSTEM_FLOWS.map((flow) => (
            <section key={flow.title} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{flow.title}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {flow.relations.map((relation, index) => {
                  const from = getSystemModule(relation.from)!;
                  const to = getSystemModule(relation.to)!;
                  const FromIcon = from.icon;
                  const ToIcon = to.icon;
                  return (
                    <div key={`${relation.from}-${relation.to}-${index}`} className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setSelectedId(from.id)} aria-pressed={selectedId === from.id} className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm transition hover:border-primary/50 aria-pressed:border-primary aria-pressed:bg-primary/10">
                        <FromIcon className="h-4 w-4 text-primary" />{from.title}
                      </button>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft className="h-4 w-4 shrink-0" /><span>{relation.label}</span></div>
                      <button type="button" onClick={() => setSelectedId(to.id)} aria-pressed={selectedId === to.id} className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm transition hover:border-primary/50 aria-pressed:border-primary aria-pressed:bg-primary/10">
                        <ToIcon className="h-4 w-4 text-primary" />{to.title}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader><CardTitle>الأقسام المسجلة في الخريطة</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {SYSTEM_MODULES.map((module) => {
              const Icon = module.icon;
              return <button key={module.id} type="button" onClick={() => setSelectedId(module.id)} aria-pressed={selectedId === module.id} className="flex min-h-14 items-center gap-3 rounded-xl border p-3 text-right transition hover:border-primary/50 aria-pressed:border-primary aria-pressed:bg-primary/10"><Icon className="h-5 w-5 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block font-medium">{module.title}</span><span className="text-xs text-muted-foreground">{module.group}</span></span></button>;
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{selected.title}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{selected.summary}</p>
            <div><p className="mb-2 text-sm font-medium">الصفحات</p><div className="flex flex-wrap gap-2">{selected.pages.map((page) => <Badge key={page} variant="secondary">{page}</Badge>)}</div></div>
            <div><p className="mb-2 text-sm font-medium">الارتباطات</p><ul className="space-y-2 text-sm">{relations.length ? relations.map((relation, index) => { const other = getSystemModule(relation.direction === "outgoing" ? relation.to : relation.from)!; const Icon = relation.direction === "outgoing" ? ArrowLeft : ArrowRight; return <li key={`${other.id}-${index}`} className="flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{relation.direction === "outgoing" ? "يرسل إلى" : "يستقبل من"} <b>{other.title}</b><span className="block text-xs text-muted-foreground">{relation.label}</span></span></li>; }) : <li className="text-muted-foreground">لم تُسجل روابط لهذا القسم بعد.</li>}</ul></div>
            <Button asChild variant="outline" className="w-full"><Link to={selected.href as never}>فتح القسم <ExternalLink className="mr-2 h-4 w-4" /></Link></Button>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">هذه خريطة وظيفية أولية. توثيق المكونات والجداول والصلاحيات التفصيلية يضاف إلى سجل القسم عند تحديثه.</p>
    </div>
  );
}
