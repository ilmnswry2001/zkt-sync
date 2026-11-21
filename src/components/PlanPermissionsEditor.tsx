import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountAccess } from "@/lib/account-access";
import { PLAN_FULL_ROLES, PLAN_PERMISSION_SPECIALTIES } from "@/lib/plan-permissions";

type PlanAccess = AccountAccess["plan"];

export function PlanPermissionsEditor({
  roles,
  value,
  onChange,
}: {
  roles: AccountAccess["roles"];
  value: PlanAccess;
  onChange: (next: PlanAccess) => void;
}) {
  const [search, setSearch] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [error, setError] = useState("");
  const inherited = roles.some((role) => PLAN_FULL_ROLES.includes(role));
  const options = [...new Set([...value.specialties, ...PLAN_PERMISSION_SPECIALTIES])];
  const addSpecialty = () => {
    const name = specialty.trim();
    if (!name) return;
    if (value.specialties.includes(name)) {
      setError("هذا التخصص مضاف بالفعل.");
      return;
    }
    onChange({ ...value, specialties: [...value.specialties, name] });
    setSpecialty("");
    setError("");
  };
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-muted/35 p-4 text-sm leading-6">
        <p className="font-medium">صلاحيات خطط العمل</p>
        <p className="text-muted-foreground">
          تُدار موافقات الخطط عبر أدوار سير العمل المعتمدة في شاشة التخطيط.
        </p>
        {inherited && (
          <p className="mt-2 text-primary">
            يمنح الدور الحالي طلب الخطط وإدراج الكوادر لجميع التخصصات.
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <Checkbox
            disabled={inherited}
            checked={inherited || value.canRequest}
            onCheckedChange={(checked) => onChange({ ...value, canRequest: checked === true })}
          />
          طلب خطة عمل
        </label>
        <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <Checkbox
            disabled={inherited}
            checked={inherited || value.canStaffAll}
            onCheckedChange={(checked) => onChange({ ...value, canStaffAll: checked === true })}
          />
          إدراج الكوادر لجميع التخصصات
        </label>
      </div>
      {!inherited && !value.canStaffAll && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="account-specialties-search">التخصصات المسموح بإدراج كوادرها</Label>
            <Badge variant="secondary">{value.specialties.length}</Badge>
          </div>
          <Input
            id="account-specialties-search"
            placeholder="ابحث عن تخصص"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
            {options
              .filter((name) => name.toLowerCase().includes(search.trim().toLowerCase()))
              .map((name) => (
                <label
                  key={name}
                  className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={value.specialties.includes(name)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...value,
                        specialties:
                          checked === true
                            ? [...value.specialties, name]
                            : value.specialties.filter((entry) => entry !== name),
                      })
                    }
                  />
                  {name}
                </label>
              ))}
          </div>
          <Label htmlFor="account-specialty">تخصص إضافي</Label>
          <div className="flex items-center gap-2">
            <Input
              id="account-specialty"
              maxLength={120}
              placeholder="اكتب اسم التخصص كما يظهر في التخطيط"
              value={specialty}
              onChange={(event) => {
                setSpecialty(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addSpecialty();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!specialty.trim()}
              onClick={addSpecialty}
            >
              إضافة
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
