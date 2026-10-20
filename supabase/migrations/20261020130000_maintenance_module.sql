-- ============================================================================
-- Maintenance module
-- Machinery registry, maintenance catalogs (types / workshops), maintenance
-- records with parts and attachments, automatic totals, entity reading sync,
-- RLS for the maintenance department, and a private attachments bucket.
-- ============================================================================

-- 1) machinery registry
CREATE TABLE IF NOT EXISTS public.machinery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text,
  plate_no text,
  model text,
  year integer,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'inactive')),
  current_hours numeric(12,2) NOT NULL DEFAULT 0,
  current_odometer numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) maintenance catalogs
CREATE TABLE IF NOT EXISTS public.maintenance_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_workshops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'workshop' CHECK (kind IN ('workshop', 'technician')),
  phone text,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) maintenance records
CREATE TABLE IF NOT EXISTS public.maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_no text NOT NULL UNIQUE,
  record_type text NOT NULL CHECK (record_type IN ('machinery', 'vehicle', 'equipment')),
  machinery_id uuid REFERENCES public.machinery(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  equipment_id uuid REFERENCES public.warehouse_items(id) ON DELETE SET NULL,
  entity_name text,
  maintenance_type_id uuid REFERENCES public.maintenance_types(id) ON DELETE SET NULL,
  maintenance_type_name text,
  description text,
  workshop_id uuid REFERENCES public.maintenance_workshops(id) ON DELETE SET NULL,
  workshop_name text,
  technician text,
  maintenance_date date NOT NULL DEFAULT CURRENT_DATE,
  odometer_reading numeric(12,2),
  hours_reading numeric(12,2),
  labor_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (labor_cost >= 0),
  parts_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (parts_total >= 0),
  total_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'in_progress', 'waiting_parts', 'completed', 'cancelled')),
  next_maintenance_date date,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_record_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.maintenance_records(id) ON DELETE CASCADE,
  part_name text NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  line_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_record_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.maintenance_records(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_path text,
  file_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_records_type_date_idx
  ON public.maintenance_records(record_type, maintenance_date DESC);
CREATE INDEX IF NOT EXISTS maintenance_records_vehicle_idx
  ON public.maintenance_records(vehicle_id, maintenance_date DESC);
CREATE INDEX IF NOT EXISTS maintenance_records_machinery_idx
  ON public.maintenance_records(machinery_id, maintenance_date DESC);
CREATE INDEX IF NOT EXISTS maintenance_records_equipment_idx
  ON public.maintenance_records(equipment_id, maintenance_date DESC);
CREATE INDEX IF NOT EXISTS maintenance_records_next_idx
  ON public.maintenance_records(next_maintenance_date);
CREATE INDEX IF NOT EXISTS maintenance_parts_record_idx
  ON public.maintenance_record_parts(record_id);
CREATE INDEX IF NOT EXISTS maintenance_attachments_record_idx
  ON public.maintenance_record_attachments(record_id);

-- 4) seed the maintenance type catalog
INSERT INTO public.maintenance_types (name, category) VALUES
  ('تغيير الدهن', 'دهان'),
  ('تغيير الإطارات', 'ميكانيك'),
  ('تغيير الزيت', 'محرك'),
  ('صيانة المحرك', 'محرك'),
  ('الأعمال الكهربائية', 'كهرباء'),
  ('الفرامل', 'ميكانيك'),
  ('التكييف', 'كهرباء'),
  ('الهيكل', 'هيكل'),
  ('فحص دوري', 'عام')
ON CONFLICT (name) DO NOTHING;

-- 5) helpers and triggers
CREATE OR REPLACE FUNCTION public.is_maintenance_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin(_user_id)
    OR public.has_role(_user_id, 'maintenance_manager'::public.app_role)
    OR public.has_role(_user_id, 'maintenance_admin'::public.app_role);
$$;
GRANT EXECUTE ON FUNCTION public.is_maintenance_staff(uuid) TO authenticated, service_role;

