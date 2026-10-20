CREATE TABLE IF NOT EXISTS public.machinery_monthly_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machinery_id uuid NOT NULL REFERENCES public.machinery(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  operating_days integer NOT NULL DEFAULT 0 CHECK (operating_days >= 0 AND operating_days <= 31),
  operating_dates date[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machinery_id, month),
  CHECK (operating_days = cardinality(operating_dates))
);

CREATE INDEX IF NOT EXISTS machinery_monthly_operations_month_idx
  ON public.machinery_monthly_operations(month, machinery_id);

DROP TRIGGER IF EXISTS trg_machinery_monthly_operations_updated_at ON public.machinery_monthly_operations;
CREATE TRIGGER trg_machinery_monthly_operations_updated_at
  BEFORE UPDATE ON public.machinery_monthly_operations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.machinery_monthly_operations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.machinery_monthly_operations TO authenticated;
GRANT ALL ON public.machinery_monthly_operations TO service_role;

DROP POLICY IF EXISTS "authenticated read machinery operations" ON public.machinery_monthly_operations;
CREATE POLICY "authenticated read machinery operations"
  ON public.machinery_monthly_operations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "maintenance manage machinery operations" ON public.machinery_monthly_operations;
CREATE POLICY "maintenance manage machinery operations"
  ON public.machinery_monthly_operations FOR ALL TO authenticated
  USING (public.is_maintenance_staff(auth.uid()) OR public.has_role(auth.uid(), 'hr'::public.app_role))
  WITH CHECK (public.is_maintenance_staff(auth.uid()) OR public.has_role(auth.uid(), 'hr'::public.app_role));

NOTIFY pgrst, 'reload schema';
