import { createFileRoute, Link } from "@tanstack/react-router";
import { useContext, useState } from "react";
import { ExternalLink, Network, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GuideNavigation } from "@/lib/guide-navigation";
import { sectionGuide } from "@/lib/section-guide";
import { systemWorkflows } from "@/lib/system-map";
import { ui } from "@/lib/ui-language";

export const Route = createFileRoute("/_authenticated/system-map")({
  head: () => ({ meta: [{ title: ui("خريطة النظام") }] }),
  component: SystemMapPage,
});

function SystemMapPage() {
  const groups = useContext(GuideNavigation);
  const [search, setSearch] = useState("");
  const term = search.trim().toLocaleLowerCase();
  const sections = new Map(groups.flatMap(group => group.items.map(item => [item.to, item] as const)));
  const visibleGroups = groups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      const words = [group.label, item.label, sectionGuide[item.to] ?? ""];
      return words.some(word => [word, ui(word)].some(value => value.toLocaleLowerCase().includes(term)));
    }),
  })).filter(group => group.items.length);

  return <div className="space-y-5">
    <header className="flex items-start gap-3"><Network className="mt-1 size-6 shrink-0 text-primary" />
      <div><h1 className="text-2xl font-bold">{ui("خريطة النظام")}</h1>
        <p className="text-muted-foreground">{ui("اختر ما تريد إنجازه. يعرض الدليل أقسام حسابك بنفس ترتيب مجموعات القائمة.")}</p></div>
    </header>
    <div className="relative max-w-xl">
      <Search className="absolute start-3 top-3 size-4 text-muted-foreground" aria-hidden />
      <Input type="search" className="ps-9" aria-label={ui("البحث في دليل النظام")} value={search}
        placeholder={ui("ابحث عن مهمة أو قسم، مثل قصاصات الرواتب أو تسجيل الجرد")} onChange={event => setSearch(event.target.value)} />
    </div>
    {!visibleGroups.length && <p role="status">{ui("لا توجد أقسام مطابقة. جرّب كلمة أخرى.")}</p>}
    {visibleGroups.map(group => <Card key={group.key}>
      <CardHeader><CardTitle>{ui(group.label)}</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {group.items.map(item => <Link key={item.to} to={item.to} className="rounded-lg border p-3 hover:border-primary focus-visible:ring-2 focus-visible:ring-primary">
          <h2 className="flex items-center gap-2 font-semibold"><item.icon className="size-4 shrink-0 text-primary" />{ui(item.label)}<ExternalLink className="ms-auto size-3 shrink-0" /></h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{ui(sectionGuide[item.to])}</p>
        </Link>)}
      </CardContent>
    </Card>)}
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-semibold">{ui("كيف ترتبط الأقسام ببعضها؟")}</summary>
      {systemWorkflows.map(flow => {
        const links = flow.links.flatMap(([source, destination, label]) => {
          const from = sections.get(source);
          const to = sections.get(destination);
          return from && to ? [{ from, to, label }] : [];
        });
        return links.length > 0 && <section key={flow.title} className="mt-4"><h2 className="font-medium">{ui(flow.title)}</h2>
          <ul className="mt-1 space-y-1 text-sm">{links.map(link => <li key={link.from.to + link.to.to}>
            <Link className="text-primary underline" to={link.from.to}>{ui(link.from.label)}</Link>
            {" "}{ui("يرسل إلى")}{" "}<Link className="text-primary underline" to={link.to.to}>{ui(link.to.label)}</Link>
            {" · "}{ui(link.label)}
          </li>)}</ul></section>;
      })}
    </details>
  </div>;
}
