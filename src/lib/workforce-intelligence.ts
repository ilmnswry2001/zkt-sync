import { supabase } from "@/integrations/supabase/client";

type Trade = "welders" | "fabricators" | "helpers" | "other";

type CrewMember = {
  id: string;
  name: string;
  trade: Trade;
};

export type CrewReallocation = {
  fromWorkshopId: string;
  fromWorkshopName: string;
  toWorkshopId: string;
  toWorkshopName: string;
  siteId: string;
  siteName: string;
  trade: Trade;
  employeeId: string;
  employeeName: string;
};

export type CrewRequirement = {
  workshopId: string;
  workshopName: string;
  siteId: string;
  siteName: string;
  trade: Trade;
  required: number;
  present: number;
  percentage: number;
  status: "shortage" | "surplus" | "balanced";
};

export type CrewAnalysis = {
  date: string;
  requirements: CrewRequirement[];
  reallocations: CrewReallocation[];
};

const classifyTrade = (label: string | null | undefined): Trade => {
  const normalized = label?.trim().toLocaleLowerCase() ?? "";
  if (/لحام|welder/.test(normalized)) return "welders";
  if (/حداد|فابريك|مصنّع|مصنع|fabricat/.test(normalized)) return "fabricators";
  if (/عامل|مساعد|helper/.test(normalized)) return "helpers";
  return "other";
};

const tradeOrder: Trade[] = ["welders", "fabricators", "helpers", "other"];

