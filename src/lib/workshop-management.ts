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
