import { direction, ui } from "@/lib/ui-language";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import { useDebouncedValue } from "@/hooks/use-directory-search";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkshopInventorySearch({ date, onSelect }: {
  date: string;
  onSelect: (workshopId: string, employeeId: string | null) => void;
}) {
  const [input, setInput] = useState("");
  const [page, setPage] = useState(0);
  const text = input.trim();
  const term = useDebouncedValue(text);
  const ready = term === text && term.length >= 2 && !!date;
  const results = useQuery({
    queryKey: ["workshop-inventory-search", date, term, page],
    enabled: ready,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc("search_inventory_workshops", {
        p_date: date, p_term: term, p_offset: page * 20,
      }).abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const rows = results.data ?? [];

  return <section dir={direction()} className="space-y-2 rounded-xl border bg-muted/20 p-3">
    <Label htmlFor="inventory-workshop-search">{ui("البحث في جميع الورش")}</Label>
    <div className="relative">
      <Search aria-hidden className="absolute start-3 top-3 size-4 text-muted-foreground" />
      <Input id="inventory-workshop-search" type="search" maxLength={100} value={input}
        className="bg-background ps-9" placeholder={ui("اسم الورشة، الموظف أو رقمه، التخصص، الموقع أو عمل اليوم…")}
        onChange={event => { setInput(event.target.value); setPage(0); }} />
    </div>
    {text && <div aria-live="polite">
      {text.length < 2 ? <p className="text-sm text-muted-foreground">{ui("اكتب حرفين على الأقل.")}</p>
        : !date ? <p className="text-sm text-muted-foreground">{ui("اختر تاريخ الجرد للبحث.")}</p>
        : !ready || results.isLoading ? <p className="text-sm text-muted-foreground">{ui("جارٍ البحث في الورش…")}</p>
        : results.isError ? <p role="alert" className="text-sm text-destructive">{ui("تعذّر البحث في الورش. ")}<Button size="sm" variant="ghost" onClick={() => results.refetch()}>{ui("إعادة المحاولة")}</Button></p>
        : rows.length === 0 ? <p className="text-sm text-muted-foreground">{ui("لا توجد نتائج مطابقة.")}</p>
        : <ul className="max-h-72 divide-y overflow-auto rounded-lg border bg-card">
          {rows.slice(0, 20).map(row => <li key={JSON.stringify([row.workshop_id, row.match_kind, row.employee_id])}>
            <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-muted focus-visible:bg-muted"
              onClick={() => { onSelect(row.workshop_id, row.employee_id); setInput(""); setPage(0); }}>
              <span className="min-w-0 flex-1"><strong className="block">{row.workshop_name}</strong>
                <span className="break-words text-sm text-muted-foreground">{row.match_kind}{row.match_kind !== "ورشة" && ` · ${row.detail}`}</span>
              </span><ArrowLeft aria-hidden className="size-4 shrink-0 text-primary" />
            </button>
          </li>)}
        </ul>}
      {ready && (page > 0 || rows.length > 20) && <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>{ui("السابق")}</Button>
        <span className="text-xs">{ui("صفحة ")}{page + 1}</span>
        <Button size="sm" variant="outline" disabled={rows.length <= 20} onClick={() => setPage(page + 1)}>{ui("التالي")}</Button>
      </div>}
    </div>}
  </section>;
}