export async function analyzeCrewRequirements(date: string): Promise<CrewAnalysis> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("تاريخ تحليل القوى العاملة غير صالح");
  }

  const { data: reports, error: reportsError } = await supabase
    .from("daily_workshop_reports")
    .select("id, workshop_id, daily_workshops(name)")
    .eq("report_date", date);
  if (reportsError) throw reportsError;

  const reportIds = (reports ?? []).map((report) => report.id);
  if (!reportIds.length) return { date, requirements: [], reallocations: [] };

  const workshopIds = [...new Set((reports ?? []).map((report) => report.workshop_id))];
  const [{ data: lines, error: linesError }, { data: members, error: membersError }] =
    await Promise.all([
      supabase
        .from("daily_workshop_report_lines")
        .select(
          "report_id, employee_id, employee_name_snapshot, role_label, attended, site_id, employees(position)",
        )
        .in("report_id", reportIds),
      supabase
        .from("daily_workshop_members")
        .select("workshop_id, employee_id, role_label, employees(full_name, position)")
        .eq("is_active", true)
        .in("workshop_id", workshopIds),
    ]);
  if (linesError) throw linesError;
  if (membersError) throw membersError;

  const workshopName = new Map(
    (reports ?? []).map((report) => {
      const related = Array.isArray(report.daily_workshops)
        ? report.daily_workshops[0]
        : report.daily_workshops;
      return [report.workshop_id, related?.name ?? "ورشة"] as const;
    }),
  );
  const memberByWorkshopTrade = new Map<string, Set<string>>();
  for (const member of members ?? []) {
    const employee = Array.isArray(member.employees) ? member.employees[0] : member.employees;
    const trade = classifyTrade(member.role_label ?? employee?.position);
    const key = `${member.workshop_id}:${trade}`;
    const employees = memberByWorkshopTrade.get(key) ?? new Set<string>();
    employees.add(member.employee_id);
    memberByWorkshopTrade.set(key, employees);
  }

  const groupKey = (workshopId: string, siteId: string, trade: Trade) =>
    `${workshopId}:${siteId}:${trade}`;
  const expectedByGroup = new Map<string, Set<string>>();
  const presentByGroup = new Map<string, Map<string, CrewMember>>();
  const siteNames = new Map<string, string>();

  for (const line of lines ?? []) {
    if (!line.site_id) continue;
    const report = reports?.find((item) => item.id === line.report_id);
    if (!report) continue;
    const employee = Array.isArray(line.employees) ? line.employees[0] : line.employees;
    const trade = classifyTrade(line.role_label ?? employee?.position);
    const key = groupKey(report.workshop_id, line.site_id, trade);
    const expected = expectedByGroup.get(key) ?? new Set<string>();
    if (line.employee_id) expected.add(line.employee_id);
    expectedByGroup.set(key, expected);

    if (line.attended && line.employee_id) {
      const present = presentByGroup.get(key) ?? new Map<string, CrewMember>();
      present.set(line.employee_id, {
        id: line.employee_id,
        name: line.employee_name_snapshot,
        trade,
      });
      presentByGroup.set(key, present);
    }
  }

  const requirements: CrewRequirement[] = [];
  for (const [key, expectedEmployees] of expectedByGroup) {
    const [workshopId, siteId, trade] = key.split(":") as [string, string, Trade];
    const presentWorkers = presentByGroup.get(key) ?? new Map<string, CrewMember>();
    const roster = memberByWorkshopTrade.get(`${workshopId}:${trade}`);
    const required = roster?.size || expectedEmployees.size;
    const present = presentWorkers.size;
    const percentage = required ? Math.round((present / required) * 100) : 0;
    requirements.push({
      workshopId,
      workshopName: workshopName.get(workshopId) ?? "ورشة",
      siteId,
      siteName: "الموقع الميداني",
      trade,
      required,
      present,
      percentage,
      status: percentage < 70 ? "shortage" : percentage > 110 ? "surplus" : "balanced",
    });
  }

  const siteIds = [...new Set(requirements.map((requirement) => requirement.siteId))];
  if (siteIds.length) {
    const { data: sites, error: sitesError } = await supabase
      .from("sites")
      .select("id, name")
      .in("id", siteIds);
    if (sitesError) throw sitesError;
    for (const site of sites ?? []) siteNames.set(site.id, site.name);
  }
  for (const requirement of requirements) {
    requirement.siteName = siteNames.get(requirement.siteId) ?? requirement.siteName;
  }

  const reallocations: CrewReallocation[] = [];
  const allocatedWorkers = new Set<string>();
  const deficits = requirements.filter((requirement) => requirement.status === "shortage");
  const surpluses = requirements.filter((requirement) => requirement.status === "surplus");
  const remainingSurplus = new Map(
    surpluses.map((requirement) => [
      groupKey(requirement.workshopId, requirement.siteId, requirement.trade),
      Math.max(0, requirement.present - Math.ceil(requirement.required * 1.1)),
    ]),
  );
  for (const deficit of deficits) {
    let remaining = Math.max(0, Math.ceil(deficit.required * 0.7) - deficit.present);
    for (const surplus of surpluses) {
      if (remaining <= 0 || surplus.siteId !== deficit.siteId || surplus.trade !== deficit.trade) {
        continue;
      }

      const surplusWorkers = [
        ...(presentByGroup
          .get(groupKey(surplus.workshopId, surplus.siteId, surplus.trade))
          ?.values() ?? []),
      ];
      const sourceKey = groupKey(surplus.workshopId, surplus.siteId, surplus.trade);
      let excess = remainingSurplus.get(sourceKey) ?? 0;
      for (const worker of surplusWorkers) {
        if (remaining <= 0 || excess <= 0) break;
        if (allocatedWorkers.has(worker.id)) continue;
        reallocations.push({
          fromWorkshopId: surplus.workshopId,
          fromWorkshopName: surplus.workshopName,
          toWorkshopId: deficit.workshopId,
          toWorkshopName: deficit.workshopName,
          siteId: deficit.siteId,
          siteName: deficit.siteName,
          trade: deficit.trade,
          employeeId: worker.id,
          employeeName: worker.name,
        });
        allocatedWorkers.add(worker.id);
        remaining -= 1;
        excess -= 1;
        remainingSurplus.set(sourceKey, excess);
      }
    }
  }

  return {
    date,
    requirements: requirements.sort(
      (left, right) =>
        tradeOrder.indexOf(left.trade) - tradeOrder.indexOf(right.trade) ||
        left.workshopName.localeCompare(right.workshopName, "ar"),
    ),
    reallocations,
  };
}
