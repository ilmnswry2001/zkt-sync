-- Builds a dated assignment using the existing atomic daily operation and its RLS checks.
CREATE OR REPLACE FUNCTION public.set_workshop_period_tasks(
  p_ids uuid[], p_start date, p_end date, p_site uuid, p_activity text, p_apply boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_date date;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR
    public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry')
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 365
  THEN RAISE EXCEPTION 'Choose a valid period of at most 366 days'; END IF;
  FOR v_date IN SELECT p_start + day_offset FROM generate_series(0, p_end - p_start) AS days(day_offset)
  LOOP
    PERFORM public.set_workshop_daily_tasks(p_ids, v_date, p_site, p_activity, p_apply);
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.set_workshop_period_tasks(uuid[], date, date, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_workshop_period_tasks(uuid[], date, date, uuid, text, boolean) TO authenticated;