-- keep total_cost = labor + parts sum
CREATE OR REPLACE FUNCTION public.recalc_maintenance_record_total_on_labor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.total_cost := COALESCE(NEW.labor_cost, 0) + COALESCE(NEW.parts_total, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintenance_records_total ON public.maintenance_records;
CREATE TRIGGER trg_maintenance_records_total
  BEFORE INSERT OR UPDATE OF labor_cost, parts_total ON public.maintenance_records
  FOR EACH ROW EXECUTE FUNCTION public.recalc_maintenance_record_total_on_labor();

-- recompute the parent record totals whenever its parts change
CREATE OR REPLACE FUNCTION public.recalc_maintenance_record_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target uuid;
BEGIN
  target := COALESCE(NEW.record_id, OLD.record_id);
  UPDATE public.maintenance_records r
  SET
    parts_total = COALESCE(
      (SELECT sum(p.line_total) FROM public.maintenance_record_parts p WHERE p.record_id = target),
      0
    ),
    updated_at = now()
  WHERE r.id = target;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintenance_parts_totals ON public.maintenance_record_parts;
CREATE TRIGGER trg_maintenance_parts_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_record_parts
  FOR EACH ROW EXECUTE FUNCTION public.recalc_maintenance_record_totals();

-- sync odometer / hours back to the maintained entity
CREATE OR REPLACE FUNCTION public.sync_maintenance_reading()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.record_type = 'vehicle' AND NEW.vehicle_id IS NOT NULL THEN
    UPDATE public.vehicles v
    SET
      current_odometer = GREATEST(COALESCE(v.current_odometer, 0), COALESCE(NEW.odometer_reading, 0)),
      updated_at = now()
    WHERE v.id = NEW.vehicle_id;
  ELSIF NEW.record_type = 'machinery' AND NEW.machinery_id IS NOT NULL THEN
    UPDATE public.machinery m
    SET
      current_odometer = GREATEST(COALESCE(m.current_odometer, 0), COALESCE(NEW.odometer_reading, 0)),
      current_hours = GREATEST(COALESCE(m.current_hours, 0), COALESCE(NEW.hours_reading, 0)),
      updated_at = now()
    WHERE m.id = NEW.machinery_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_maintenance_reading ON public.maintenance_records;
CREATE TRIGGER trg_sync_maintenance_reading
  AFTER INSERT OR UPDATE OF odometer_reading, hours_reading ON public.maintenance_records
  FOR EACH ROW EXECUTE FUNCTION public.sync_maintenance_reading();

DROP TRIGGER IF EXISTS trg_maintenance_records_updated_at ON public.maintenance_records;
CREATE TRIGGER trg_maintenance_records_updated_at
  BEFORE UPDATE ON public.maintenance_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_machinery_updated_at ON public.machinery;
CREATE TRIGGER trg_machinery_updated_at
  BEFORE UPDATE ON public.machinery
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6) RLS
ALTER TABLE public.machinery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_workshops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_record_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_record_attachments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.machinery, public.maintenance_types, public.maintenance_workshops,
  public.maintenance_records, public.maintenance_record_parts, public.maintenance_record_attachments
  TO authenticated;
GRANT ALL ON
  public.machinery, public.maintenance_types, public.maintenance_workshops,
  public.maintenance_records, public.maintenance_record_parts, public.maintenance_record_attachments
  TO service_role;

-- catalogs are readable by authenticated users, managed by maintenance staff
DROP POLICY IF EXISTS "authenticated read machinery" ON public.machinery;
CREATE POLICY "authenticated read machinery" ON public.machinery
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "maintenance manage machinery" ON public.machinery;
CREATE POLICY "maintenance manage machinery" ON public.machinery
  FOR ALL TO authenticated
  USING (public.is_maintenance_staff(auth.uid()))
  WITH CHECK (public.is_maintenance_staff(auth.uid()));

DROP POLICY IF EXISTS "authenticated read maintenance types" ON public.maintenance_types;
CREATE POLICY "authenticated read maintenance types" ON public.maintenance_types
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "maintenance manage maintenance types" ON public.maintenance_types;
CREATE POLICY "maintenance manage maintenance types" ON public.maintenance_types
  FOR ALL TO authenticated
  USING (public.is_maintenance_staff(auth.uid()))
  WITH CHECK (public.is_maintenance_staff(auth.uid()));

DROP POLICY IF EXISTS "authenticated read maintenance workshops" ON public.maintenance_workshops;
CREATE POLICY "authenticated read maintenance workshops" ON public.maintenance_workshops
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "maintenance manage maintenance workshops" ON public.maintenance_workshops;
CREATE POLICY "maintenance manage maintenance workshops" ON public.maintenance_workshops
  FOR ALL TO authenticated
  USING (public.is_maintenance_staff(auth.uid()))
  WITH CHECK (public.is_maintenance_staff(auth.uid()));

DROP POLICY IF EXISTS "maintenance manage maintenance records" ON public.maintenance_records;
CREATE POLICY "maintenance manage maintenance records" ON public.maintenance_records
  FOR ALL TO authenticated
  USING (public.is_maintenance_staff(auth.uid()))
  WITH CHECK (public.is_maintenance_staff(auth.uid()));

DROP POLICY IF EXISTS "maintenance manage maintenance parts" ON public.maintenance_record_parts;
CREATE POLICY "maintenance manage maintenance parts" ON public.maintenance_record_parts
  FOR ALL TO authenticated
  USING (public.is_maintenance_staff(auth.uid()))
  WITH CHECK (public.is_maintenance_staff(auth.uid()));

DROP POLICY IF EXISTS "maintenance manage maintenance attachments" ON public.maintenance_record_attachments;
CREATE POLICY "maintenance manage maintenance attachments" ON public.maintenance_record_attachments
  FOR ALL TO authenticated
  USING (public.is_maintenance_staff(auth.uid()))
  WITH CHECK (public.is_maintenance_staff(auth.uid()));

-- 7) attachments bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'maintenance-attachments',
  'maintenance-attachments',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "maintenance attachments read" ON storage.objects;
CREATE POLICY "maintenance attachments read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'maintenance-attachments');

DROP POLICY IF EXISTS "maintenance attachments insert" ON storage.objects;
CREATE POLICY "maintenance attachments insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'maintenance-attachments' AND public.is_maintenance_staff(auth.uid()));

DROP POLICY IF EXISTS "maintenance attachments update" ON storage.objects;
CREATE POLICY "maintenance attachments update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'maintenance-attachments' AND public.is_maintenance_staff(auth.uid()))
  WITH CHECK (bucket_id = 'maintenance-attachments' AND public.is_maintenance_staff(auth.uid()));

DROP POLICY IF EXISTS "maintenance attachments delete" ON storage.objects;
CREATE POLICY "maintenance attachments delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'maintenance-attachments' AND public.is_maintenance_staff(auth.uid()));
