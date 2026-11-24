import { ui } from "@/lib/ui-language";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SECTION_OPTIONS } from "@/components/AppLayout";
import { useDirectorySearch } from "@/hooks/use-directory-search";
import type { AccountDepartment } from "@/lib/account-access";

export function AccountScopeFields({
  departments,
  onDepartments,
  singleDepartment,
  sections,
  onSections,
  fixedScope,
}: {
  departments: AccountDepartment[];
  onDepartments: (next: AccountDepartment[]) => void;
  singleDepartment: boolean;
  sections: string[];
  onSections: (next: string[]) => void;
  fixedScope: "admin" | "engineer" | null;
}) {
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [sectionSearch, setSectionSearch] = useState("");
  const { term, waiting } = useDirectorySearch(departmentSearch);
  const options = useQuery({
    queryKey: ["accounts", "departments", term],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name")
        .ilike("name", `%${term}%`)
        .order("name")
        .limit(50)
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const sectionOptions: { to: string; label: string }[] = [
    ...SECTION_OPTIONS,
    ...sections
      .filter((path) => !SECTION_OPTIONS.some((item) => item.to === path))
      .map((path) => ({
        to: path,
        label: path === "/project-plans" ? "خطط المشاريع" : path,
      })),
  ];
  const visibleSections = sectionOptions.filter(({ label }) =>
    label.toLowerCase().includes(sectionSearch.trim().toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-primary" />
          <Label htmlFor="account-departments-search">{ui("نطاق الأقسام")}</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          {singleDepartment
            ? ui("اختر قسماً واحداً لحساب مدير القسم.")
            : ui("عيّن الأقسام التي تنطبق عليها صلاحيات الدور.")}
        </p>
        {!!departments.length && (
          <div className="flex flex-wrap gap-2">
            {departments.map((department) => (
              <Badge variant="secondary" key={department.id} className="gap-1 whitespace-normal">
                {department.name}
                <button
                  type="button"
                  onClick={() =>
                    onDepartments(departments.filter((item) => item.id !== department.id))
                  }
                  aria-label={(ui("إزالة قسم ") + (department.name))}
                  className="rounded p-0.5 hover:bg-background"
                >
                  <X className="size-3.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <Input
          id="account-departments-search"
          value={departmentSearch}
          onChange={(event) => setDepartmentSearch(event.target.value)}
          placeholder={ui("ابحث باسم القسم")}
        />
        {waiting || options.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">{ui("جارٍ تحميل الأقسام…")}</p>
        ) : options.isError ? (
          <Button type="button" variant="outline" onClick={() => void options.refetch()}>{ui("تعذر تحميل الأقسام · إعادة المحاولة")}</Button>
        ) : (
          <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
            {(options.data ?? []).map((department) => (
              <label
                key={department.id}
                className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={departments.some((item) => item.id === department.id)}
                  onCheckedChange={(checked) =>
                    onDepartments(
                      checked === true
                        ? singleDepartment
                          ? [department]
                          : [...departments, department]
                        : departments.filter((item) => item.id !== department.id),
                    )
                  }
                />
                {department.name}
              </label>
            ))}
            {!options.data?.length && (
              <p className="p-2 text-sm text-muted-foreground">{ui("لا يوجد قسم مطابق.")}</p>
            )}
          </div>
        )}
        {options.data?.length === 50 && (
          <p className="text-xs text-muted-foreground">{ui("تُعرض أول ٥٠ نتيجة. اكتب اسم القسم لتضييق البحث.")}</p>
        )}
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={fixedScope ? undefined : "account-section-search"}>{ui("صفحات النظام")}</Label>
          <Badge variant="outline">
            {fixedScope
              ? ui("يتحدد بالدور")
              : sections.length
                ? ((sections.length) + ui(" محددة"))
                : ui("حسب الدور")}
          </Badge>
        </div>
        {fixedScope ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {fixedScope === "admin"
              ? ui("مدير النظام يستطيع فتح جميع صفحات الإدارة.")
              : ui("دور المهندس يحدد نطاق الصفحات على الخطط وطلبات المواد والمعدات.")}
          </p>
        ) : (
          <>
            <p className="text-sm leading-6 text-muted-foreground">{ui("اختيار صفحات يخصص القائمة مع إبقاء الصفحات المرتبطة بالدور. صلاحية تنفيذ الإجراءات تُحدد حسب الدور في كل قسم.")}</p>
            <div className="relative">
              <Search
                className="absolute start-3 top-3 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="account-section-search"
                className="ps-9"
                value={sectionSearch}
                onChange={(event) => setSectionSearch(event.target.value)}
                placeholder={ui("ابحث باسم الصفحة")}
              />
            </div>
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {visibleSections.map((section) => (
                <label
                  key={section.to}
                  className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={sections.includes(section.to)}
                    onCheckedChange={(checked) =>
                      onSections(
                        checked === true
                          ? [...sections, section.to]
                          : sections.filter((path) => path !== section.to),
                      )
                    }
                  />
                  {ui(section.label)}
                </label>
              ))}
              {!visibleSections.length && (
                <p className="p-2 text-sm text-muted-foreground">{ui("لا توجد صفحة مطابقة.")}</p>
              )}
            </div>
            {!!sections.length && (
              <Button type="button" variant="outline" size="sm" onClick={() => onSections([])}>{ui("العودة إلى صفحات الدور")}</Button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
