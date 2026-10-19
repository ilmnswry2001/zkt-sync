-- ============================================================================
-- Vehicles fuel module
-- Adds fuel/driver/odometer fields to vehicles, a fuel vouchers ledger,
-- an automatic sync trigger, RLS policies and storage buckets.
-- ============================================================================

-- 1) vehicles: fuel type, current driver, odometer + ensure detail columns
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS fuel_type text NOT NULL DEFAULT 'diesel'
    CHECK (fuel_type IN ('gasoline', 'diesel')),
  ADD COLUMN IF NOT EXISTS current_driver_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_odometer numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_image_url text,
  ADD COLUMN IF NOT EXISTS last_fuel_date date,
  ADD COLUMN IF NOT EXISTS security_permit_expiry date;

CREATE INDEX IF NOT EXISTS vehicles_current_driver_idx
  ON public.vehicles(current_driver_id);
CREATE INDEX IF NOT EXISTS vehicles_fuel_type_idx
  ON public.vehicles(fuel_type);

-- 2) fuel vouchers ledger
CREATE TABLE IF NOT EXISTS public.vehicle_fuel_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_no text NOT NULL UNIQUE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  fuel_type text NOT NULL CHECK (fuel_type IN ('gasoline', 'diesel')),
  liters numeric(10,2) NOT NULL CHECK (liters > 0),
  price_per_liter numeric(10,2) NOT NULL DEFAULT 0,
  total_cost numeric(12,2) NOT NULL DEFAULT 0,
  odometer_reading numeric(12,2),
  fuel_station text,
  voucher_date date NOT NULL DEFAULT CURRENT_DATE,
  receipt_image_url text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_fuel_vouchers_vehicle_idx
  ON public.vehicle_fuel_vouchers(vehicle_id, voucher_date DESC);
CREATE INDEX IF NOT EXISTS vehicle_fuel_vouchers_date_idx
  ON public.vehicle_fuel_vouchers(voucher_date DESC);
CREATE INDEX IF NOT EXISTS vehicle_fuel_vouchers_fuel_type_idx
  ON public.vehicle_fuel_vouchers(fuel_type);

-- 3) sync vehicles.last_fuel_date and current_odometer from vouchers
CREATE OR REPLACE FUNCTION public.sync_vehicle_from_fuel_voucher()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_vehicle uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_vehicle := OLD.vehicle_id;
  ELSE
    target_vehicle := NEW.vehicle_id;
  END IF;

  UPDATE public.vehicles v
  SET
    last_fuel_date = (
      SELECT max(fv.voucher_date)
      FROM public.vehicle_fuel_vouchers fv
      WHERE fv.vehicle_id = target_vehicle
    ),
    current_odometer = GREATEST(
      COALESCE(v.current_odometer, 0),
      COALESCE(
        (SELECT max(fv.odometer_reading)
         FROM public.vehicle_fuel_vouchers fv
         WHERE fv.vehicle_id = target_vehicle),
        0
      )
    ),
    updated_at = now()
  WHERE v.id = target_vehicle;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_vehicle_from_fuel_voucher
  ON public.vehicle_fuel_vouchers;
CREATE TRIGGER trg_sync_vehicle_from_fuel_voucher
  AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_fuel_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.sync_vehicle_from_fuel_voucher();

DROP TRIGGER IF EXISTS trg_vehicle_fuel_vouchers_updated_at
  ON public.vehicle_fuel_vouchers;
CREATE TRIGGER trg_vehicle_fuel_vouchers_updated_at
  BEFORE UPDATE ON public.vehicle_fuel_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) RLS
ALTER TABLE public.vehicle_fuel_vouchers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_fuel_vouchers TO authenticated;
GRANT ALL ON public.vehicle_fuel_vouchers TO service_role;

DROP POLICY IF EXISTS "authenticated read fuel vouchers" ON public.vehicle_fuel_vouchers;
CREATE POLICY "authenticated read fuel vouchers" ON public.vehicle_fuel_vouchers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin hr manage fuel vouchers" ON public.vehicle_fuel_vouchers;
CREATE POLICY "admin hr manage fuel vouchers" ON public.vehicle_fuel_vouchers
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'));

-- 5) storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vehicle-images', 'vehicle-images', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fuel-receipts', 'fuel-receipts', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "vehicle images read" ON storage.objects;
CREATE POLICY "vehicle images read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'vehicle-images');
DROP POLICY IF EXISTS "vehicle images insert" ON storage.objects;
CREATE POLICY "vehicle images insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-images'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  );
DROP POLICY IF EXISTS "vehicle images update" ON storage.objects;
CREATE POLICY "vehicle images update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'vehicle-images'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  )
  WITH CHECK (
    bucket_id = 'vehicle-images'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  );
DROP POLICY IF EXISTS "vehicle images delete" ON storage.objects;
CREATE POLICY "vehicle images delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'vehicle-images'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  );

DROP POLICY IF EXISTS "fuel receipts read" ON storage.objects;
CREATE POLICY "fuel receipts read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'fuel-receipts');
DROP POLICY IF EXISTS "fuel receipts insert" ON storage.objects;
CREATE POLICY "fuel receipts insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fuel-receipts'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  );
DROP POLICY IF EXISTS "fuel receipts update" ON storage.objects;
CREATE POLICY "fuel receipts update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'fuel-receipts'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  )
  WITH CHECK (
    bucket_id = 'fuel-receipts'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  );
DROP POLICY IF EXISTS "fuel receipts delete" ON storage.objects;
CREATE POLICY "fuel receipts delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'fuel-receipts'
    AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  );
