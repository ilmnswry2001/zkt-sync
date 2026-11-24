import { direction, ui } from "@/lib/ui-language";
import { useDirectorySearch } from "@/hooks/use-directory-search";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Check, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { planEmployeeDirectoryOptions } from "@/lib/plan-employee-directory";
import { suggestStaffEmployees, isStaffEmployeeAssigned, type AssignedStaffEmployee, type StaffAssignmentGroup } from "@/lib/planning-staff";

export function PlanEmployeePicker({ specialty, assignments, onSelect }: {
  specialty: string; assignments: StaffAssignmentGroup[]; onSelect: (employee: AssignedStaffEmployee) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const lookup = useDirectorySearch(search);
  const ready = !search.trim() || lookup.valid;
  const directory = useQuery({
    ...planEmployeeDirectoryOptions(lookup.term, specialty),
    enabled: open && ready && !lookup.waiting,
  });
  const suggestions = suggestStaffEmployees(ready && !lookup.waiting ? directory.data ?? [] : [], specialty, search);
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (value) setSearch(""); }}>
    <PopoverTrigger asChild><Button type="button" variant="outline" className="min-h-11 w-full justify-start" aria-label={(ui("اختيار موظف لتخصص ") + (specialty))}><Search className="ml-2 h-4 w-4" />{ui("اختر موظفاً مسجلاً")}</Button></PopoverTrigger>
    <PopoverContent dir={direction()} align="start" className="w-[min(25rem,calc(100vw-2rem))] p-0">
      <Command shouldFilter={false}><CommandInput value={search} onValueChange={setSearch} placeholder={ui("ابحث بالاسم أو الرقم الوظيفي أو المسمى أو القسم...")} />
        <CommandList><CommandEmpty>{!ready ? ui("اكتب حرفين على الأقل") : lookup.waiting || directory.isPending ? ui("جارٍ تحميل الموظفين...") : directory.error ? ui("تعذر تحميل الموظفين") : ui("لا يوجد موظف مطابق للبحث.")}</CommandEmpty>
          <CommandGroup>{suggestions.map((employee) => {
            const assigned = isStaffEmployeeAssigned(assignments, employee);
            return <CommandItem key={employee.id} value={employee.id} disabled={assigned} onSelect={() => { onSelect(employee); setOpen(false); }}>
              <div className="min-w-0 flex-1 space-y-1 text-right"><p className="font-semibold">{employee.full_name}</p><p className="text-xs text-muted-foreground">{employee.employee_no} · {employee.position || ui("بدون مسمى")}{employee.department_name ? ` · ${employee.department_name}` : ""}{assigned ? ui(" · مسكّن في الخطة") : ""}</p><p className="flex items-center gap-1 text-xs text-primary"><Phone className="h-3 w-3" /><span dir="ltr">{employee.phone || ui("بلا هاتف")}</span></p></div>{assigned && <Check className="h-4 w-4 text-primary" />}
            </CommandItem>;
          })}</CommandGroup>
        </CommandList></Command>
    </PopoverContent>
  </Popover>;
}