export function readWorkspaceName() {
  const saved = typeof window === "undefined" ? undefined : window.localStorage.getItem("zkt-workspace-name")?.trim();
  return saved && saved !== "منظومة زِكت" ? saved : "EMAD_tc";
}
