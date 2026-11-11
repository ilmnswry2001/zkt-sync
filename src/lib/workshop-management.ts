/** Move a workshop without losing entries hidden by a site/search filter. */
export function reorderWorkshopIds(
  ids: readonly string[],
  source: string,
  target: string,
): string[] {
  const result = [...ids];
  const from = result.indexOf(source);
  const to = result.indexOf(target);
  if (from < 0 || to < 0 || from === to) return result;
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}

/** Inclusive days; dates are UTC calendar dates so DST cannot change the count. */
export function workshopPeriodDays(start: string, end: string): number {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
      ? time
      : NaN;
  };
  const days = (parse(end) - parse(start)) / 86_400_000 + 1;
  return Number.isInteger(days) && days >= 1 && days <= 366 ? days : 0;
}

export type WorkshopSiteOption = { id: string; name: string; ctr_code: string | null };
export const workshopSiteLabel = (site: WorkshopSiteOption) =>
  `${site.ctr_code || "دون كود CTR"} — ${site.name}`;
