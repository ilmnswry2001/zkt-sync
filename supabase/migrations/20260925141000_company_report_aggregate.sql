-- Keep company report aggregation in PostgreSQL instead of transferring all report lines to the browser.
CREATE INDEX IF NOT EXISTS site_daily_report_lines_report_id_idx
  ON public.site_daily_report_lines(report_id);

CREATE OR REPLACE FUNCTION public.get_company_report_aggregate(
  p_from date,
  p_to date,
  p_site_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL
)
RETURNS TABLE (
  kind text,
  item_name text,
  total bigint,
  working bigint,
  idle bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    lines.kind,
    lines.item_name,
    COALESCE(SUM(lines.total_count), 0)::bigint AS total,
    COALESCE(SUM(lines.working_count), 0)::bigint AS working,
    COALESCE(SUM(lines.idle_count), 0)::bigint AS idle
  FROM public.site_daily_report_lines AS lines
  INNER JOIN public.site_daily_reports AS reports ON reports.id = lines.report_id
  WHERE reports.report_date BETWEEN p_from AND p_to
    AND (p_site_id IS NULL OR reports.site_id = p_site_id)
    AND (p_kind IS NULL OR lines.kind = p_kind)
  GROUP BY lines.kind, lines.item_name
  ORDER BY lines.kind, lines.item_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_report_aggregate(date, date, uuid, text) TO authenticated;
