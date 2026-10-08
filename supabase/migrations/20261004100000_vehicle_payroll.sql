CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_no text NOT NULL UNIQUE,
  name text NOT NULL,
  vehicle_class text NOT NULL CHECK (vehicle_class IN ('light', 'heavy')),
  daily_rate numeric(12,2) NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),
  currency text NOT NULL DEFAULT 'IQD',
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_monthly_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  operating_days integer NOT NULL DEFAULT 0 CHECK (operating_days >= 0 AND operating_days <= 31),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, month)
);

CREATE INDEX IF NOT EXISTS vehicle_monthly_operations_month_idx
  ON public.vehicle_monthly_operations(month, vehicle_id);
CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_vehicle_monthly_operations_updated_at BEFORE UPDATE ON public.vehicle_monthly_operations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_monthly_operations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles, public.vehicle_monthly_operations TO authenticated;
GRANT ALL ON public.vehicles, public.vehicle_monthly_operations TO service_role;

CREATE POLICY "authenticated read vehicles" ON public.vehicles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "hr manage vehicles" ON public.vehicles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'));
CREATE POLICY "authenticated read vehicle operations" ON public.vehicle_monthly_operations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "hr manage vehicle operations" ON public.vehicle_monthly_operations
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'));
