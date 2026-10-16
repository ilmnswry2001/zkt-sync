/** Format thrown values and Supabase/PostgREST errors without leaking raw objects. */
export function formatErrorMessage(error: unknown, fallback = "حدث خطأ غير متوقع"): string {
  if (typeof error === "string") return error || fallback;
  if (!error || (typeof error !== "object" && !(error instanceof Error))) return fallback;

  const value = error as { message?: unknown; code?: unknown };
  const message = typeof value.message === "string" && value.message.trim()
    ? value.message.trim()
    : error instanceof Error && error.message
      ? error.message
      : fallback;
  const code = typeof value.code === "string" && value.code.trim()
    ? ` (رمز ${value.code.trim()})`
    : "";
  return `${message}${code}`;
}
