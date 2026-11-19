CREATE FUNCTION public.lock_employee_number_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Explicit numbers (including Excel imports) must not race automatic allocation.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.employees.employee_no'), 0);
  RETURN NULL;
END;
$$;

CREATE TRIGGER lock_employee_number_writes
BEFORE INSERT OR UPDATE OF employee_no ON public.employees
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_employee_number_writes();

CREATE FUNCTION public.assign_employee_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  SELECT (COALESCE(MAX(employee_no::numeric), 0) + 1)::text
    INTO NEW.employee_no
    FROM public.employees
    WHERE employee_no ~ '^[0-9]+$';

  IF NEW.employee_import_data ? 'التسلسل' THEN
    NEW.employee_import_data := pg_catalog.jsonb_set(
      NEW.employee_import_data, ARRAY['التسلسل'], pg_catalog.to_jsonb(NEW.employee_no)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assign_employee_number
BEFORE INSERT ON public.employees
FOR EACH ROW WHEN (NEW.employee_no IS NULL)
EXECUTE FUNCTION public.assign_employee_number();

REVOKE EXECUTE ON FUNCTION public.lock_employee_number_writes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_employee_number() FROM PUBLIC, anon, authenticated;
