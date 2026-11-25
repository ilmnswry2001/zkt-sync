import { direction, ui } from "@/lib/ui-language";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import { ChevronsUpDown, Check } from "lucide-react";
import { normalizeStaffSearch } from "@/lib/planning-staff";

import { workshopSiteLabel, type WorkshopSiteOption } from "@/lib/workshop-management";

export function WorkshopSitePicker({
  sites,
  value,
  onChange,
  label,
  emptyLabel = "دون إسناد افتراضي",
}: {
  sites: WorkshopSiteOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = sites.find((s) => s.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ui(label)}
          className="h-auto min-h-11 w-full justify-between gap-3 py-3 text-right font-normal"
        >
          <span className="min-w-0 whitespace-normal break-words leading-6">
            {selected ? workshopSiteLabel(selected) : ui(emptyLabel)}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        dir={direction()}
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder={ui("ابحث باسم المشروع أو كود CTR…")} />
          <CommandList className="max-h-72">
            <CommandEmpty>{ui("لا يوجد مشروع مطابق.")}</CommandEmpty>
            <CommandItem
              value={ui(emptyLabel)}
              onSelect={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {ui(emptyLabel)}
            </CommandItem>
            {sites.map((site) => (
              <CommandItem
                key={site.id}
                value={`${site.id} ${workshopSiteLabel(site)}`}
                onSelect={() => {
                  onChange(site.id);
                  setOpen(false);
                }}
                className="items-start gap-2 py-3"
              >
                <Check
                  className={`mt-1 h-4 w-4 shrink-0 ${value === site.id ? "opacity-100" : "opacity-0"}`}
                />
                <span className="whitespace-normal break-words leading-6">
                  {workshopSiteLabel(site)}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type Member = {
  id: string;
  employee_id: string;
  role_label: string | null;
  employees:
    | { full_name: string; employee_no: string }
    | { full_name: string; employee_no: string }[]
    | null;
};
type Line = { employee_id: string | null; attended: boolean; site_id: string | null };
export function WorkshopRoster({
  members,
  lines,
  sites,
}: {
  members: Member[];
  lines: Line[];
  sites: WorkshopSiteOption[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(20);
  const hits = new Map(lines.map((l) => [l.employee_id, l]));
  const rows = members.map((member) => ({
    ...member,
    employee: Array.isArray(member.employees) ? member.employees[0] : member.employees,
    hit: hits.get(member.employee_id),
  }));
  const filtered = rows.filter(
    (row) =>
      normalizeStaffSearch(
        `${row.employee?.full_name ?? ""} ${row.employee?.employee_no ?? ""} ${row.role_label ?? ""}`,
      ).includes(normalizeStaffSearch(search)) &&
      (filter === "all" || (filter === "present" ? row.hit?.attended : !row.hit?.attended)),
  );
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{ui("الكادر: ")}{members.length}</Badge>
        <Badge variant="outline">{ui("الحاضر بالتقرير: ")}{rows.filter((r) => r.hit?.attended).length}
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          aria-label={ui("البحث في كادر الورشة")}
          placeholder={ui("اسم الموظف، رقمه أو تخصصه")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(20);
          }}
        />
        <select
          aria-label={ui("تصفية حالة الكادر")}
          className="h-10 rounded-md border bg-background px-3 text-sm"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setLimit(20);
          }}
        >
          <option value="all">{ui("جميع الكادر")}</option>
          <option value="present">{ui("الحاضر بالتقرير")}</option>
          <option value="unmarked">{ui("غير مؤشّر بالحضور")}</option>
        </select>
      </div>
      <div className="max-h-[50vh] overflow-auto rounded-lg border">
        <table
          aria-label={ui("كادر الورشة وحضورهم ومراكز تكلفتهم")}
          className="w-full text-right text-sm"
        >
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="p-3">{ui("الموظف / التخصص")}</th>
              <th className="p-3">{ui("الحالة")}</th>
              <th className="p-3">{ui("مركز التكلفة الفعلي")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-3">
                  <p className="font-medium">{row.employee?.full_name ?? ui("موظف غير متاح")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.employee?.employee_no} · {row.role_label || ui("بدون تخصص")}
                  </p>
                </td>
                <td className="p-3">
                  <Badge variant={row.hit?.attended ? "default" : "secondary"}>
                    {row.hit?.attended ? ui("حاضر") : ui("غير مؤشّر")}
                  </Badge>
                </td>
                <td className="min-w-40 p-3 text-xs leading-6">
                  {sites.find((s) => s.id === row.hit?.site_id)
                    ? workshopSiteLabel(sites.find((s) => s.id === row.hit?.site_id)!)
                    : ui("غير مسند")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="p-6 text-center text-sm text-muted-foreground">{ui("لا يوجد كادر مطابق.")}</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{ui("عرض ")}{Math.min(limit, filtered.length)}{ui(" من ")}{filtered.length}
        </span>
        {limit < filtered.length && (
          <Button variant="outline" onClick={() => setLimit(limit + 20)}>{ui("عرض المزيد")}</Button>
        )}
      </div>
    </div>
  );
}
